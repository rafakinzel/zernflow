import { describe, it, expect } from "vitest";
import {
  biggestDrop,
  countSteps,
  depths,
  funnelSteps,
  type RawEdge,
  type RawNode,
} from "./flow-funnel";

/** A small flow with a branch, two of whose nodes are marked as steps. */
const nodes: RawNode[] = [
  { id: "t", type: "trigger", data: {} },
  { id: "hello", type: "sendMessage", data: { messages: [{ text: "Olá!" }] } },
  {
    id: "ask",
    type: "sendMessage",
    data: {
      isFunnelStep: true,
      messages: [{ text: "Qual é o seu principal objetivo financeiro hoje?" }],
    },
  },
  { id: "yes", type: "sendMessage", data: { messages: [{ text: "boa" }] } },
  {
    id: "offer",
    type: "sendMessage",
    data: { isFunnelStep: true, funnelLabel: "Viu a oferta", messages: [{ text: "o curso" }] },
  },
  { id: "quiet", type: "sendMessage", data: { messages: [{ text: "fim" }] } },
];

const edges: RawEdge[] = [
  { source: "t", target: "hello" },
  { source: "hello", target: "ask" },
  { source: "ask", target: "yes", sourceHandle: "SIM" },
  { source: "ask", target: "quiet", sourceHandle: "NAO" },
  { source: "yes", target: "offer" },
];

describe("depths", () => {
  it("counts edges from the trigger", () => {
    const d = depths(nodes, edges);
    expect(d.get("t")).toBe(0);
    expect(d.get("hello")).toBe(1);
    expect(d.get("ask")).toBe(2);
    expect(d.get("offer")).toBe(4);
  });

  it("takes the shortest way to a node two branches reach", () => {
    const shared: RawEdge[] = [...edges, { source: "quiet", target: "offer" }];
    // Through `quiet` it is 4 as well, but a longer detour must not win.
    const d = depths(nodes, [...shared, { source: "hello", target: "offer" }]);
    expect(d.get("offer")).toBe(2);
  });

  it("gives nothing back for a flow with no nodes", () => {
    expect(depths([], []).size).toBe(0);
  });
});

describe("funnelSteps", () => {
  it("takes only the marked nodes, in the order people meet them", () => {
    expect(funnelSteps(nodes, edges)).toEqual([
      { nodeId: "ask", label: "Qual é o seu principal objetivo finance…", depth: 2 },
      { nodeId: "offer", label: "Viu a oferta", depth: 4 },
    ]);
  });

  it("prefers the name the flow gives a step over its message text", () => {
    const [, offer] = funnelSteps(nodes, edges);
    expect(offer.label).toBe("Viu a oferta");
  });

  it("is empty when the flow marks nothing, rather than guessing", () => {
    const unmarked = nodes.map((n) => ({ ...n, data: { ...n.data, isFunnelStep: false } }));
    expect(funnelSteps(unmarked, edges)).toEqual([]);
  });

  it("keeps a marked node nothing reaches, at the end", () => {
    const orphan: RawNode = { id: "lost", data: { isFunnelStep: true, label: "Órfão" } };
    const steps = funnelSteps([...nodes, orphan], edges);
    expect(steps[steps.length - 1].nodeId).toBe("lost");
  });
});

describe("countSteps", () => {
  const steps = funnelSteps(nodes, edges);

  it("measures each step against the people who entered", () => {
    const counted = countSteps(steps, { ask: 70, offer: 42 }, 100, edges);

    expect(counted[0]).toMatchObject({ reached: 70, share: 0.7, lostBefore: 30 });
    expect(counted[1]).toMatchObject({ reached: 42, share: 0.42, lostBefore: 28 });
  });

  it("reports a step nobody reached as zero, not as missing", () => {
    const counted = countSteps(steps, { ask: 10 }, 10, edges);
    expect(counted[1]).toMatchObject({ reached: 0, lostBefore: 10 });
  });

  it("says nothing about share when nobody entered", () => {
    const counted = countSteps(steps, {}, 0, edges);
    expect(counted[0].share).toBeNull();
    expect(counted[0].lostBefore).toBeNull();
  });

  it("does not invent a loss when a later step was reached by more", () => {
    // A rescue can send someone back through a node. Reporting -5 lost
    // would be noise; claiming a smooth funnel would be a lie.
    const counted = countSteps(steps, { ask: 40, offer: 45 }, 100, edges);
    expect(counted[1].reached).toBe(45);
    expect(counted[1].lostBefore).toBe(0);
  });
});

