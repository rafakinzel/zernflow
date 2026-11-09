import { normalise } from "./reply-matching";

/**
 * Whether a message asks the bot to stop, and nothing else.
 *
 * Rafa (08/11/2026): someone who asks to stop is stopped at once, without
 * waiting for the team; but a question that merely contains "não" must never
 * end a run by accident. So this is deliberately narrow. The whole message,
 * once courtesy is set aside, has to be one of the phrases below. "Não quero
 * mais" stops; "não quero agora", "não sei se é pra mim" or "para quem é?"
 * do not, and a question mark never does.
 */
const STOP_PHRASES = new Set([
  "para", "pare", "parar", "chega", "stop", "sair", "cancelar", "cancela",
  "descadastrar", "unsubscribe",
  "nao quero", "nao quero mais", "quero sair",
  "nao tenho interesse", "nao tenho mais interesse", "sem interesse",
  "nao me interessa", "nao me interessa mais",
  "nao estou interessado", "nao estou interessada",
  "nao to interessado", "nao to interessada",
  "nao quero receber", "nao quero receber mais", "nao quero mais receber",
  "para de mandar", "pare de mandar", "para de me mandar", "pare de me mandar",
  "para de mandar mensagem", "pare de mandar mensagem",
  "para de me mandar mensagem", "pare de me mandar mensagem",
  "nao me mande mais", "nao me manda mais",
  "nao me mande mais mensagem", "nao me manda mais mensagem",
  "nao mande mais mensagem", "nao manda mais mensagem",
  "me tira da lista", "me tire da lista", "me remove da lista", "me remova da lista",
  "not interested", "stop messaging me",
]);

/** Courtesy that can wrap a stop request without changing it. */
const COURTESY = new Set([
  "obrigado", "obrigada", "obg", "valeu", "vlw", "por", "favor", "pfv", "pf",
  "ok", "oi", "ola", "thiago", "mas", "eu", "ja", "please", "thanks", "pls",
]);

export function isStopRequest(text: string | null | undefined): boolean {
  if (!text || text.includes("?")) return false;
  const words = normalise(text)
    .replace(/\bmensagens\b/g, "mensagem")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;
  const core = words.filter((w) => !COURTESY.has(w)).join(" ");
  return STOP_PHRASES.has(core);
}
