import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { textoDoPasso } from "./fluxos-parados";
import type { RawNode } from "@/lib/flow-engine/node-stats";

type Db = SupabaseClient<Database>;

/**
 * Messages people typed in the middle of a flow that the flow could not read
 * as an answer (Rafa, 08/11/2026). The flow carries on regardless; these are
 * for the Central to answer by hand. Read-only, and like /conversas nothing
 * that identifies the contact leaves: only our own ids.
 */
export interface PerguntaNoFluxo {
  em: string;
  conversa: string | null;
  sessao: string | null;
  fluxo: { id: string | null; nome: string };
  passo: { id: string | null; mensagem: string };
  digitou: string;
  /** Someone answered by hand after it (as far as our records show). */
  respondida: boolean;
  /** The team has the bot paused on this conversation. */
  bot_pausado: boolean;
}

export async function listarPerguntasNoFluxo(
  db: Db,
  workspaceId: string,
  dias: number,
  now = Date.now()
): Promise<{ geradoEm: string; dias: number; perguntas: PerguntaNoFluxo[] }> {
  const desde = new Date(now - dias * 24 * 60 * 60 * 1000).toISOString();
  const { data: eventos, error } = await db
    .from("analytics_events")
    .select("flow_id, created_at, metadata")
    .eq("workspace_id", workspaceId)
    .eq("event_type", "typed_during_flow")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const flowIds = [...new Set((eventos ?? []).map((e) => e.flow_id).filter(Boolean))] as string[];
  const { data: flows } = flowIds.length
    ? await db.from("flows").select("id, name, nodes").in("id", flowIds)
    : { data: [] as Array<{ id: string; name: string; nodes: unknown }> };
  const porId = new Map((flows ?? []).map((f) => [f.id, f]));

  const perguntas: PerguntaNoFluxo[] = [];
  for (const e of eventos ?? []) {
    const m = (e.metadata ?? {}) as { sessionId?: string; nodeId?: string; conversationId?: string; text?: string };
    const flow = e.flow_id ? porId.get(e.flow_id) : undefined;
    const node = ((flow?.nodes ?? []) as unknown as RawNode[]).find((n) => n.id === m.nodeId);

    let respondida = false;
    let pausado = false;
    if (m.conversationId) {
      const { data: depois } = await db
        .from("messages")
        .select("id")
        .eq("conversation_id", m.conversationId)
        .eq("direction", "outbound")
        .is("sent_by_flow_id", null)
        .gt("created_at", e.created_at)
        .limit(1);
      const { data: daCentral } = await db
        .from("central_dm_sends")
        .select("conversation_id")
        .eq("conversation_id", m.conversationId)
        .gt("created_at", e.created_at)
        .limit(1);
      respondida = (depois?.length ?? 0) > 0 || (daCentral?.length ?? 0) > 0;
      const { data: conv } = await db
        .from("conversations")
        .select("is_automation_paused")
        .eq("id", m.conversationId)
        .maybeSingle();
      pausado = conv?.is_automation_paused ?? false;
    }

    perguntas.push({
      em: e.created_at,
      conversa: m.conversationId ?? null,
      sessao: m.sessionId ?? null,
      fluxo: { id: e.flow_id, nome: flow?.name ?? "" },
      passo: { id: m.nodeId ?? null, mensagem: textoDoPasso(node) },
      digitou: String(m.text ?? ""),
      respondida,
      bot_pausado: pausado,
    });
  }
  return { geradoEm: new Date(now).toISOString(), dias, perguntas };
}
