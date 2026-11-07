import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TriggerType } from "@/lib/types/database";
import {
  CENTRAL_CREATED_VIA,
  CENTRAL_DESCRIPTION,
  InputError,
  buildCommentToDmFlow,
  cleanKeyword,
  keywordKey,
  type CommentToDmInput,
} from "./flow-template";
import { checarPalavra, type Conflito } from "./mapa";

/**
 * Everything the Central TB's routines can do to the database.
 *
 * The list is short on purpose and the tests hold it to that: read flows and
 * triggers, insert a draft flow with a switched-off trigger, upload a PDF.
 * Nothing here updates a row, publishes, or switches a trigger on. Going
 * live stays with Rafa, who publishes in the builder; publishing rebuilds the
 * flow's triggers from its nodes, active, which is the only path by which a
 * flow made here ever answers a comment.
 *
 * A comment fires a flow only when its trigger is active *and* the flow is
 * published (lib/comment-processor.ts), so a draft with an inactive trigger
 * is off twice over.
 */

type Db = SupabaseClient<Database>;

export const ISCAS_BUCKET = "iscas";
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const REELS_BUCKET = "reels";

export class ConflictError extends Error {
  constructor(
    message: string,
    readonly existing: KeywordEntry[],
    readonly conflitos: Conflito[] = []
  ) {
    super(message);
  }
}

export class NotFoundError extends Error {}

export interface KeywordEntry {
  keyword: string;
  /** `comment_keyword` for comments, `keyword` for DMs. */
  type: string;
  flowId: string;
  flowName: string;
  flowStatus: string;
  /** Null when the keyword lives only in a draft's node, with no trigger row yet. */
  triggerActive: boolean | null;
  /** Answers today: trigger active and flow published. */
  live: boolean;
  createdByCentral: boolean;
  source: "trigger" | "flow_node";
  /** Each way a comment can set it off, as stored: `{ value: "#SS", matchType: "contains" }`. */
  matches: KeywordMatch[];
  /** Set when a match is loose enough to fire on comments that never asked. */
  warning?: string;
}

export interface KeywordMatch {
  value: string;
  matchType: string;
}

/**
 * A short bare word matched anywhere in the comment fires on ordinary
 * words: `contains` on "ss" catches "assim" and "isso". A hashtag is
 * deliberate, so it is not flagged.
 */
function looseMatchWarning(matches: KeywordMatch[]): string | undefined {
  const loose = matches.find(
    (m) =>
      !m.value.startsWith("#") &&
      m.matchType !== "exact" &&
      cleanKeyword(m.value).length <= 3
  );
  if (!loose) return undefined;
  return `"${loose.value}" com ${loose.matchType} dispara em qualquer comentário que tenha essas letras dentro de outra palavra.`;
}

const KEYWORD_TRIGGER_TYPES: TriggerType[] = ["comment_keyword", "keyword"];

/**
 * The workspace the routines act on.
 *
 * `CENTRAL_AGENT_WORKSPACE_ID` when set; otherwise the only workspace there
 * is. With more than one and no variable, refuse: guessing would put a flow
 * in somebody else's account.
 */
export async function resolveWorkspaceId(db: Db): Promise<string> {
  const configured = process.env.CENTRAL_AGENT_WORKSPACE_ID?.trim();
  if (configured) return configured;

  const { data, error } = await db.from("workspaces").select("id").limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) {
    throw new Error(
      "Mais de um workspace (ou nenhum): defina CENTRAL_AGENT_WORKSPACE_ID."
    );
  }
  return data[0].id;
}

/**
 * Every keyword the workspace already answers to, or is about to.
 *
 * Two sources, because a flow that was never published has its keyword only
 * in its trigger node: the `triggers` rows are written at publish time. A
 * routine checking "does SS exist?" against the rows alone would miss a
 * draft Rafa is halfway through and make a second one.
 */