describe("biggestDrop", () => {
  it("finds the steepest fall", () => {
    const counted = countSteps(funnelSteps(nodes, edges), { ask: 70, offer: 20 }, 100, edges);
    expect(biggestDrop(counted)?.nodeId).toBe("offer");
  });

  it("has nothing to say when nobody was lost", () => {
    const counted = countSteps(funnelSteps(nodes, edges), { ask: 10, offer: 10 }, 10, edges);
    expect(biggestDrop(counted)).toBeNull();
  });
});

describe("countSteps across a fork", () => {
  // Two offers on branches that exclude each other, the shape that caught
  // us live: everyone who took the course branch was being reported as
  // lost before the adviser offer, which they never could have reached.
  const forked: RawNode[] = [
    { id: "t", type: "trigger", data: {} },
    { id: "ask", type: "sendMessage", data: { isFunnelStep: true, label: "Perguntou" } },
    { id: "adviser", type: "sendMessage", data: { isFunnelStep: true, label: "Oferta adviser" } },
    { id: "course", type: "sendMessage", data: { isFunnelStep: true, label: "Oferta curso" } },
  ];
  const forkEdges: RawEdge[] = [
    { source: "t", target: "ask" },
    { source: "ask", target: "adviser", sourceHandle: "A" },
    { source: "ask", target: "course", sourceHandle: "B" },
  ];

  it("does not count the other branch as people who stopped", () => {
    const steps = funnelSteps(forked, forkEdges);
    const counted = countSteps(steps, { ask: 10, adviser: 4, course: 6 }, 10, forkEdges);

    const adviser = counted.find((s) => s.nodeId === "adviser")!;
    const course = counted.find((s) => s.nodeId === "course")!;

    // Both come from `ask`, so each is measured against it, never against
    // the other.
    // 10 answered, 4 + 6 took one of the two offers, so nobody was lost at
    // the fork and neither branch is blamed for the other's people.
    expect(adviser.lostBefore).toBe(0);
    expect(course.lostBefore).toBeNull();
    expect(course.afterFork).toBe(true);
  });

  it("marks a sequential step as not being after a fork", () => {
    const counted = countSteps(funnelSteps(nodes, edges), { ask: 70, offer: 42 }, 100, edges);
    expect(counted[1].afterFork).toBe(false);
  });
});

describe("a fork where people really were lost", () => {
  const forked: RawNode[] = [
    { id: "t", type: "trigger", data: {} },
    { id: "ask", type: "sendMessage", data: { isFunnelStep: true, label: "Perguntou" } },
    { id: "adviser", type: "sendMessage", data: { isFunnelStep: true, label: "Oferta adviser" } },
    { id: "course", type: "sendMessage", data: { isFunnelStep: true, label: "Oferta curso" } },
  ];
  const forkEdges: RawEdge[] = [
    { source: "t", target: "ask" },
    { source: "ask", target: "adviser", sourceHandle: "A" },
    { source: "ask", target: "course", sourceHandle: "B" },
  ];

  it("counts only the people who took neither branch", () => {
    // 10 answered; 2 saw an offer; 8 answered and then went quiet.
    const counted = countSteps(
      funnelSteps(forked, forkEdges),
      { ask: 10, adviser: 0, course: 2 },
      10,
      forkEdges
    );

    const adviser = counted.find((s) => s.nodeId === "adviser")!;
    expect(adviser.lostBefore).toBe(8);
    // The loss belongs to the fork, so it is not repeated on the sibling.
    expect(counted.find((s) => s.nodeId === "course")!.lostBefore).toBeNull();
  });
});
