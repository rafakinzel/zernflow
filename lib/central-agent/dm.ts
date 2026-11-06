import { messagingWindow } from "@/lib/flow-engine/messaging-window";

/**
 * The pure half of the Central's direct-message door: reading the query,
 * checking a reply before it goes out, telling who wrote each message, and
 * shaping what the routine is allowed to see.
 *
 * Nothing here talks to the database or to Zernio; `dm-store.ts` does, and
 * hands its rows to these functions.
 */

export const DIAS_PADRAO = 2;
export const DIAS_MAX = 60;
export const LIMITE_PADRAO = 50;
export const LIMITE_MAX = 200;
export const TEXTO_MAX = 1000;
export const CHAVE_MAX = 200;
/** The newest messages of each thread the routine gets back. */
export const MENSAGENS_POR_CONVERSA = 30;
/** How long a `chave` blocks a second send. */
export const CHAVE_VALIDA_MS = 24 * 60 * 60 * 1000;
/**
 * How far apart our record of a send and Zernio's copy of it may be.
 *
 * The engine writes its row after the send returns, Zernio stamps the
 * message when Instagram acknowledges it, and a queued job can sit for a
 * while in between. Ten minutes is generous for one send and still far
 * shorter than the gap between two different messages with the same text.
 */
export const CASAMENTO_MS = 10 * 60 * 1000;

/**
 * A refusal the routine can act on: a Portuguese sentence for whoever reads
 * the Central, a stable `motivo` for code, and the HTTP status.
 */
