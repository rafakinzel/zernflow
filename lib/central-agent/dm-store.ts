import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createMessagingProvider, type MessagingProvider } from "@/lib/messaging";
import { messagePreview } from "@/lib/message-preview";
import {
  CHAVE_VALIDA_MS,
  Recusa,
  automacoesDe,
  classificar,
  maisRecente,
  montarConversa,
  motivoParaNaoResponder,
  threadLocal,
  type ConversaSaida,
  type LinhaLocal,
  type MensagemDaConversa,
  type PedidoResposta,
  type RegistroDeEnvio,
} from "./dm";

/**
 * The Central's direct-message door: read recent Instagram conversations,
 * and send a reply Rafa or Thiago approved.
 *
 * Kept apart from `store.ts` on purpose. That file can only prepare a
 * switched-off draft; this one sends a real message to a real person, so its
 * reach is spelled out and held by a test that reads the source
 * (central-agent.test.ts, "the DM door"): it reads conversations, messages,
 * contact tags and its own `central_dm_sends`; it writes only
 * `central_dm_sends` and, like the inbox does after a send, the
 * conversation's `last_message_at` and `last_message_preview`. It never
 * touches flows, triggers, contacts or the automation pause, and never sends
 * with the human-agent tag.
 */

type Db = SupabaseClient<Database>;
type ProviderFactory = (storedApiKey: string) => MessagingProvider;

/** Zernio calls in flight at once while listing. */
const CONCORRENCIA = 4;
/** After this, the remaining threads come from our own table. */
const ORCAMENTO_ZERNIO_MS = 40_000;
/** Our own rows read per conversation to recognise automated sends. */
const LINHAS_LOCAIS = 300;

interface ConversaRow {
  id: string;
  contact_id: string;
  platform: string;
  late_conversation_id: string | null;
  last_message_at: string | null;
  is_automation_paused: boolean;
  channels: { late_account_id: string | null } | null;
}

async function chaveDoWorkspace(db: Db, workspaceId: string): Promise<string | null> {
  const { data, error } = await db
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.late_api_key_encrypted ?? null;
}

async function linhasLocais(db: Db, conversationId: string): Promise<LinhaLocal[]> {
  const { data, error } = await db
    .from("messages")
    .select("direction, text, attachments, platform_message_id, sent_by_flow_id, status, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(LINHAS_LOCAIS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as LinhaLocal[]).reverse();
}

function ultimaInbound(linhas: LinhaLocal[]): string | null {
  return maisRecente(...linhas.filter((l) => l.direction === "inbound").map((l) => l.created_at));
}

interface EnvioCentral {
  conversation_id: string;
  texto: string;
  platform_message_id: string | null;
  created_at: string;
  enviado_em: string | null;
}

/**
 * What the Central has sent (or is sending) in these conversations. An
 * unreadable table, before the migration runs, is an empty list and a
 * warning, never a failed listing.
 */
async function enviosCentral(
  db: Db,
  conversationIds: string[]
): Promise<{ envios: EnvioCentral[]; ok: boolean }> {
  if (conversationIds.length === 0) return { envios: [], ok: true };
  const { data, error } = await db
    .from("central_dm_sends")
    .select("conversation_id, texto, platform_message_id, created_at, enviado_em")
    .in("conversation_id", conversationIds)
    .in("status", ["enviando", "enviado"]);
  if (error) return { envios: [], ok: false };
  return { envios: (data ?? []) as EnvioCentral[], ok: true };
}

function registrosCentral(envios: EnvioCentral[], conversationId: string): RegistroDeEnvio[] {
  return envios
    .filter((e) => e.conversation_id === conversationId)
    .map((e) => ({
      platformMessageId: e.platform_message_id,
      text: e.texto,
      createdAt: e.enviado_em ?? e.created_at,
    }));
}

async function tagsPorContato(db: Db, contactIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (contactIds.length === 0) return map;
  const { data, error } = await db
    .from("contact_tags")
    .select("contact_id, tags(name)")
    .in("contact_id", contactIds);
  // Tags are a nicety; a failure here leaves them empty rather than failing the list.
  if (error) return map;
  for (const row of (data ?? []) as Array<{ contact_id: string; tags: { name: string } | null }>) {
    if (!row.tags?.name) continue;
    map.set(row.contact_id, [...(map.get(row.contact_id) ?? []), row.tags.name]);
  }
  return map;
}

function rateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate.?limit|429|too many/i.test(message);
}

