import { describe, it, expect } from "vitest";
import {
  inlineButtonRouting,
  type RawEdge,
  type RawNode,
} from "./inline-button-routing";

const msg = (id: string, payloads: string[] = []): RawNode => ({
  id,
  type: "sendMessage",
  data: {
    messages: [
      { text: `texto de ${id}` },
      payloads.length
        ? {
            text: "escolhe",
            buttons: payloads.map((p) => ({ title: p, type: "postback", payload: p })),
          }
        : { text: "fim" },
    ],
  },
});

const delay = (id: string, timeout = 20): RawNode => ({
  id,
  type: "action",
  data: { actionType: "smartDelay", timeout, timeoutUnit: "hours" },
});

const cond = (id: string, value: string, field = "variable:payload"): RawNode => ({
  id,
  type: "condition",
  data: { logic: "and", conditions: [{ field, operator: "equals", value }] },
});

const e = (source: string, target: string, sourceHandle?: string): RawEdge => ({
  id: `${source}-${sourceHandle ?? "next"}-${target}`,
  source,
  target,
  sourceHandle,
});

/** The #fa shape: three buttons, a wait, two nested conditions. */
function fixture() {
  const nodes: RawNode[] = [
    msg("pitch", ["SIM", "NAO", "SEGUROS"]),
    delay("wait"),
    cond("isYes", "SIM"),
    cond("isInsurance", "SEGUROS"),
    msg("booking"),
    msg("insurance"),
    msg("course"),
    msg("rescue"),
  ];
  const edges: RawEdge[] = [
    e("pitch", "wait"),
    e("wait", "isYes", "reply"),
    e("wait", "rescue", "timeout"),
    e("isYes", "booking", "yes"),
    e("isYes", "isInsurance", "no"),
    e("isInsurance", "insurance", "yes"),
    e("isInsurance", "course", "no"),
  ];
  return { nodes, edges };
}

