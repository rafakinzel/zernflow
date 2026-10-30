/**
 * Whether a message is somebody deliberately asking for the bot again.
 *
 * A conversation handed to a person stops the automation, and nothing short
 * of this restarts it. That gate used to sit in front of trigger matching
 * too, so a contact who was told "write #FA here and you'll get the
 * information" wrote it and got silence: the keyword never reached the
 * matcher. It cost a real lead who had just said she wanted to hire.
 *
 * The hash is what carries the intent. Nobody types "#FA" by accident, so
 * it counts anywhere in the message, with whatever else they wrote around
 * it: "oi, me manda o #FA por favor" is the same request as "#FA" alone.
 *
 * A keyword without a hash is a different matter. "rd" or "fa" are ordinary
 * letters that fall inside ordinary words and sentences, and a paused
 * conversation has a person in it who should not be talked over, so those
 * restart only when the message is nothing else.
 */

/** Lowercase, unaccented, trimmed, with punctuation and emoji removed. */
export function bareWords(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface KeywordOption {
  value?: string | null;
}

/** The hashtag anywhere in the text, not glued to a longer word. */
function mentionsHashtag(text: string, tag: string): boolean {
  const plain = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const needle = `#${tag}`;

  let from = 0;
  for (;;) {
    const at = plain.indexOf(needle, from);
    if (at === -1) return false;
    // "#fa" must not answer for "#fabuloso": the next character has to end
    // the word.
    const after = plain[at + needle.length];
    if (after === undefined || !/[\p{Letter}\p{Number}]/u.test(after)) return true;
    from = at + 1;
  }
}

/**
 * True when the message asks for this flow again.
 *
 * A hashtag keyword counts wherever it appears; a bare one only when it is
 * the whole message. Works the same on a DM, a comment or a story reply,
 * because the request means the same thing on all of them.
 */
export function isRestartKeyword(
  text: string | null | undefined,
  keywords: Array<KeywordOption | string | null | undefined>
): boolean {
  if (!text?.trim()) return false;

  const said = bareWords(text);

  return keywords.some((keyword) => {
    const raw = (typeof keyword === "string" ? keyword : keyword?.value)?.trim();
    if (!raw) return false;

    const wanted = bareWords(raw);
    // An empty keyword would match everything once stripped; a flow with one
    // saved would restart on any message at all.
    if (!wanted) return false;

    if (raw.startsWith("#")) return mentionsHashtag(text, wanted);
    return said === wanted;
  });
}