export interface ListaConversas {
  geradoEm: string;
  dias: number;
  limite: number;
  conversas: ConversaSaida[];
  avisos: string[];
}

/**
 * Recent Instagram DM conversations, newest first, with their messages.
 *
 * Which conversations: ours, from `conversations.last_message_at`, which the
 * webhook moves on every message the person sends. The thread itself comes
 * from Zernio, the source of truth the inbox also reads, because it is the
 * only place a reply typed in the inbox or the Instagram app exists. Our
 * `messages` table supplies the automated sends to tell them apart, and is
 * the whole thread when Zernio cannot be read (rate limit, time budget).
 */
export async function listarConversas(
  db: Db,
  workspaceId: string,
  opts: { dias: number; limite: number; now?: Date; provider?: ProviderFactory }
): Promise<ListaConversas> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.dias * 24 * 60 * 60 * 1000).toISOString();
  const avisos: string[] = [];

  const { data, error } = await db
    .from("conversations")
    .select("id, contact_id, platform, late_conversation_id, last_message_at, is_automation_paused, channels(late_account_id)")
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false })
    .limit(opts.limite);
  if (error) throw new Error(error.message);
  const conversas = (data ?? []) as unknown as ConversaRow[];

  const [tags, central, apiKey] = await Promise.all([
    tagsPorContato(db, [...new Set(conversas.map((c) => c.contact_id))]),
    enviosCentral(db, conversas.map((c) => c.id)),
    chaveDoWorkspace(db, workspaceId),
  ]);
  if (!central.ok) {
    avisos.push("Não consegui ler central_dm_sends (a migração 00027 rodou?): as respostas da Central aparecem como pessoa, sem central: true.");
  }

  const messaging = apiKey ? (opts.provider ?? createMessagingProvider)(apiKey) : null;
  if (!messaging) avisos.push("Workspace sem chave do Zernio: mensagens só do registro local.");

  const startedAt = Date.now();
  let parado: string | null = null;
  const saida: ConversaSaida[] = new Array(conversas.length);
  let next = 0;

  const worker = async () => {
    while (next < conversas.length) {
      const i = next++;
      const c = conversas[i];
      const locais = await linhasLocais(db, c.id);

      let thread: MensagemDaConversa[] | null = null;
      const accountId = c.channels?.late_account_id;
      if (messaging && accountId && c.late_conversation_id && !parado) {
        if (Date.now() - startedAt > ORCAMENTO_ZERNIO_MS) {
          parado = "tempo";
        } else {
          try {
            thread = await messaging.getConversationMessages({
              accountId,
              conversationId: c.late_conversation_id,
            });
          } catch (err) {
            if (rateLimit(err)) parado = "limite";
            thread = null;
          }
        }
      }

      const fonte = thread ? "zernio" : "local";
      const mensagens = classificar(
        thread ?? threadLocal(locais),
        automacoesDe(locais),
        registrosCentral(central.envios, c.id)
      );

      saida[i] = montarConversa({
        id: c.id,
        lastMessageAt: c.last_message_at,
        pausada: c.is_automation_paused,
        tags: tags.get(c.contact_id) ?? [],
        fonte,
        mensagens,
        ultimaInboundLocal: ultimaInbound(locais),
        now,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, conversas.length) }, worker));

  if (parado === "limite") avisos.push("O Zernio limitou as chamadas: parte das conversas veio do registro local (fonte: local), que não tem as respostas dadas à mão depois da última importação.");
  if (parado === "tempo") avisos.push("Tempo esgotado lendo o Zernio: parte das conversas veio do registro local (fonte: local). Peça menos conversas (limite) para ter todas do Zernio.");
  if (saida.some((c) => c.fonte === "local") && !parado && messaging) {
    avisos.push("Algumas conversas não puderam ser lidas no Zernio e vieram do registro local (fonte: local).");
  }

  return { geradoEm: now.toISOString(), dias: opts.dias, limite: opts.limite, conversas: saida, avisos };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function tabelaFaltando(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /central_dm_sends/.test(error.message ?? "");
}

