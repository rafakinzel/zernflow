import { describe, it, expect } from "vitest";
import { nodeDestinations, nodeTitle, type RawEdge, type RawNode } from "./flow-destinations";

const message = (
  id: string,
  text: string,
  buttons: Array<[string, string]> = []
): RawNode => ({
  id,
  type: "sendMessage",
  data: {
    messages: [
      { text },
      buttons.length
        ? { text: "pick", buttons: buttons.map(([title, payload]) => ({ title, payload })) }
        : { text: "more" },
    ],
  },
});

const smartDelay = (id: string, timeout = 20): RawNode => ({
  id,
  type: "action",
  data: { actionType: "smartDelay", timeout, timeoutUnit: "hours" },
});

const condition = (id: string, payload: string): RawNode => ({
  id,
  type: "condition",
  data: {
    logic: "and",
    conditions: [{ field: "variable:payload", operator: "equals", value: payload }],
  },
});

const edge = (source: string, target: string, sourceHandle?: string): RawEdge => ({
  source,
  target,
  sourceHandle,
});

/** The real shape: pitch, wait, condition, two outcomes. */
const nodes: RawNode[] = [
  message("pitch", "A minha fee é a partir de $5,500. Faz sentido pra você?", [
    ["Sim, é isso mesmo!", "FA_SIM"],
    ["Não consigo agora", "FA_NAO"],
  ]),
  smartDelay("wait"),
  condition("check", "FA_SIM"),
  message("booking", "Perfeito! Escolhe um horário na agenda."),
  message("insurance", "Esse é um trabalho que eu faço separado."),
  message("rescue", "Se o que pesa é o tempo, a call é de 10 minutos."),
  message("course", "Posso te mostrar o curso?"),
];

const edges: RawEdge[] = [
  edge("pitch", "wait"),
  edge("wait", "check", "reply"),
  edge("wait", "rescue", "timeout"),
  edge("check", "booking", "yes"),
  edge("check", "insurance", "no"),
  edge("insurance", "course"),
];

describe("nodeTitle", () => {
  it("names a message by its first words", () => {
    expect(nodeTitle(nodes[0])).toBe("A minha fee é a partir de $5,500. Faz…");
  });

  it("names the waits by how long they wait", () => {
    expect(nodeTitle(smartDelay("w", 20))).toBe("Wait 20h");
    expect(
      nodeTitle({ id: "d", type: "delay", data: { duration: 20, unit: "minutes" } })
    ).toBe("Pause 20min");
  });

  it("prefers a label someone gave the node", () => {
    expect(
      nodeTitle({ id: "x", type: "action", data: { actionType: "smartDelay", label: "Espera do preço" } })
    ).toBe("Espera do preço");
  });

  it("names the rest by what they are", () => {
    expect(nodeTitle(condition("c", "X"))).toBe("Condition");
    expect(
      nodeTitle(condition("c", "FA_SIM"), () => "Sim, é isso mesmo!")
    ).toBe('Chose "Sim, é isso mesmo!"?');
    expect(
      nodeTitle({ id: "h", type: "action", data: { actionType: "humanTakeover" } })
    ).toBe("Human takeover");
  });
});

describe("nodeDestinations", () => {
  const dests = nodeDestinations(nodes, edges);

  it("follows a button through the wait and the condition to the message it lands on", () => {
    // The button routes nothing by itself; this is the answer a reader wants.
    expect(dests.pitch).toEqual([
      {
        key: "FA_SIM",
        label: "Sim, é isso mesmo!",
        targetId: "booking",
        targetTitle: "Perfeito! Escolhe um horário na agend…",
      },
      {
        key: "FA_NAO",
        label: "Não consigo agora",
        targetId: "insurance",
        targetTitle: "Esse é um trabalho que eu faço separa…",
      },
    ]);
  });

  it("labels a condition with the button's own words, not Yes", () => {
    expect(dests.check[0]).toMatchObject({
      label: "Sim, é isso mesmo!",
      targetTitle: "Perfeito! Escolhe um horário na agend…",
    });
    expect(dests.check[1]).toMatchObject({ label: "Anything else" });
  });

  it("reports both sides of a wait", () => {
    expect(dests.wait.map((d) => [d.label, d.targetId])).toEqual([
      ["They reply", "check"],
      ["No reply", "rescue"],
    ]);
  });

  it("shows an exit that leads nowhere as leading nowhere", () => {
    // A line never drawn looks exactly like a line that goes nowhere, which
    // is the whole reason for this.
    const open = nodeDestinations(
      [...nodes, smartDelay("dangling")],
      [...edges, edge("rescue", "dangling")]
    );
    expect(open.dangling).toEqual([
      { key: "reply", label: "They reply", targetId: null, targetTitle: null },
      { key: "timeout", label: "No reply", targetId: null, targetTitle: null },
    ]);
  });

  it("says nothing about a plain message whose single line is drawn", () => {
    expect(dests.insurance).toEqual([]);
  });

  it("flags a plain message that ends the conversation", () => {
    expect(dests.booking).toEqual([
      { key: "next", label: "Then", targetId: null, targetTitle: null },
    ]);
  });

  it("stops at the first message rather than running to the end of the flow", () => {
    const long = nodeDestinations(
      [...nodes, message("later", "muito depois")],
      [...edges, edge("booking", "later")]
    );
    expect(long.pitch[0].targetId).toBe("booking");
  });

  it("survives a cycle without hanging", () => {
    const looped = nodeDestinations(nodes, [
      edge("pitch", "wait"),
      edge("wait", "check", "reply"),
      edge("check", "wait", "yes"),
      edge("check", "insurance", "no"),
    ]);
    // Nothing to assert beyond "it answered": the cap is what is being tested.
    expect(looped.pitch).toHaveLength(2);
  });

  it("handles a button whose path simply stops", () => {
    const stopped = nodeDestinations(nodes, [edge("pitch", "wait")]);
    expect(stopped.pitch[0]).toMatchObject({ targetId: "wait" });
  });
});
