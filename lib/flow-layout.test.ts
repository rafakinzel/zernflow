import { describe, it, expect } from "vitest";
import { layoutFlow, type LayoutNode } from "./flow-layout";
import { LAYOUT_RANKDIR } from "./flow-orientation";

// The assertions talk about the direction the flow reads in, not about x and
// y, so they keep testing the same property if the canvas is ever flipped.
const ALONG = LAYOUT_RANKDIR === "LR" ? "x" : "y";
const ACROSS = LAYOUT_RANKDIR === "LR" ? "y" : "x";

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
    expect(pos.a[ALONG]).toBeLessThan(pos.b[ALONG]);
    expect(pos.b[ALONG]).toBeLessThan(pos.c[ALONG]);
  });

  it("puts the two sides of a branch at the same depth, side by side", () => {
    const nodes = [node("q", 0, 0, "condition"), node("yes"), node("no")];
    const edges = [
      { source: "q", target: "yes" },
      { source: "q", target: "no" },
    ];

    const pos = layoutFlow(nodes, edges);

    expect(pos.yes[ALONG]).toBe(pos.no[ALONG]);
    expect(pos.yes[ACROSS]).not.toBe(pos.no[ACROSS]);
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
    expect(pos.a[ALONG]).toBeLessThan(pos.b[ALONG]);
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

  it("uses measured sizes to space steps further apart than default ones", () => {
    const edges = [{ source: "a", target: "b" }];
    const big = ALONG === "x" ? { width: 900, height: 150 } : { width: 224, height: 600 };

    const plain = layoutFlow([node("a"), node("b")], edges);
    const large = layoutFlow(
      [
        { id: "a", type: "sendMessage", position: { x: 0, y: 0 }, measured: big },
        { id: "b", type: "sendMessage", position: { x: 0, y: 0 }, measured: big },
      ],
      edges
    );

    expect(large.b[ALONG] - large.a[ALONG]).toBeGreaterThan(
      plain.b[ALONG] - plain.a[ALONG]
    );
  });
});