const MIGRACAO_PENDENTE = new Recusa(
  503,
  "migracao_pendente",
  "A tabela central_dm_sends não existe: rode a migração 00027_central_dm_sends.sql no Supabase antes de responder pela Central."
);

/**
 * Reserves the send before it happens: the row is the idempotency lock.
 *
 * A `chave` already used in the last 24 hours is refused, unless that send
 * failed, in which case it may be retried. A send that is still `enviando`
 * (the call died mid-way) is refused too: whether it reached the person is
 * unknown, and answering twice is worse than not at all.
 */
async function reservar(
  db: Db,
  workspaceId: string,
  pedido: PedidoResposta,
  now: Date
): Promise<string> {
  const row = {
    workspace_id: workspaceId,
    conversation_id: pedido.conversa,
    chave: pedido.chave,
    texto: pedido.texto,
    status: "enviando" as const,
    created_at: now.toISOString(),
  };
  const { data, error } = await db.from("central_dm_sends").insert(row).select("id").single();
  if (!error && data) return data.id;
  if (!error) throw new Error("Não consegui reservar o envio.");
  if (error.code !== "23505") {
    if (tabelaFaltando(error)) throw MIGRACAO_PENDENTE;
    throw new Error(error.message);
  }

  const repetida = new Recusa(
    409,
    "chave_repetida",
    "Esta chave já foi usada num envio nas últimas 24 horas; a mensagem não foi mandada de novo."
  );
  const { data: existing, error: readError } = await db
    .from("central_dm_sends")
    .select("id, status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("chave", pedido.chave!)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing) throw repetida;

  const vencida = now.getTime() - new Date(existing.created_at).getTime() > CHAVE_VALIDA_MS;
  if (existing.status !== "falhou" && !vencida) throw repetida;

  // Conditional on the row being exactly as read, so two retries racing for
  // the same key cannot both win it.
  const { data: claimed, error: claimError } = await db
    .from("central_dm_sends")
    .update({
      conversation_id: pedido.conversa,
      texto: pedido.texto,
      status: "enviando",
      created_at: now.toISOString(),
      erro: null,
      platform_message_id: null,
      enviado_em: null,
    })
    .eq("id", existing.id)
    .eq("status", existing.status)
    .eq("created_at", existing.created_at)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length !== 1) throw repetida;
  return existing.id;
}

export interface RespostaEnviada {
  enviado: true;
  conversa: string;
  envio: string;
  chave: string | null;
  em: string;
}

/**
 * Sends one approved reply in one conversation, or says why not.
 *
 * The send is the inbox's own: the same provider call on the same Zernio
 * conversation, as plain text and never with the human-agent tag (the
 * Central only answers inside the 24-hour window, where no tag is needed).
 */
