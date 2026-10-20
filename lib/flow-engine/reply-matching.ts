/**
 * Reading a typed reply against the buttons that were offered.
 *
 * People answer a question with words. Someone who types "sim quero" under
 * a button that says "Sim, é isso mesmo!" has answered, and sending them
 * down an "anything else" path, or asking them to press a button, is the
 * bot telling them it was not listening.
 *
 * Deliberately literal. It matches the words that are on the buttons and
 * nothing else: no guessing that "claro" means yes, no sentiment, no
 * synonyms. A wrong match walks someone down the wrong branch silently,
 * which is the failure this exists to prevent, so anything ambiguous
 * resolves to no match and is handled as a real message.
 */

export interface ReplyOption {
  payload: string;
  title?: string | null;
}

/** Lowercase, unaccented, punctuation-free, single-spaced. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Emoji and punctuation carry no answer; a button title often ends in one.
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words worth matching on, with the filler a title shares with every other. */
const FILLER = new Set([
  "a", "o", "as", "os", "de", "da", "do", "e", "em", "um", "uma",
  "que", "pra", "para", "com", "no", "na", "eu", "me", "isso", "mesmo",
  "the", "a", "of", "to", "and", "it",
]);

function meaningfulWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((word) => word.length > 1 && !FILLER.has(word));
}

/**
 * The button a typed reply answers, or null when it is a real message.
 *
 * Null is the useful answer as often as a match is: it means a person
 * wrote something the buttons do not cover, which is usually a question.
 */
export function matchTypedReply(
  text: string | null | undefined,
  options: ReplyOption[]
): string | null {
  if (!text?.trim()) return null;

  const typed = normalise(text);
  if (!typed) return null;

  const candidates = options.filter((o) => o.payload && o.title?.trim());
  if (candidates.length === 0) return null;

  // Exact, after normalising. "sim e isso mesmo" answers "Sim, é isso mesmo!".
  const exact = candidates.filter((o) => normalise(o.title!) === typed);
  if (exact.length === 1) return exact[0].payload;
  if (exact.length > 1) return null;

  // One contains the other: "quero marcar sim" answers "Quero marcar".
  //
  // The two directions are not symmetrical. A reply that contains the whole
  // title is an answer. A reply the title merely contains is only an answer
  // when it carries enough of its own: a bare "não" sits inside "Não consigo
  // agora" and means nothing on its own, since it could be refusing any of
  // the options.
  const typedWordCount = meaningfulWords(typed).length;
  const contained = candidates.filter((o) => {
    const title = normalise(o.title!);
    if (title.length <= 2) return false;
    if (typed.includes(title)) return true;
    return typedWordCount > 1 && title.includes(typed);
  });
  if (contained.length === 1) return contained[0].payload;
  if (contained.length > 1) return null;

  // Every meaningful word of a button title is present in what they typed.
  // "nao consigo agora nao" answers "Não consigo agora"; a bare "não" does
  // not, because one word shared with a title is not an answer.
  const typedWords = new Set(meaningfulWords(typed));
  const byWords = candidates.filter((o) => {
    const words = meaningfulWords(o.title!);
    return words.length > 1 && words.every((w) => typedWords.has(w));
  });
  if (byWords.length === 1) return byWords[0].payload;

  return null;
}

/**
 * Words that mean "go on" and nothing more specific.
 *
 * Read only where a node offers a single option, because there the list
 * cannot send anyone down a wrong branch: there is no other branch. A node
 * with a real choice never consults it, since deciding that "claro" means
 * the first button rather than the second is exactly the guess that walks
 * someone quietly into the wrong conversation.
 */
const ASSENT = new Set([
  "sim", "claro", "bora", "vamos", "vamo", "pode", "quero", "ok", "okay",
  "isso", "blz", "beleza", "certo", "fechou", "simm", "aham", "uhum", "top",
  "yes", "yep", "yeah", "sure", "ready", "go", "please",
]);

/** True when a reply says only "go on". */
function isAssent(text: string): boolean {
  const words = meaningfulWords(text);
  return words.length > 0 && words.length <= 3 && words.every((w) => ASSENT.has(w));
}

export interface ReplyResolution {
  /**
   * follow  — treat it as that button and take its exit.
   * human   — a real message at a decision point: stop and let a person reply.
   * passOn  — not a decision point, or the author drew their own catch-all.
   */
  kind: "follow" | "human" | "passOn";
  handle?: string;
}

/**
 * What to do with whatever just arrived on a node that was waiting.
 *
 * A tap is unambiguous and goes straight through. Typed text is read against
 * the buttons, and matching one means the person answered in words. Anything
 * else is a question, and the automation stops so a person can answer it,
 * unless the flow draws a catch-all exit and so says what it wants instead.
 */
export function resolveReply(input: {
  tappedPayload?: string | null;
  text?: string | null;
  /** The buttons the waiting node offered; empty for a free-text question. */
  options: ReplyOption[];
  /** True when the node has a "reply" exit drawn on the canvas. */
  hasCatchAll: boolean;
}): ReplyResolution {
  if (input.tappedPayload) {
    return { kind: "follow", handle: input.tappedPayload };
  }
  // A node with no buttons was asking an open question: an email, a name.
  // Any answer is the answer, and there is nothing to match against.
  if (input.options.length === 0) return { kind: "passOn" };

  const matched = matchTypedReply(input.text, input.options);
  if (matched) return { kind: "follow", handle: matched };

  // One option is not a choice, it is a "carry on", so a reply that means
  // carry on is an answer to it. A question still is not, and still goes to
  // a person.
  if (input.options.length === 1 && input.text && isAssent(input.text)) {
    return { kind: "follow", handle: input.options[0].payload };
  }

  return input.hasCatchAll ? { kind: "passOn" } : { kind: "human" };
}