export async function listKeywords(db: Db, workspaceId: string): Promise<KeywordEntry[]> {
  const { data: flows, error: flowsError } = await db
    .from("flows")
    .select("id, name, status, nodes, created_via")
    .eq("workspace_id", workspaceId);
  if (flowsError) throw new Error(flowsError.message);

  const flowById = new Map((flows ?? []).map((f) => [f.id, f]));
  const flowIds = [...flowById.keys()];

  const { data: triggers, error: triggersError } = flowIds.length
    ? await db
        .from("triggers")
        .select("id, flow_id, type, config, is_active")
        .in("flow_id", flowIds)
        .in("type", KEYWORD_TRIGGER_TYPES)
    : { data: [], error: null };
  if (triggersError) throw new Error(triggersError.message);

  // One entry per keyword, kind and flow; "SS" and "#SS" on the same
  // trigger are one keyword asked for two ways, gathered into `matches`.
  const entries = new Map<string, KeywordEntry>();
  const add = (entry: Omit<KeywordEntry, "matches" | "warning">, match: KeywordMatch) => {
    const id = `${keywordKey(entry.keyword)}|${entry.type}|${entry.flowId}`;
    const existing = entries.get(id);
    if (existing) {
      // A published flow has both a node and a trigger row; the row is what
      // runs, so the node only adds what the row lacks.
      if (existing.source !== entry.source && existing.source === "trigger") return;
      if (!existing.matches.some((m) => m.value === match.value && m.matchType === match.matchType)) {
        existing.matches.push(match);
      }
      return;
    }
    entries.set(id, { ...entry, matches: [match] });
  };

  for (const t of triggers ?? []) {
    const flow = flowById.get(t.flow_id);
    if (!flow) continue;
    for (const match of keywordsOf(t.config)) {
      add({
        keyword: cleanKeyword(match.value),
        type: t.type,
        flowId: flow.id,
        flowName: flow.name,
        flowStatus: flow.status,
        triggerActive: t.is_active,
        live: t.is_active && flow.status === "published",
        createdByCentral: flow.created_via === CENTRAL_CREATED_VIA,
        source: "trigger",
      }, match);
    }
  }

  for (const flow of flows ?? []) {
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, any>>) : [];
    for (const node of nodes) {
      if (node?.type !== "trigger") continue;
      const data = node.data ?? {};
      const type = data.triggerType ?? "keyword";
      if (!KEYWORD_TRIGGER_TYPES.includes(type as TriggerType)) continue;
      const fromNode = [
        ...keywordsOf({ keywords: data.keywords }),
        ...keywordsOf({ keywords: data.config?.keywords }),
      ];
      for (const match of fromNode) {
        add({
          keyword: cleanKeyword(match.value),
          type,
          flowId: flow.id,
          flowName: flow.name,
          flowStatus: flow.status,
          triggerActive: null,
          live: false,
          createdByCentral: flow.created_via === CENTRAL_CREATED_VIA,
          source: "flow_node",
        }, match);
      }
    }
  }

  return [...entries.values()]
    .map((e) => {
      const warning = looseMatchWarning(e.matches);
      return warning ? { ...e, warning } : e;
    })
    .sort((a, b) => keywordKey(a.keyword).localeCompare(keywordKey(b.keyword)));
}

/**
 * Keywords come as `[{ value, matchType }]` from the builder and `[string]`
 * from templates. A missing matchType is `contains`, the comment matcher's
 * own default, so the list reports what will actually happen.
 */
function keywordsOf(config: Json | undefined): KeywordMatch[] {
  const list = (config as { keywords?: unknown } | null)?.keywords;
  const configType = (config as { matchType?: unknown } | null)?.matchType;
  if (!Array.isArray(list)) return [];
  return list
    .map((k) =>
      typeof k === "string"
        ? { value: k, matchType: typeof configType === "string" ? configType : "contains" }
        : {
            value: (k as { value?: unknown })?.value,
            matchType: (k as { matchType?: unknown })?.matchType ?? configType ?? "contains",
          }
    )
    .filter(
      (k): k is KeywordMatch =>
        typeof k.value === "string" && cleanKeyword(k.value).length > 0 && typeof k.matchType === "string"
    )
    .map((k) => ({ value: k.value.trim(), matchType: k.matchType }));
}

export interface CreatedDraft {
  flowId: string;
  triggerId: string;
  name: string;
  keyword: string;
  keywords: KeywordMatch[];
  dmText: string;
  status: "draft";
  triggerActive: false;
  /** The live flow this one invites the person on to, when asked. */
  levaPara?: { palavra: string; flowId: string; flowNome: string };
}

