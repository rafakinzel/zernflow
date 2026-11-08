import { describe, it, expect } from "vitest";
import { decidirAcesso, LIMITE_VALE_DESDE, MAX_SESSION_DAYS } from "./auth-policy";

const agora = Date.UTC(2027, 1, 1);
const ha = (dias: number) => Math.floor((agora - dias * 86_400_000) / 1000);

describe("decidirAcesso", () => {
  it("lets a password-only session in when no authenticator is enrolled", () => {
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal1", autenticadoEm: [ha(1)] }, agora)).toBe("ok");
  });

  it("asks for the code once an authenticator is enrolled", () => {
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal2", autenticadoEm: [ha(1)] }, agora)).toBe("falta_codigo");
    expect(decidirAcesso({ nivelAtual: "aal2", nivelExigido: "aal2", autenticadoEm: [ha(1), ha(1)] }, agora)).toBe("ok");
  });

  it("ends a session signed in too long ago, whatever its level", () => {
    const velho = ha(MAX_SESSION_DAYS + 1);
    expect(decidirAcesso({ nivelAtual: "aal2", nivelExigido: "aal2", autenticadoEm: [velho, ha(2)] }, agora)).toBe("expirou");
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal1", autenticadoEm: [velho] }, agora)).toBe("expirou");
  });

  it("counts sessions from before the limit existed from the day it started", () => {
    const antigo = Math.floor(Date.UTC(2026, 5, 1) / 1000);
    const pouco = LIMITE_VALE_DESDE * 1000 + 10 * 86_400_000;
    const muito = LIMITE_VALE_DESDE * 1000 + (MAX_SESSION_DAYS + 1) * 86_400_000;
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal1", autenticadoEm: [antigo] }, pouco)).toBe("ok");
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal1", autenticadoEm: [antigo] }, muito)).toBe("expirou");
  });

  it("does not end a session it cannot date", () => {
    expect(decidirAcesso({ nivelAtual: "aal1", nivelExigido: "aal1", autenticadoEm: [] }, agora)).toBe("ok");
  });
});
