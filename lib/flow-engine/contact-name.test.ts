import { describe, it, expect } from "vitest";
import { arrumarSemNome, nomeParaChamar } from "./contact-name";

describe("nomeParaChamar", () => {
  it("uses only the name the person told us", () => {
    expect(nomeParaChamar({ first_name: " Isabela " })).toBe("Isabela");
  });

  it("is blank when nobody asked, whatever the profile says", () => {
    expect(nomeParaChamar({})).toBe("");
    expect(nomeParaChamar({ first_name: "" })).toBe("");
    expect(nomeParaChamar({ full_name: "bellaschettino" })).toBe("");
  });
});

describe("arrumarSemNome", () => {
  it("reads naturally when the name is left out", () => {
    expect(arrumarSemNome("Olá ! Vi que você quer saber mais.")).toBe("Olá! Vi que você quer saber mais.");
    expect(arrumarSemNome(", você parou na pergunta do objetivo.")).toBe("Você parou na pergunta do objetivo.");
    expect(arrumarSemNome("Muito bom, ! Então o seu foco agora é: crescer")).toBe("Muito bom! Então o seu foco agora é: crescer");
    expect(arrumarSemNome("Faala  tudo certo?")).toBe("Faala tudo certo?");
    expect(arrumarSemNome("Sem problemas .")).toBe("Sem problemas.");
    expect(arrumarSemNome("Tranquilo, . O trabalho de adviser")).toBe("Tranquilo. O trabalho de adviser");
    expect(arrumarSemNome("Perfeito , seja muito bem-vinda")).toBe("Perfeito, seja muito bem-vinda");
  });

  it("fixes every line, not only the first", () => {
    expect(arrumarSemNome("Oi!\n\n, notei que você não respondeu.")).toBe("Oi!\n\nNotei que você não respondeu.");
  });
});
