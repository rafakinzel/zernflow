import { describe, it, expect } from "vitest";
import { isStopRequest } from "./opt-out";

describe("isStopRequest", () => {
  it("stops on a plain request to stop, with or without courtesy", () => {
    for (const text of [
      "para",
      "Pare!",
      "não quero mais",
      "Não tenho interesse, obrigada",
      "para de me mandar mensagens",
      "Oi Thiago, não quero receber mais, obrigado",
      "me tira da lista por favor",
      "STOP",
    ]) {
      expect(isStopRequest(text), text).toBe(true);
    }
  });

  it("never stops on a question or a message that only contains 'não'", () => {
    for (const text of [
      "não sei se é pra mim",
      "para quem é o curso?",
      "não quero agora, talvez mês que vem",
      "não consigo agora",
      "não entendi, pode explicar?",
      "não tenho dinheiro parado, serve pra mim?",
      "para mim não dá esse mês",
      "quanto custa?",
      "não",
      "sim",
      "obrigada",
      "nao quero mais pagar taxa no banco, como faço",
    ]) {
      expect(isStopRequest(text), text).toBe(false);
    }
  });

  it("handles nothing", () => {
    expect(isStopRequest("")).toBe(false);
    expect(isStopRequest(null)).toBe(false);
  });
});
