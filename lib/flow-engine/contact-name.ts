/**
 * The name a flow may call someone by.
 *
 * Rafa's rule (07/11/2026): a person is called by name only when they told us
 * their name in a flow that asks for it ("Como eu posso te chamar?"), which is
 * stored as their `first_name` field. The Instagram profile is never used: it
 * often carries no name, and then the bot greeted people by their @
 * ("Olá bellaschettino!"), which reads colder than no name at all. Without a
 * stored name everybody gets the same message, with the name left out.
 */

/** The stored first name, trimmed, or "" when the person never told us. */
export function nomeParaChamar(variables: Record<string, unknown>): string {
  const stored = variables.first_name;
  return typeof stored === "string" ? stored.trim() : "";
}

/**
 * Tidies a message after a variable resolved to nothing, so a line written
 * around a name still reads well without it:
 *
 *   "Olá !"                    → "Olá!"
 *   ", você parou na pergunta" → "Você parou na pergunta"
 *   "Muito bom, !"             → "Muito bom!"
 *   "Faala  tudo certo?"       → "Faala tudo certo?"
 *
 * Only called when something blanked, so ordinary copy is never touched.
 */
export function arrumarSemNome(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const tidy = line
        .replace(/[ \t]+([,.!?;:])/g, "$1")
        // "Muito bom, {{first_name}}!" without the name: drop the stray comma.
        .replace(/,([.!?;:])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      // A line that opened with the name now opens with its comma.
      const semInicio = tidy.replace(/^[,;:]\s*/, "");
      if (semInicio === tidy) return tidy;
      return semInicio.charAt(0).toLocaleUpperCase("pt-BR") + semInicio.slice(1);
    })
    .join("\n")
    .trim();
}
