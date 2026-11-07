import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { nodeOptions, type RawNode } from "@/lib/flow-engine/node-stats";

type Db = SupabaseClient<Database>;

/**
 * Flows that stopped to wait for a person. Read-only.
 *
 * The engine hands a conversation to a human when someone types something
 * the buttons do not cover (`handOverToHuman`): it pauses the automation and
 * closes the run. Nothing told anyone, so a lead who typed "pode perguntar"
 * under "Claro, vamos lá" waited unanswered (07/11/2026). This lets the
 * Central see every such stop and tell Rafa, with what the person typed and
 * where it stopped. It never resumes a run or lifts the pause: the door
 * reads, and handing the conversation back stays a person's click in the
 * inbox ("Bot paused · resume").
 *
 * Like GET /conversas, nothing that identifies the contact leaves: the only
 * ids are our own session and conversation ids.
 */

const JANELA_MS = 24 * 60 * 60 * 1000;

export interface FluxoParado {
  sessao: string;
  conversa: string | null;
  fluxo: { id: string; nome: string };
  passo: { id: string; mensagem: string; botoes: Array<{ payload: string; titulo: string }> };
  digitou: string;
  parou_em: string;
  /** The automation is still paused on this conversation. */
  pausada: boolean;
  /** Somebody replied by hand after the stop (as far as our records show). */
  alguem_respondeu: boolean;
  /** A newer run of the same flow started for this person after the stop. */
  retomado: boolean;
  janela_aberta: boolean;
  janela_fecha_em: string | null;
  /** Still waiting for someone: paused, nobody answered, window open. */
  retomavel: boolean;
  motivo_nao_retomavel: string | null;
}

/** The text a waiting node showed, for whoever decides what the reply meant. */
export function textoDoPasso(node: RawNode | undefined): string {
  const messages = (node?.data as { messages?: Array<{ text?: unknown }> } | undefined)?.messages;
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => (typeof m?.text === "string" ? m.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1000);
}

/**
 * Whether a stopped run can be picked up again, and why not when it cannot.
 * Pure, so the rules are tested apart from the database.
 */
export function avaliarRetomada(s: {
  pausada: boolean;
  alguemRespondeu: boolean;
  retomado: boolean;
  janelaAberta: boolean;
  temBotoes: boolean;
}): { retomavel: boolean; motivo: string | null } {
  if (s.retomado) return { retomavel: false, motivo: "ja_retomado" };
  if (s.alguemRespondeu) return { retomavel: false, motivo: "alguem_respondeu" };
  if (!s.pausada) return { retomavel: false, motivo: "nao_esta_pausada" };
  if (!s.temBotoes) return { retomavel: false, motivo: "passo_sem_botao" };
  if (!s.janelaAberta) return { retomavel: false, motivo: "fora_da_janela" };
  return { retomavel: true, motivo: null };
}

interface SessaoParada {
  id: string;
  contact_id: string;
  flow_id: string;
  channel_id: string;
  current_node_id: string | null;
  human_takeover_at: string;
  created_at: string;
  flows: { name: string; nodes: Json; workspace_id: string } | null;
}

async function sessoesParadas(db: Db, workspaceId: string, desde: string, sessao?: string) {
  let q = db
    .from("flow_sessions")
    .select("id, contact_id, flow_id, channel_id, current_node_id, human_takeover_at, created_at, flows!inner(name, nodes, workspace_id)")
    .eq("flows.workspace_id", workspaceId)
    .not("human_takeover_at", "is", null)
    .order("human_takeover_at", { ascending: false });
  q = sessao ? q.eq("id", sessao) : q.gte("human_takeover_at", desde).limit(100);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SessaoParada[];
}

async function detalhar(db: Db, workspaceId: string, s: SessaoParada, now: number): Promise<FluxoParado> {
  const nodes = (s.flows?.nodes ?? []) as unknown as RawNode[];
  const node = nodes.find((n) => n.id === s.current_node_id);
  const botoes = node
    ? nodeOptions(node).map((o) => ({ payload: o.payload!, titulo: o.title?.trim() || o.payload! }))
    : [];

  const { data: conv } = await db
    .from("conversations")
    .select("id, is_automation_paused")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", s.contact_id)
    .eq("channel_id", s.channel_id)
    .maybeSingle();

  const { data: evento } = await db
    .from("analytics_events")
    .select("metadata, created_at")
    .eq("event_type", "handed_to_human")
    .eq("contact_id", s.contact_id)
    .eq("flow_id", s.flow_id)
    .gte("created_at", new Date(new Date(s.human_takeover_at).getTime() - 60_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const digitou = String((evento?.metadata as { text?: unknown } | null)?.text ?? "");

  let alguemRespondeu = false;
  let ultimaDoContato: string | null = null;
  if (conv) {
    const { data: depois } = await db
      .from("messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("direction", "outbound")
      .is("sent_by_flow_id", null)
      .gt("created_at", s.human_takeover_at)
      .limit(1);
    const { data: daCentral } = await db
      .from("central_dm_sends")
      .select("conversation_id")
      .eq("conversation_id", conv.id)
      .gt("created_at", s.human_takeover_at)
      .limit(1);
    alguemRespondeu = (depois?.length ?? 0) > 0 || (daCentral?.length ?? 0) > 0;

    const { data: entrada } = await db
      .from("messages")
      .select("created_at")
      .eq("conversation_id", conv.id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ultimaDoContato = entrada?.created_at ?? null;
  }

  const { data: novas } = await db
    .from("flow_sessions")
    .select("id")
    .eq("contact_id", s.contact_id)
    .eq("flow_id", s.flow_id)
    .gt("created_at", s.human_takeover_at)
    .limit(1);
  const retomado = (novas?.length ?? 0) > 0;

  const fecha = ultimaDoContato ? new Date(ultimaDoContato).getTime() + JANELA_MS : null;
  const janelaAberta = fecha !== null && fecha > now;
  const pausada = conv?.is_automation_paused ?? false;
  const { retomavel, motivo } = avaliarRetomada({
    pausada,
    alguemRespondeu,
    retomado,
    janelaAberta,
    temBotoes: botoes.length > 0,
  });

  return {
    sessao: s.id,
    conversa: conv?.id ?? null,
    fluxo: { id: s.flow_id, nome: s.flows?.name ?? "" },
    passo: { id: s.current_node_id ?? "", mensagem: textoDoPasso(node), botoes },
    digitou,
    parou_em: s.human_takeover_at,
    pausada,
    alguem_respondeu: alguemRespondeu,
    retomado,
    janela_aberta: janelaAberta,
    janela_fecha_em: fecha ? new Date(fecha).toISOString() : null,
    retomavel,
    motivo_nao_retomavel: motivo,
  };
}

/** Every run handed to a person in the last `dias` days, newest first. */
export async function listarFluxosParados(
  db: Db,
  workspaceId: string,
  dias: number,
  now = Date.now()
): Promise<{ geradoEm: string; dias: number; parados: FluxoParado[] }> {
  const desde = new Date(now - dias * 24 * 60 * 60 * 1000).toISOString();
  const sessoes = await sessoesParadas(db, workspaceId, desde);
  const parados: FluxoParado[] = [];
  for (const s of sessoes) parados.push(await detalhar(db, workspaceId, s, now));
  return { geradoEm: new Date(now).toISOString(), dias, parados };
}
