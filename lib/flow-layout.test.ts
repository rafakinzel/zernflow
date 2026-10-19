import { describe, it, expect } from "vitest";
import { layoutFlow, type LayoutNode } from "./flow-layout";

function node(id: string, x = 0, y = 0, type = "sendMessage"): LayoutNode {
  return { id, type, position: { x, y } };
}

describe("layoutFlow", () => {
  it("returns nothing for an empty flow", () => {
    expect(layoutFlow([], [])).toEqual({});
  });

  it("places a chain in order down the canvas", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];

    const pos = layoutFlow(nodes, edges);

    expect(Object.keys(pos).sort()).toEqual(["a", "b", "c"]);
    expect(pos.a.y).toBeLessThan(pos.b.y);
    expect(pos.b.y).toBeLessThan(pos.c.y);
  });

  it("puts the two sides of a branch at the same depth, side by side", () => {
    const nodes = [node("q", 0, 0, "condition"), node("yes"), node("no")];
    const edges = [
      { source: "q", target: "yes" },
      { source: "q", target: "no" },
    ];

    const pos = layoutFlow(nodes, edges);

    expect(pos.yes.y).toBe(pos.no.y);
    expect(pos.yes.x).not.toBe(pos.no.x);
  });

  // Parking a node off to the side is deliberate; a layout pass that drags it
  // into the column would destroy work rather than tidy it.
  it("leaves a node no edge touches exactly where it was", () => {
    const nodes = [node("a"), node("b"), node("scratch", 4_000, -2_000)];
    const edges = [{ source: "a", target: "b" }];

    const pos = layoutFlow(nodes, edges);

    expect(pos.scratch).toBeUndefined();
    expect(Object.keys(pos).sort()).toEqual(["a", "b"]);
  });

  it("ignores an edge whose node is gone instead of skewing the ranks", () => {
    const nodes = [node("a"), node("b")];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "deleted" },
    ];

    const pos = layoutFlow(nodes, edges);

    expect(pos.deleted).toBeUndefined();
    expect(pos.a.y).toBeLessThan(pos.b.y);
  });

  it("positions by the top-left corner, not the centre", () => {
    // A single measured node should land at the graph margin, not half a card
    // above it, which is what copying dagre's centre coordinates would give.
    const nodes: LayoutNode[] = [
      { id: "a", type: "sendMessage", position: { x: 0, y: 0 }, measured: { width: 200, height: 100 } },
      { id: "b", type: "sendMessage", position: { x: 0, y: 0 }, measured: { width: 200, height: 100 } },
    ];

    const pos = layoutFlow(nodes, [{ source: "a", target: "b" }]);

    expect(pos.a.x).toBeGreaterThanOrEqual(0);
    expect(pos.a.y).toBeGreaterThanOrEqual(0);
  });

  it("uses measured sizes to space rows further apart than default ones", () => {
    const edges = [{ source: "a", target: "b" }];
    const plain = layoutFlow([node("a"), node("b")], edges);
    const tall = layoutFlow(
      [
        { id: "a", type: "sendMessage", position: { x: 0, y: 0 }, measured: { width: 224, height: 600 } },
        { id: "b", type: "sendMessage", position: { x: 0, y: 0 }, measured: { width: 224, height: 600 } },
      ],
      edges
    );

    expect(tall.b.y - tall.a.y).toBeGreaterThan(plain.b.y - plain.a.y);
  });
});