/**
 * Inserts a draft flow and its switched-off trigger for one keyword.
 *
 * Refuses when the keyword exists anywhere in the workspace, in any flow,
 * live or not: two flows on one keyword race for the same comment, and the
 * routine is not the one to decide which should win.
 *
 * Only inserts. This touches no existing row, so the snapshot and
 * `updated_at` guard CLAUDE.md asks of writes to a live flow have nothing to
 * protect here. The one delete is the undo of this same call's own insert,
 * when the trigger could not be written: a flow with a keyword in its node
 * and no trigger row would still block the keyword and confuse the list.
 */
export async function createDraftFlow(
  db: Db,
  workspaceId: string,
  input: CommentToDmInput
): Promise<CreatedDraft> {
  const built = buildCommentToDmFlow(input);

  // Same word, or one that would fire alongside an existing comment keyword
  // (either way round), is refused: the person would get the wrong DM, or two.
  const all = await listKeywords(db, workspaceId);
  const check = checarPalavra(built.keyword, all, input.levaPara);
  if (check.conflitos.length > 0) {
    const same = check.conflitos.every((c) => c.motivo === "mesma palavra");
    throw new ConflictError(
      same
        ? `A palavra "${built.keyword}" já tem gatilho.`
        : `A palavra "${built.keyword}" conflita com flows que já existem.`,
      all.filter((e) => check.conflitos.some((c) => c.flowId === e.flowId && keywordKey(c.palavra) === keywordKey(e.keyword))),
      check.conflitos
    );
  }
  let levaPara: CreatedDraft["levaPara"];
  if (check.levaPara) {
    if ("erro" in check.levaPara) throw new InputError(check.levaPara.erro);
    // The comment flow can only hand someone on in words: Instagram allows one
    // private reply per comment, text only, so the DM has to invite them to
    // send the other flow's keyword.
    if (!built.dmText.toLowerCase().includes(check.levaPara.palavra.toLowerCase())) {
      throw new InputError(
        `Para levar a pessoa ao flow "${check.levaPara.flowNome}", a mensagem precisa convidar a mandar ${check.levaPara.palavra} no direct.`
      );
    }
    levaPara = check.levaPara;
  }

  const { data: flow, error: flowError } = await db
    .from("flows")
    .insert({
      workspace_id: workspaceId,
      name: built.name,
      description: CENTRAL_DESCRIPTION,
      created_via: CENTRAL_CREATED_VIA,
      status: "draft",
      nodes: built.nodes as Json,
      edges: built.edges as Json,
    })
    .select("id")
    .single();
  if (flowError || !flow) throw new Error(flowError?.message ?? "Could not create the flow.");

  const { data: trigger, error: triggerError } = await db
    .from("triggers")
    .insert({
      flow_id: flow.id,
      channel_id: null,
      type: "comment_keyword",
      config: built.triggerConfig as Json,
      is_active: false,
      priority: 0,
    })
    .select("id")
    .single();

  if (triggerError || !trigger) {
    await db
      .from("flows")
      .delete()
      .eq("id", flow.id)
      .eq("created_via", CENTRAL_CREATED_VIA)
      .eq("status", "draft");
    throw new Error(triggerError?.message ?? "Could not create the trigger.");
  }

  return {
    flowId: flow.id,
    triggerId: trigger.id,
    name: built.name,
    keyword: built.keyword,
    keywords: built.keywords,
    dmText: built.dmText,
    status: "draft",
    triggerActive: false,
    ...(levaPara ? { levaPara } : {}),
  };
}

export type AgentFlowState =
  | "esperando_rafa"
  | "ativo"
  | "publicado_sem_gatilho_ativo"
  | "arquivado";

