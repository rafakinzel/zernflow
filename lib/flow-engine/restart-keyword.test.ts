import { describe, it, expect } from "vitest";
import { bareWords, isRestartKeyword } from "./restart-keyword";

const faKeywords = [{ value: "#fa" }];
const rdKeywords = [{ value: "#rd" }, { value: "rd" }];

describe("bareWords", () => {
  it("strips the hash, the case and the accents", () => {
    expect(bareWords("#FA")).toBe("fa");
    expect(bareWords(" #fa! ")).toBe("fa");
    expect(bareWords("Não")).toBe("nao");
  });
});

describe("isRestartKeyword", () => {
  it("restarts on the exact thing people are told to send", () => {
    // What gia_vndrlnd sent at 14:42 after being told to.
    expect(isRestartKeyword("#FA", faKeywords)).toBe(true);
    expect(isRestartKeyword("#fa", faKeywords)).toBe(true);
    // Without the hash it does not start the flow in an ordinary
    // conversation either: the trigger looks for "#fa".
    expect(isRestartKeyword("fa", faKeywords)).toBe(false);
    expect(isRestartKeyword("  #FA  ", faKeywords)).toBe(true);
    expect(isRestartKeyword("#RD", rdKeywords)).toBe(true);
  });

  it("counts the hashtag wherever it sits in the message", () => {
    // Nobody types "#FA" by accident, so what surrounds it does not matter.
    for (const text of [
      "quero saber do #fa, pode mandar?",
      "oi Thiago, me manda o #FA por favor",
      "obrigada! vou ver o #fa sim",
      "#FA 🙏",
    ]) {
      expect(isRestartKeyword(text, faKeywords)).toBe(true);
    }
  });

  it("does not let a hashtag answer for a longer word", () => {
    expect(isRestartKeyword("isso é #fabuloso", faKeywords)).toBe(false);
    expect(isRestartKeyword("#fas", faKeywords)).toBe(false);
  });

  it("keeps a keyword with no hash to the whole message", () => {
    // "rd" and "fa" are ordinary letters inside ordinary words, and a paused
    // conversation has a person in it who must not be talked over.
    expect(isRestartKeyword("rd", rdKeywords)).toBe(true);
    expect(isRestartKeyword("me explica melhor esse FA aí", faKeywords)).toBe(false);
    expect(isRestartKeyword("vou verificar o rd depois", rdKeywords)).toBe(false);
    expect(isRestartKeyword("quando puder me diz", rdKeywords)).toBe(false);
  });

  it("does not restart on an empty or absent message", () => {
    expect(isRestartKeyword("", faKeywords)).toBe(false);
    expect(isRestartKeyword(null, faKeywords)).toBe(false);
    expect(isRestartKeyword(undefined, faKeywords)).toBe(false);
    expect(isRestartKeyword("   ", faKeywords)).toBe(false);
    expect(isRestartKeyword("🙏", faKeywords)).toBe(false);
  });

  it("ignores an empty keyword rather than matching everything", () => {
    // Stripped of punctuation an empty keyword is "", which equals nothing
    // but would match any message if the guard were missing.
    expect(isRestartKeyword("qualquer coisa", [{ value: "" }])).toBe(false);
    expect(isRestartKeyword("qualquer coisa", [{ value: "   " }])).toBe(false);
    expect(isRestartKeyword("qualquer coisa", [null, undefined])).toBe(false);
  });

  it("takes keywords as plain strings too", () => {
    expect(isRestartKeyword("#FA", ["#fa"])).toBe(true);
    expect(isRestartKeyword("outra coisa", ["#fa"])).toBe(false);
  });
});
