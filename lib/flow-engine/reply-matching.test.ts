import { describe, it, expect } from "vitest";
import { matchTypedReply, normalise, resolveReply } from "./reply-matching";

/** The real buttons from the adviser flow's price message. */
const price = [
  { payload: "FA_SIM", title: "Sim, é isso mesmo!" },
  { payload: "FA_NAO", title: "Não consigo agora" },
  { payload: "FA_SEGUROS", title: "Quero só os seguros" },
];

describe("normalise", () => {
  it("strips accents, case, punctuation and emoji", () => {
    expect(normalise("Sim, é isso mesmo! 🔥")).toBe("sim e isso mesmo");
    expect(normalise("  Não   consigo  ")).toBe("nao consigo");
  });
});

describe("matchTypedReply", () => {
  it("matches the button's own words, however they were typed", () => {
    expect(matchTypedReply("sim é isso mesmo", price)).toBe("FA_SIM");
    expect(matchTypedReply("SIM, E ISSO MESMO!", price)).toBe("FA_SIM");
    expect(matchTypedReply("nao consigo agora", price)).toBe("FA_NAO");
  });

  it("matches when the reply wraps the button's words", () => {
    expect(matchTypedReply("quero só os seguros sim", price)).toBe("FA_SEGUROS");
    expect(matchTypedReply("acho que não consigo agora", price)).toBe("FA_NAO");
  });

  it("matches when the words are all there in another order", () => {
    expect(matchTypedReply("agora não consigo não", price)).toBe("FA_NAO");
  });

  it("refuses a real question, which is the whole point", () => {
    // These are the replies that should reach a person, not a branch.
    for (const text of [
      "quanto tempo dura a call?",
      "vc atende em melbourne?",
      "e se eu já tiver um adviser",
      "me explica melhor por favor",
    ]) {
      expect(matchTypedReply(text, price)).toBeNull();
    }
  });

  it("refuses a bare word that only brushes a title", () => {
    // "não" appears in a title, but on its own it could be refusing the
    // price, refusing insurance, or answering something else entirely.
    expect(matchTypedReply("não", price)).toBeNull();
    expect(matchTypedReply("sim", price)).toBeNull();
    expect(matchTypedReply("quero", price)).toBeNull();
  });

  it("lets an exact answer win over a longer title that swallows it", () => {
    const both = [
      { payload: "A", title: "Quero agora" },
      { payload: "B", title: "Quero agora sim" },
    ];
    // Typing exactly what a button says is not ambiguous, whatever else
    // happens to contain those words.
    expect(matchTypedReply("quero agora sim", both)).toBe("B");
    expect(matchTypedReply("quero agora", both)).toBe("A");
  });

  it("refuses rather than guesses when two titles both fit", () => {
    const both = [
      { payload: "A", title: "Quero o plano anual" },
      { payload: "B", title: "Quero o plano mensal" },
    ];
    expect(matchTypedReply("quero o plano", both)).toBeNull();
  });

  it("never invents meaning the titles do not carry", () => {
    // "claro" is a yes to a person and nothing to a button.
    expect(matchTypedReply("claro", price)).toBeNull();
    expect(matchTypedReply("bora", price)).toBeNull();
    expect(matchTypedReply("👍", price)).toBeNull();
  });

  it("handles nothing to match against", () => {
    expect(matchTypedReply("sim é isso mesmo", [])).toBeNull();
    expect(matchTypedReply("", price)).toBeNull();
    expect(matchTypedReply(null, price)).toBeNull();
    expect(matchTypedReply("oi", [{ payload: "X", title: "   " }])).toBeNull();
  });

  it("works on the payment buttons too", () => {
    const payment = [
      { payload: "FA_ANUAL", title: "Anual, preço travado" },
      { payload: "FA_ONEOFF", title: "Pagar uma vez" },
    ];
    expect(matchTypedReply("anual preço travado", payment)).toBe("FA_ANUAL");
    expect(matchTypedReply("prefiro pagar uma vez", payment)).toBe("FA_ONEOFF");
    expect(matchTypedReply("qual a diferença entre os dois?", payment)).toBeNull();
  });
});

describe("resolveReply", () => {
  const options = price;

  it("follows a tap without reading anything", () => {
    expect(
      resolveReply({ tappedPayload: "FA_SIM", text: "qualquer coisa", options, hasCatchAll: false })
    ).toEqual({ kind: "follow", handle: "FA_SIM" });
  });

  it("follows the button whose words they typed", () => {
    expect(
      resolveReply({ text: "não consigo agora", options, hasCatchAll: false })
    ).toEqual({ kind: "follow", handle: "FA_NAO" });
  });

  it("hands a question to a person", () => {
    expect(
      resolveReply({ text: "quanto custa a call?", options, hasCatchAll: false })
    ).toEqual({ kind: "human" });
  });

  it("respects a catch-all the flow drew on purpose", () => {
    // The author decided what happens to free text, so the engine does not.
    expect(
      resolveReply({ text: "quanto custa a call?", options, hasCatchAll: true })
    ).toEqual({ kind: "passOn" });
  });

  it("lets an open question through, since there is nothing to match", () => {
    // "Qual seu email?" takes any answer, including one that looks random.
    expect(
      resolveReply({ text: "rafa@exemplo.com", options: [], hasCatchAll: false })
    ).toEqual({ kind: "passOn" });
  });

  it("takes a plain yes as carrying on, when there is only one way on", () => {
    const only = [{ payload: "GO", title: "Claro, vamos lá 🔥" }];
    for (const text of ["claro", "bora", "sim", "pode", "vamos la"]) {
      expect(resolveReply({ text, options: only, hasCatchAll: false })).toEqual({
        kind: "follow",
        handle: "GO",
      });
    }
  });

  it("still sends a question to a person, even with one way on", () => {
    const only = [{ payload: "GO", title: "Claro, vamos lá 🔥" }];
    expect(
      resolveReply({ text: "quanto custa isso?", options: only, hasCatchAll: false })
    ).toEqual({ kind: "human" });
  });

  it("never reads a plain yes as a choice between buttons", () => {
    // Three buttons and a bare "sim": which one? Exactly the guess to avoid.
    expect(resolveReply({ text: "sim", options, hasCatchAll: false })).toEqual({
      kind: "human",
    });
  });

  it("hands over an image or sticker with no text at a decision point", () => {
    // Nothing to read, and no button was pressed: a person should look.
    expect(resolveReply({ options, hasCatchAll: false })).toEqual({ kind: "human" });
  });
});
