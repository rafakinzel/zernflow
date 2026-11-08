/**
 * Who may use a signed-in session, decided in one place (Rafa, 08/11/2026).
 *
 * - Two-step login: once a person has an authenticator app enrolled, a session
 *   that only proved the password (aal1) is not enough. They are sent to the
 *   code step, and the API answers 401. Without an enrolled factor nothing
 *   changes, so nobody is locked out by turning this on.
 * - Sessions end: Supabase refreshes a session forever while the browser is
 *   open now and then, so a laptop signed in once stayed signed in for good.
 *   A session whose sign-in is older than MAX_SESSION_DAYS must sign in again.
 */

export const MAX_SESSION_DAYS = 30;

/**
 * The limit started on 08/11/2026. Sessions signed in before that count from
 * that day, so nobody was thrown out the moment it went live, before having
 * a chance to check their password.
 */
export const LIMITE_VALE_DESDE = Date.UTC(2026, 10, 8) / 1000;

export type Acesso = "ok" | "falta_codigo" | "expirou";

export interface EstadoDaSessao {
  /** "aal1" (password only) or "aal2" (password and authenticator code). */
  nivelAtual: string | null;
  /** "aal2" when the person has an authenticator enrolled, else "aal1". */
  nivelExigido: string | null;
  /** Seconds since epoch of each way they proved who they are this session. */
  autenticadoEm: number[];
}

export function decidirAcesso(s: EstadoDaSessao, agora = Date.now()): Acesso {
  const primeiraVez = s.autenticadoEm.length
    ? Math.max(Math.min(...s.autenticadoEm), LIMITE_VALE_DESDE)
    : null;
  if (primeiraVez !== null && agora - primeiraVez * 1000 > MAX_SESSION_DAYS * 86_400_000) {
    return "expirou";
  }
  if (s.nivelExigido === "aal2" && s.nivelAtual !== "aal2") return "falta_codigo";
  return "ok";
}
