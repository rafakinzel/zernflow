/**
 * The comment-to-DM flow the Central TB prepares for one keyword.
 *
 * Same shape the builder produces when Rafa draws one by hand: a `trigger`
 * node of type `comment_keyword` wired to a `sendMessage` node. The engine
 * has no DM conversation yet when a comment arrives, so it delivers the
 * first bubble of that node as Instagram's private reply to the comment
 * (`sendFirstMessageAsPrivateReply` in lib/flow-engine/engine.ts). One
 * bubble, then, with the PDF link inside its text: a second bubble or a
 * button would not go out on a private reply.
 */

export const CENTRAL_CREATED_VIA = "central_agent";

/** What Rafa sees under the flow's name in the builder. */
export const CENTRAL_DESCRIPTION =
  "Criado pela equipe da Central TB, esperando a Rafa";

export type MatchType = "exact" | "contains" | "startsWith";

export interface CommentToDmInput {
  keyword: string;
  /** The DM text. `{{link}}` marks where the PDF link goes; otherwise it is appended. */
  message: string;
  pdfUrl: string;
  name?: string;
  matchType?: MatchType;
  /** Public replies under the comment, one picked at random per comment. */
  commentReplies?: string[];
}

export interface CommentToDmFlow {
  name: string;
  keyword: string;
  matchType: MatchType;
  dmText: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  triggerConfig: {
    keywords: Array<{ value: string; matchType: MatchType }>;
    replyTexts?: string[];
  };
}

/** Instagram cuts a DM at 1000 characters. */
const MAX_DM_LENGTH = 1000;
const MAX_KEYWORD_LENGTH = 40;

/**
 * The keyword as typed, without a leading `#`, for storing and showing.
 * Comparison goes through `keywordKey`.
 */
export function cleanKeyword(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim();
}

/** Case-insensitive, `#`-insensitive identity of a keyword. */
export function keywordKey(raw: string): string {
  return cleanKeyword(raw).toLowerCase();
}

export class InputError extends Error {}

/**
 * Builds the graph, or throws InputError with a reason the routine can act on.
 *
 * The default match is `exact`. The comment matcher lowercases the comment
 * and tests the keyword against it; with `contains`, a two-letter word like
 * `SS` would fire on "assim", "isso" and half of every comment section.
 */
export function buildCommentToDmFlow(input: CommentToDmInput): CommentToDmFlow {
  if (typeof input.keyword !== "string" || !cleanKeyword(input.keyword)) {
    throw new InputError("keyword é obrigatório.");
  }
  const keyword = cleanKeyword(input.keyword);
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw new InputError(`keyword passa de ${MAX_KEYWORD_LENGTH} caracteres.`);
  }

  if (typeof input.message !== "string" || !input.message.trim()) {
    throw new InputError("message é obrigatório.");
  }
  if (typeof input.pdfUrl !== "string" || !isHttpsUrl(input.pdfUrl)) {
    throw new InputError("pdfUrl precisa ser um link https.");
  }

  const matchType: MatchType = input.matchType ?? "exact";
  if (!["exact", "contains", "startsWith"].includes(matchType)) {
    throw new InputError("matchType precisa ser exact, contains ou startsWith.");
  }

  const message = input.message.trim();
  const dmText = message.includes("{{link}}")
    ? message.split("{{link}}").join(input.pdfUrl)
    : `${message}\n\n${input.pdfUrl}`;
  if (dmText.length > MAX_DM_LENGTH) {
    throw new InputError(
      `A mensagem com o link tem ${dmText.length} caracteres; o Instagram aceita ${MAX_DM_LENGTH}.`
    );
  }

  const commentReplies = Array.isArray(input.commentReplies)
    ? input.commentReplies
        .map((r) => (typeof r === "string" ? r.trim() : ""))
        .filter((r) => r.length > 0)
    : [];

  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : `Central TB · ${keyword}`;

  const stamp = Date.now();
  const triggerId = `node_${stamp}_central_trigger`;
  const messageId = `node_${stamp}_central_dm`;

  const nodes = [
    {
      id: triggerId,
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        triggerType: "comment_keyword",
        keywords: [{ value: keyword, matchType }],
        ...(commentReplies.length ? { commentReplies } : {}),
      },
    },
    {
      id: messageId,
      type: "sendMessage",
      position: { x: 320, y: 0 },
      data: { messages: [{ text: dmText }] },
    },
  ];

  const edges = [
    {
      id: `edge_${triggerId}_${messageId}`,
      source: triggerId,
      target: messageId,
      animated: true,
      style: { stroke: "var(--border)", strokeWidth: 2 },
    },
  ];

  return {
    name,
    keyword,
    matchType,
    dmText,
    nodes,
    edges,
    triggerConfig: {
      keywords: [{ value: keyword, matchType }],
      ...(commentReplies.length ? { replyTexts: commentReplies } : {}),
    },
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