describe("inlineButtonRouting", () => {
  it("gives every button an exit of its own, through nested conditions", () => {
    const { nodes, edges } = fixture();
    const out = inlineButtonRouting(nodes, edges);

    const from = (handle: string) =>
      out.edges.find((x) => x.source === "pitch" && x.sourceHandle === handle)?.target;

    expect(from("SIM")).toBe("booking");
    expect(from("SEGUROS")).toBe("insurance");
    expect(from("NAO")).toBe("course");
  });

  it("keeps the no-reply branch on the message", () => {
    const out = inlineButtonRouting(...Object.values(fixture()) as [RawNode[], RawEdge[]]);
    const timeout = out.edges.find(
      (x) => x.source === "pitch" && x.sourceHandle === "timeout"
    );
    expect(timeout?.target).toBe("rescue");
  });

  it("keeps a catch-all for free text, which matches no button", () => {
    // Today someone who types instead of tapping falls down the "anything
    // else" side of every condition. Dropping that would strand them.
    const out = inlineButtonRouting(...Object.values(fixture()) as [RawNode[], RawEdge[]]);
    const fallback = out.edges.find(
      (x) => x.source === "pitch" && x.sourceHandle === "reply"
    );
    expect(fallback?.target).toBe("course");
  });

  it("moves the wait onto the message and deletes the plumbing", () => {
    const out = inlineButtonRouting(...Object.values(fixture()) as [RawNode[], RawEdge[]]);
    const pitch = out.nodes.find((n) => n.id === "pitch");

    expect(pitch?.data).toMatchObject({
      waitForReply: true,
      timeout: 20,
      timeoutUnit: "hours",
    });
    expect(out.nodes.map((n) => n.id)).not.toContain("wait");
    expect(out.nodes.map((n) => n.id)).not.toContain("isYes");
    expect(out.nodes.map((n) => n.id)).not.toContain("isInsurance");
    expect(out.edges.some((x) => x.source === "wait" || x.target === "wait")).toBe(false);
  });

  it("leaves every message that was a destination exactly where it was", () => {
    const { nodes, edges } = fixture();
    const out = inlineButtonRouting(nodes, edges);
    for (const id of ["booking", "insurance", "course", "rescue"]) {
      expect(out.nodes.find((n) => n.id === id)).toEqual(
        nodes.find((n) => n.id === id)
      );
    }
  });

  it("refuses a condition that tests more than the tap", () => {
    // It cannot be replaced by a button's exit, because the answer depends
    // on something the tap does not carry.
    const nodes = [msg("pitch", ["SIM"]), delay("wait"), cond("c", "x", "field:plano"), msg("after")];
    const edges = [
      e("pitch", "wait"),
      e("wait", "c", "reply"),
      e("c", "after", "yes"),
      e("c", "after", "no"),
    ];
    const out = inlineButtonRouting(nodes, edges);

    expect(out.nodes.map((n) => n.id)).toContain("c");
    // The button still gets an exit; it just stops at the condition.
    expect(
      out.edges.find((x) => x.source === "pitch" && x.sourceHandle === "SIM")?.target
    ).toBe("c");
  });

  it("leaves a wait that something else also feeds", () => {
    const nodes = [msg("a", ["SIM"]), msg("b"), delay("wait"), msg("after")];
    const edges = [
      e("a", "wait"),
      e("b", "wait"),
      e("wait", "after", "reply"),
    ];
    const out = inlineButtonRouting(nodes, edges);

    expect(out.nodes.map((n) => n.id)).toContain("wait");
    expect(out.changes).toHaveLength(0);
  });

  it("keeps a condition two chains share, and still routes both", () => {
    const nodes = [
      msg("first", ["SIM"]),
      delay("w1"),
      msg("second", ["SIM"]),
      delay("w2"),
      cond("shared", "SIM"),
      msg("yes"),
      msg("no"),
    ];
    const edges = [
      e("first", "w1"),
      e("w1", "shared", "reply"),
      e("second", "w2"),
      e("w2", "shared", "reply"),
      e("shared", "yes", "yes"),
      e("shared", "no", "no"),
    ];
    const out = inlineButtonRouting(nodes, edges);

    // Both chains collapse and both resolve through the shared condition,
    // which is then unreferenced and goes.
    expect(
      out.edges.find((x) => x.source === "first" && x.sourceHandle === "SIM")?.target
    ).toBe("yes");
    expect(
      out.edges.find((x) => x.source === "second" && x.sourceHandle === "SIM")?.target
    ).toBe("yes");
    expect(out.nodes.map((n) => n.id)).not.toContain("shared");
  });

  it("keeps a shared condition alive when something it does not rewrite points at it", () => {
    const nodes = [msg("pitch", ["SIM"]), delay("wait"), cond("c", "SIM"), msg("yes"), msg("no"), msg("other")];
    const edges = [
      e("pitch", "wait"),
      e("wait", "c", "reply"),
      e("other", "c"),
      e("c", "yes", "yes"),
      e("c", "no", "no"),
    ];
    const out = inlineButtonRouting(nodes, edges);

    expect(out.nodes.map((n) => n.id)).toContain("c");
    expect(out.edges.some((x) => x.source === "c" && x.sourceHandle === "yes")).toBe(true);
  });

  it("ignores a message with no buttons, and one that does not feed a wait", () => {
    const nodes = [msg("plain"), msg("buttons", ["SIM"]), msg("after")];
    const edges = [e("plain", "buttons"), e("buttons", "after")];
    const out = inlineButtonRouting(nodes, edges);

    expect(out.changes).toHaveLength(0);
    expect(out.nodes).toEqual(nodes);
    expect(out.edges).toEqual(edges);
  });

  it("ignores a wait with no reply branch, which was never a choice", () => {
    const nodes = [msg("pitch", ["SIM"]), delay("wait"), msg("after")];
    const edges = [e("pitch", "wait"), e("wait", "after", "timeout")];
    const out = inlineButtonRouting(nodes, edges);
    expect(out.changes).toHaveLength(0);
  });

  it("reports what it did, for the record", () => {
    const out = inlineButtonRouting(...Object.values(fixture()) as [RawNode[], RawEdge[]]);
    expect(out.changes).toEqual([
      {
        messageId: "pitch",
        delayId: "wait",
        routes: { SIM: "booking", NAO: "course", SEGUROS: "insurance" },
        fallback: "course",
        timeout: "rescue",
        removedConditions: ["isYes", "isInsurance"],
      },
    ]);
  });

  it("is a no-op the second time it runs", () => {
    const first = inlineButtonRouting(...Object.values(fixture()) as [RawNode[], RawEdge[]]);
    const second = inlineButtonRouting(first.nodes, first.edges);
    expect(second.changes).toHaveLength(0);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });
});