export class Recusa extends Error {
  constructor(
    readonly status: number,
    readonly motivo: string,
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function inteiro(raw: string | null, padrao: number, max: number, nome: string): number {
  if (raw === null || raw.trim() === "") return padrao;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Recusa(400, "parametro_invalido", `${nome} precisa ser um número inteiro de 1 a ${max}.`);
  }
  return Math.min(n, max);
}

/** `?dias=N&limite=M`, defaulted and capped. Above the cap is clamped, not refused. */
export function lerParametros(params: URLSearchParams): { dias: number; limite: number } {
  return {
    dias: inteiro(params.get("dias"), DIAS_PADRAO, DIAS_MAX, "dias"),
    limite: inteiro(params.get("limite"), LIMITE_PADRAO, LIMITE_MAX, "limite"),
  };
}

// ---------------------------------------------------------------------------
// The reply body
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PedidoResposta {
  conversa: string;
  texto: string;
  chave: string | null;
}

/**
 * Checks `{conversa, texto, chave?}`. Any other field is ignored: nothing
 * the routine sends can choose the account, the recipient or a message tag.
 */
export function validarPedido(body: unknown): PedidoResposta {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const conversa = typeof b.conversa === "string" ? b.conversa.trim() : "";
  if (!UUID.test(conversa)) {
    throw new Recusa(400, "conversa_invalida", "Mande o id da conversa (o campo id de GET /conversas) em conversa.");
  }

  if (typeof b.texto !== "string" || b.texto.trim() === "") {
    throw new Recusa(400, "texto_vazio", "O texto da resposta está vazio.");
  }
  const texto = b.texto.trim();
  // Counted in characters as a person counts them, so an emoji is one.
  const tamanho = Array.from(texto).length;
  if (tamanho > TEXTO_MAX) {
    throw new Recusa(
      400,
      "texto_longo",
      `O texto tem ${tamanho} caracteres; o máximo é ${TEXTO_MAX}.`
    );
  }

  let chave: string | null = null;
  if (b.chave !== undefined && b.chave !== null) {
    if (typeof b.chave !== "string" || b.chave.trim() === "" || b.chave.trim().length > CHAVE_MAX) {
      throw new Recusa(400, "chave_invalida", `chave precisa ser um texto de 1 a ${CHAVE_MAX} caracteres.`);
    }
    chave = b.chave.trim();
  }

  return { conversa, texto, chave };
}

// ---------------------------------------------------------------------------
// The 24-hour window
// ---------------------------------------------------------------------------

export interface Janela {
  aberta: boolean;
  /** When it closes (or closed); null without any record of the contact writing. */
  fechaEm: string | null;
}

/**
 * Meta's 24-hour window, read strictly.
 *
 * `messagingWindow` lets a send through when it has no record of the
 * person writing, because a flow refusing on missing data would invent a
 * failure. The Central is the other way round: it is answering someone, so
 * with no record of them writing there is nothing to answer, and the last
 * ten minutes (`closing`) count as closed, as they do for the engine.
 */
export function janelaDm(ultimaDoContato: string | null, now: Date = new Date()): Janela {
  if (!ultimaDoContato) return { aberta: false, fechaEm: null };
  const state = messagingWindow(ultimaDoContato, now);
  if (state.reason === "no_record") return { aberta: false, fechaEm: null };
  const fechaEm = new Date(now.getTime() + (state.remainingMs ?? 0)).toISOString();
  return { aberta: state.reason === "open", fechaEm };
}

/** The latest of several timestamps, ignoring the missing and the unparseable. */
export function maisRecente(...valores: Array<string | null | undefined>): string | null {
  let best: number | null = null;
  for (const v of valores) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

// ---------------------------------------------------------------------------
// Who wrote each message
// ---------------------------------------------------------------------------

export type Direcao = "contato" | "automacao" | "pessoa";

/** One message of a thread as Zernio returns it (see ProviderMessage). */
export interface MensagemDaConversa {
  id: string | null;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: unknown[] | null;
  platformMessageId: string | null;
  createdAt: string | null;
}

/** A send we have our own record of: a flow, a sequence, or the Central. */
export interface RegistroDeEnvio {
  platformMessageId: string | null;
  text: string | null;
  createdAt: string;
}

export interface MensagemSaida {
  direcao: Direcao;
  texto: string | null;
  em: string;
  /** Only on a "pessoa" message the Central sent through /responder. */
  central?: true;
  /** "image", "video", "audio", "file"…; the link itself is never returned. */
  anexo?: string;
}

function normalizar(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Same text, allowing for what Zernio adds or trims around a message with
 * buttons: one is the other, or begins it, when the shorter is long enough
 * that a coincidence is implausible.
 */
function mesmoTexto(a: string | null, b: string | null): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (x === y) return true;
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  return curto.length >= 20 && longo.startsWith(curto);
}

function tempo(at: string | null | undefined): number {
  if (!at) return NaN;
  return new Date(at).getTime();
}

/**
 * Finds the record a provider message is the copy of: by id first, then by
 * text and time. Each record is used once, so a flow that sent "Oi!" once
 * cannot claim two "Oi!"s.
 */
function casar(
  m: MensagemDaConversa,
  registros: RegistroDeEnvio[],
  usados: Set<number>
): boolean {
  const ids = [m.platformMessageId, m.id].filter((v): v is string => !!v);
  for (let i = 0; i < registros.length; i++) {
    if (usados.has(i)) continue;
    const r = registros[i];
    if (r.platformMessageId && ids.includes(r.platformMessageId)) {
      usados.add(i);
      return true;
    }
  }
  const at = tempo(m.createdAt);
  if (Number.isNaN(at)) return false;
  for (let i = 0; i < registros.length; i++) {
    if (usados.has(i)) continue;
    const r = registros[i];
    const rt = tempo(r.createdAt);
    if (Number.isNaN(rt) || Math.abs(rt - at) > CASAMENTO_MS) continue;
    if (mesmoTexto(m.text, r.text)) {
      usados.add(i);
      return true;
    }
  }
  return false;
}

function tipoDoAnexo(attachments: unknown[] | null): string | undefined {
  const first = attachments?.[0] as { type?: unknown } | undefined;
  if (!first) return undefined;
  return typeof first.type === "string" && first.type ? first.type : "arquivo";
}

/**
 * Labels each message of a thread, oldest first.
 *
 * - inbound → "contato".
 * - outbound that is the copy of a send the Central recorded → "pessoa",
 *   with `central: true` (a person approved it; the Central only typed it).
 * - outbound that is the copy of a send a flow, a sequence or an AI node
 *   recorded → "automacao". Every automated send writes its row in
 *   `messages` with `status: "sent"` right after Zernio accepts it.
 * - any other outbound → "pessoa". The inbox and the Instagram app keep no
 *   local copy of what they send, so "sent by us and not by any automation
 *   we know of" is how a human reply looks.
 *
 * Only what the routine may see comes out: text, time, who, attachment type.
 */
export function classificar(
  thread: MensagemDaConversa[],
  automacoes: RegistroDeEnvio[],
  central: RegistroDeEnvio[]
): MensagemSaida[] {
  const usadosCentral = new Set<number>();
  const usadosAuto = new Set<number>();

  const ordenadas = thread
    .filter((m) => !Number.isNaN(tempo(m.createdAt)))
    .sort((a, b) => tempo(a.createdAt) - tempo(b.createdAt));

  return ordenadas.map((m) => {
    const em = new Date(tempo(m.createdAt)).toISOString();
    const anexo = tipoDoAnexo(m.attachments);
    const base = { texto: m.text ?? null, em, ...(anexo ? { anexo } : {}) };
    if (m.direction === "inbound") return { direcao: "contato" as const, ...base };
    if (casar(m, central, usadosCentral)) return { direcao: "pessoa" as const, central: true as const, ...base };
    if (casar(m, automacoes, usadosAuto)) return { direcao: "automacao" as const, ...base };
    return { direcao: "pessoa" as const, ...base };
  });
}

/** A row of our own `messages` table, as the local fallback reads it. */
export interface LinhaLocal {
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: unknown;
  platform_message_id: string | null;
  sent_by_flow_id: string | null;
  status: string;
  created_at: string;
}

/**
 * Our own sends, from the `messages` table: the evidence `classificar`
 * matches against. A failed send never reached the person, and a
 * `delivered` outbound row is a copy the inbox backfill imported from
 * Zernio, which says nothing about who wrote it.
 */
export function automacoesDe(linhas: LinhaLocal[]): RegistroDeEnvio[] {
  return linhas
    .filter((l) => l.direction === "outbound" && l.status === "sent")
    .map((l) => ({ platformMessageId: l.platform_message_id, text: l.text, createdAt: l.created_at }));
}

/**
 * The thread rebuilt from our own table, for when Zernio could not be read.
 *
 * Inbound rows are complete since the webhook began storing them. Outbound
 * rows are the automated sends, plus whatever the backfill imported; a
 * person's reply sent after the last backfill is missing, which is why this
 * is only the fallback and the answer says `fonte: "local"`.
 */
export function threadLocal(linhas: LinhaLocal[]): MensagemDaConversa[] {
  const automaticas = linhas.filter((l) => l.direction === "outbound" && l.status === "sent");
  const usadas = new Set<number>();
  const registros = automacoesDe(automaticas);

  return linhas
    .filter((l) => l.status !== "failed" && l.status !== "pending")
    .filter((l) => {
      // A backfilled copy of an automated send would show the message twice.
      if (l.direction !== "outbound" || l.status === "sent") return true;
      return !casar(
        { id: null, direction: "outbound", text: l.text, attachments: null, platformMessageId: l.platform_message_id, createdAt: l.created_at },
        registros,
        usadas
      );
    })
    .map((l) => ({
      id: null,
      direction: l.direction,
      text: l.text,
      attachments: Array.isArray(l.attachments) ? (l.attachments as unknown[]) : null,
      platformMessageId: l.platform_message_id,
      createdAt: l.created_at,
    }));
}

// ---------------------------------------------------------------------------
// One conversation, as the routine sees it
// ---------------------------------------------------------------------------

export interface ConversaSaida {
  id: string;
  ultima_mensagem_em: string | null;
  ultima_do_contato_em: string | null;
  janela_aberta: boolean;
  janela_fecha_em: string | null;
  pausada: boolean;
  aguardando_resposta: boolean;
  tags: string[];
  fonte: "zernio" | "local";
  mensagens_omitidas: number;
  mensagens: MensagemSaida[];
}

/**
 * Builds the conversation the routine gets back.
 *
 * Takes only the fields it needs and builds a fresh object, so nothing
 * about the contact — username, name, avatar, phone, email, Instagram or
 * Zernio ids — can ride along: the only id that leaves is our own
 * `conversations.id`.
 */
export function montarConversa(params: {
  id: string;
  lastMessageAt: string | null;
  pausada: boolean;
  tags: string[];
  fonte: "zernio" | "local";
  mensagens: MensagemSaida[];
  ultimaInboundLocal: string | null;
  now?: Date;
}): ConversaSaida {
  const { mensagens } = params;
  const ultimaDoContato = maisRecente(
    params.ultimaInboundLocal,
    ...mensagens.filter((m) => m.direcao === "contato").map((m) => m.em)
  );
  const janela = janelaDm(ultimaDoContato, params.now);
  const ultima = mensagens[mensagens.length - 1];
  const recentes = mensagens.slice(-MENSAGENS_POR_CONVERSA);

  return {
    id: params.id,
    ultima_mensagem_em: maisRecente(params.lastMessageAt, ultima?.em),
    ultima_do_contato_em: ultimaDoContato,
    janela_aberta: janela.aberta,
    janela_fecha_em: janela.fechaEm,
    pausada: params.pausada,
    aguardando_resposta: ultima?.direcao === "contato",
    tags: [...new Set(params.tags)].sort(),
    fonte: params.fonte,
    mensagens_omitidas: mensagens.length - recentes.length,
    mensagens: recentes,
  };
}

/**
 * Why a reply cannot go out right now, or null when it can.
 *
 * Checked in this order, so the answer names the most fundamental reason:
 * a human has the conversation, the window is shut, or somebody already
 * answered the person's last message (a person, or the Central itself).
 */
export function motivoParaNaoResponder(params: {
  pausada: boolean;
  mensagens: MensagemSaida[];
  ultimaInboundLocal: string | null;
  enviosCentralDepois: number;
  now?: Date;
}): Recusa | null {
  if (params.pausada) {
    return new Recusa(
      409,
      "conversa_pausada",
      "A automação desta conversa está pausada porque alguém da equipe assumiu o atendimento. Quem responde agora é a pessoa; a Central não manda nada aqui."
    );
  }

  const ultimaDoContato = maisRecente(
    params.ultimaInboundLocal,
    ...params.mensagens.filter((m) => m.direcao === "contato").map((m) => m.em)
  );
  const janela = janelaDm(ultimaDoContato, params.now);
  if (!janela.aberta) {
    return new Recusa(
      409,
      "fora_da_janela",
      ultimaDoContato
        ? "Fora da janela de 24 horas do Instagram: a última mensagem da pessoa foi há mais de 24 horas (ou a janela fecha em menos de 10 minutos). Só dá para responder quando ela escrever de novo."
        : "Não há registro de mensagem desta pessoa, então não há janela de 24 horas aberta para responder."
    );
  }

  if (params.enviosCentralDepois > 0) {
    return new Recusa(409, "ja_respondida_pela_central", "A Central já respondeu esta pessoa depois da última mensagem dela.");
  }
  const t = tempo(ultimaDoContato);
  const depois = params.mensagens.filter((m) => m.direcao === "pessoa" && tempo(m.em) > t);
  if (depois.some((m) => m.central)) {
    return new Recusa(409, "ja_respondida_pela_central", "A Central já respondeu esta pessoa depois da última mensagem dela.");
  }
  if (depois.length > 0) {
    return new Recusa(
      409,
      "ja_respondida",
      "Alguém já respondeu esta pessoa (pelo inbox ou pelo app do Instagram) depois da última mensagem dela."
    );
  }
  return null;
}