/** Where a flow made by the routines stands: still off, or switched on by Rafa. */
export async function getAgentFlowState(db: Db, workspaceId: string, flowId: string) {
  if (!UUID.test(flowId)) throw new NotFoundError("Flow não encontrado.");

  const { data: flow, error } = await db
    .from("flows")
    .select("id, name, status, version, published_at, updated_at, created_via")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .eq("created_via", CENTRAL_CREATED_VIA)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!flow) throw new NotFoundError("Flow não encontrado entre os criados pela Central.");

  const { data: triggers, error: triggersError } = await db
    .from("triggers")
    .select("id, type, config, is_active")
    .eq("flow_id", flowId);
  if (triggersError) throw new Error(triggersError.message);

  const commentTriggers = (triggers ?? []).filter((t) => t.type === "comment_keyword");
  const anyActive = commentTriggers.some((t) => t.is_active);

  const state: AgentFlowState =
    flow.status === "archived"
      ? "arquivado"
      : flow.status === "published"
        ? anyActive
          ? "ativo"
          : "publicado_sem_gatilho_ativo"
        : "esperando_rafa";

  return {
    flowId: flow.id,
    name: flow.name,
    status: flow.status,
    state,
    live: state === "ativo",
    version: flow.version,
    publishedAt: flow.published_at,
    updatedAt: flow.updated_at,
    keywords: commentTriggers.flatMap((t) => keywordsOf(t.config)),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A storage path that will not collide and reads sensibly in a URL. */
export function iscaPath(fileName: string, now = new Date()): string {
  const base = fileName
    .replace(/\.pdf$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "isca";
  const month = now.toISOString().slice(0, 7);
  return `${month}/${now.getTime()}-${base}.pdf`;
}

/** Uploads a PDF sent in the request and returns its public link. */
export async function uploadIsca(db: Db, file: { name: string; bytes: Uint8Array }) {
  if (file.bytes.byteLength === 0) throw new InputError("O arquivo está vazio.");
  if (file.bytes.byteLength > MAX_PDF_BYTES) {
    throw new InputError("O PDF passa de 50 MB.");
  }
  if (!isPdf(file.bytes)) throw new InputError("O arquivo não é um PDF.");

  const path = iscaPath(file.name);
  const { error } = await db.storage
    .from(ISCAS_BUCKET)
    .upload(path, file.bytes, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from(ISCAS_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * A one-time upload address for a PDF too big to pass through us.
 *
 * Vercel refuses a request body over about 4.5 MB, and a lead magnet with
 * photos is often bigger. The routine sends the file straight to storage on
 * this address; the public link is known in advance.
 */
export async function createIscaUploadUrl(db: Db, fileName: string) {
  if (!fileName?.trim()) throw new InputError("fileName é obrigatório.");
  const path = iscaPath(fileName);
  const { data, error } = await db.storage
    .from(ISCAS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create the upload URL.");

  const { data: pub } = db.storage.from(ISCAS_BUCKET).getPublicUrl(path);
  return { path, uploadUrl: data.signedUrl, publicUrl: pub.publicUrl };
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-"
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Where a finished Reel goes in the `reels` bucket: month folder, a
 * timestamp so nothing is ever overwritten, and a slug of the name.
 */
export function reelPath(fileName: string, now = new Date()): string {
  const base = fileName
    .replace(/\.mp4$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "reel";
  const month = now.toISOString().slice(0, 7);
  return `${month}/${now.getTime()}-${base}.mp4`;
}

/** A path this API handed out, and nothing else (no `..`, no other folder). */
export function isReelPath(path: string): boolean {
  return /^\d{4}-\d{2}\/\d+-[a-z0-9-]+\.mp4$/.test(path);
}

/**
 * A one-time upload address for a finished Reel. Videos are always bigger
 * than the ~4.5 MB Vercel lets through, so the routine PUTs the MP4 straight
 * to Storage; the public link is known in advance.
 */
export async function createReelUploadUrl(db: Db, fileName: string) {
  if (!fileName?.trim()) throw new InputError("fileName é obrigatório.");
  const path = reelPath(fileName);
  const { data, error } = await db.storage
    .from(REELS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create the upload URL.");

  const { data: pub } = db.storage.from(REELS_BUCKET).getPublicUrl(path);
  return { path, uploadUrl: data.signedUrl, publicUrl: pub.publicUrl };
}

/** Removes a Reel once it is out on Instagram. */
export async function deleteReel(db: Db, path: string) {
  if (!isReelPath(path ?? "")) throw new InputError("path inválido.");
  const { error } = await db.storage.from(REELS_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
  return { path, apagado: true };
}