export async function responder(
  db: Db,
  workspaceId: string,
  pedido: PedidoResposta,
  opts: { now?: Date; provider?: ProviderFactory } = {}
): Promise<RespostaEnviada> {
  const now = opts.now ?? new Date();

  const { data, error } = await db
    .from("conversations")
    .select("id, contact_id, platform, late_conversation_id, last_message_at, is_automation_paused, channels(late_account_id)")
    .eq("id", pedido.conversa)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const conversa = data as unknown as ConversaRow | null;
  if (!conversa) throw new Recusa(404, "conversa_nao_encontrada", "Conversa não encontrada neste workspace.");
  if (conversa.platform !== "instagram") {
    throw new Recusa(400, "nao_e_instagram", "A Central só responde conversas do direct do Instagram.");
  }
  // First, before anything is read from Zernio: a conversation a person has
  // taken over is theirs, whatever the window says.
  if (conversa.is_automation_paused) {
    throw motivoParaNaoResponder({ pausada: true, mensagens: [], ultimaInboundLocal: null, enviosCentralDepois: 0, now })!;
  }

  const accountId = conversa.channels?.late_account_id;
  if (!accountId || !conversa.late_conversation_id) {
    throw new Recusa(409, "sem_conversa_no_zernio", "Esta conversa não está ligada a uma conversa do Zernio; responda pelo inbox.");
  }
  const apiKey = await chaveDoWorkspace(db, workspaceId);
  if (!apiKey) throw new Recusa(409, "sem_chave_zernio", "O workspace está sem a chave do Zernio.");
  const messaging = (opts.provider ?? createMessagingProvider)(apiKey);

  const locais = await linhasLocais(db, conversa.id);
  let thread: MensagemDaConversa[];
  try {
    thread = await messaging.getConversationMessages({ accountId, conversationId: conversa.late_conversation_id });
  } catch {
    throw new Recusa(
      502,
      "zernio_indisponivel",
      "Não consegui ler a conversa no Zernio para conferir se alguém já respondeu; nada foi enviado. Tente de novo em alguns minutos."
    );
  }

  const { data: envios, error: enviosError } = await db
    .from("central_dm_sends")
    .select("conversation_id, texto, platform_message_id, created_at, enviado_em")
    .eq("conversation_id", conversa.id)
    .in("status", ["enviando", "enviado"]);
  if (enviosError) {
    if (tabelaFaltando(enviosError)) throw MIGRACAO_PENDENTE;
    throw new Error(enviosError.message);
  }
  const doCentral = (envios ?? []) as EnvioCentral[];

  const mensagens = classificar(thread, automacoesDe(locais), registrosCentral(doCentral, conversa.id));
  const ultimaInboundLocal = ultimaInbound(locais);
  const ultimaDoContato = maisRecente(
    ultimaInboundLocal,
    ...mensagens.filter((m) => m.direcao === "contato").map((m) => m.em)
  );
  const desde = ultimaDoContato ? new Date(ultimaDoContato).getTime() : Infinity;
  const enviosCentralDepois = doCentral.filter(
    (e) => new Date(e.enviado_em ?? e.created_at).getTime() > desde
  ).length;

  const recusa = motivoParaNaoResponder({
    pausada: conversa.is_automation_paused,
    mensagens,
    ultimaInboundLocal,
    enviosCentralDepois,
    now,
  });
  if (recusa) throw recusa;

  const envioId = await reservar(db, workspaceId, pedido, now);

  let messageId: string | null;
  try {
    ({ messageId } = await messaging.sendMessage({
      accountId,
      conversationId: conversa.late_conversation_id,
      message: { text: pedido.texto },
    }));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await db
      .from("central_dm_sends")
      .update({ status: "falhou", erro: motivo.slice(0, 500) })
      .eq("id", envioId);
    throw new Recusa(502, "envio_falhou", `O Zernio recusou o envio: ${motivo.slice(0, 300)}`);
  }

  const em = new Date().toISOString();
  await db
    .from("central_dm_sends")
    .update({ status: "enviado", platform_message_id: messageId, enviado_em: em })
    .eq("id", envioId);

  // What the inbox does after its own send, and nothing more.
  await db
    .from("conversations")
    .update({ last_message_at: em, last_message_preview: messagePreview(pedido.texto) })
    .eq("id", conversa.id)
    .eq("workspace_id", workspaceId);

  return { enviado: true, conversa: conversa.id, envio: envioId, chave: pedido.chave, em };
}
