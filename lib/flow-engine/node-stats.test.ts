import { describe, it, expect } from "vitest";
import {
  buildNodeStats,
  findPayloadOwner,
  nodeOptions,
  tally,
  type RawNode,
} from "./node-stats";

const messageNode = (id: string, options: Array<[string | null, string | null]>): RawNode => ({
  id,
  data: {
    messages: [
      { text: "hello" },
      {
        text: "pick one",
        buttons: options.map(([title, payload]) => ({ title, payload })),
      },
    ],
  },
});

describe("nodeOptions", () => {
  it("collects buttons and quick replies across every bubble", () => {
    const node: RawNode = {
      id: "n1",
      data: {
        messages: [
          { buttons: [{ title: "A", payload: "P_A" }] },
          { quickReplies: [{ title: "B", payload: "P_B" }] },
        ],
      },
    };
    expect(nodeOptions(node).map((o) => o.payload)).toEqual(["P_A", "P_B"]);
  });

  it("skips a link button, which reports to the platform and not to us", () => {
    const node: RawNode = {
      id: "n1",
      data: {
        messages: [
          {
            buttons: [
              { title: "Agende aqui", payload: null },
              { title: "Sim", payload: "P_SIM" },
            ],
          },
        ],
      },
    };
    expect(nodeOptions(node).map((o) => o.payload)).toEqual(["P_SIM"]);
  });

  it("is empty for a node with no messages at all", () => {
    expect(nodeOptions({ id: "delay", data: { messages: undefined } })).toEqual([]);
    expect(nodeOptions({ id: "delay", data: null })).toEqual([]);
  });
});

describe("findPayloadOwner", () => {
  const nodes = [
    messageNode("fa_6", [
      ["Sim, é isso mesmo!", "FA_SIM"],
      ["Não consigo agora", "FA_NAO"],
    ]),
    { id: "fa_13", data: { messages: undefined } },
    messageNode("fa_34", [["Anual, preço travado", "FA_ANUAL"]]),
  ];

  it("finds the message node that offered the payload, not the node that was waiting", () => {
    expect(findPayloadOwner(nodes, "FA_ANUAL")).toEqual({
      nodeId: "fa_34",
      title: "Anual, preço travado",
    });
  });

  it("returns null for a payload nothing offers", () => {
    expect(findPayloadOwner(nodes, "FA_GHOST")).toBeNull();
  });

  it("falls back to the payload when the button has no title", () => {
    expect(findPayloadOwner([messageNode("n", [[null, "P_X"]])], "P_X")).toEqual({
      nodeId: "n",
      title: "P_X",
    });
  });
});

describe("buildNodeStats", () => {
  const nodes = [
    messageNode("fa_6", [
      ["Sim", "FA_SIM"],
      ["Não", "FA_NAO"],
      ["Só seguros", "FA_SEGUROS"],
    ]),
    messageNode("fa_15", [["Agende aqui", null]]),
    { id: "fa_13", data: { messages: undefined } },
  ];

  it("gives each button its share of the people who reached the node", () => {
    const stats = buildNodeStats({
      nodes,
      reachedByNode: { fa_6: 100, fa_13: 40 },
      tapsByPayload: { FA_SIM: 25, FA_NAO: 10, FA_SEGUROS: 5 },
    });

    expect(stats.fa_6.reached).toBe(100);
    expect(stats.fa_6.buttons).toEqual([
      { payload: "FA_SIM", title: "Sim", taps: 25, rate: 0.25 },
      { payload: "FA_NAO", title: "Não", taps: 10, rate: 0.1 },
      { payload: "FA_SEGUROS", title: "Só seguros", taps: 5, rate: 0.05 },
    ]);
  });

  it("keeps a node nobody reached, with zeros", () => {
    // A message nobody got to is exactly what the reader is looking for.
    const stats = buildNodeStats({
      nodes,
      reachedByNode: { fa_6: 10 },
      tapsByPayload: {},
    });
    expect(stats.fa_13).toEqual({ reached: 0, buttons: [] });
  });

  it("has no rate without a denominator", () => {
    const stats = buildNodeStats({
      nodes,
      reachedByNode: {},
      tapsByPayload: { FA_SIM: 3 },
    });
    // Three taps and nobody recorded as reaching the node is a gap in the
    // data, not a 300% tap rate.
    expect(stats.fa_6.buttons[0]).toMatchObject({ taps: 3, rate: null });
  });

  it("leaves a link button out of the per-button list", () => {
    const stats = buildNodeStats({
      nodes,
      reachedByNode: { fa_15: 50 },
      tapsByPayload: {},
    });
    expect(stats.fa_15).toEqual({ reached: 50, buttons: [] });
  });
});

describe("tally", () => {
  it("counts by the key and skips rows without one", () => {
    const rows = [{ p: "A" }, { p: "A" }, { p: "B" }, { p: null }, {}];
    expect(tally(rows, (r) => (r as { p?: string | null }).p)).toEqual({
      A: 2,
      B: 1,
    });
  });
});
