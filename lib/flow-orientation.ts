import { Position } from "@xyflow/react";

/**
 * Which way a flow reads on the canvas.
 *
 * Defined once so the node components, the handle offsets and the auto
 * layout can never disagree. They did disagree the moment this lived in
 * eight files: a node drawn with its output on the bottom, wired by a layout
 * that stacked columns left to right, produces edges that loop back on
 * themselves for no reason a reader can see.
 */
export const FLOW_DIRECTION: "horizontal" | "vertical" = "horizontal";

const HORIZONTAL = FLOW_DIRECTION === "horizontal";

/** Where an edge arrives. */
export const TARGET_POSITION = HORIZONTAL ? Position.Left : Position.Top;

/** Where an edge leaves. */
export const SOURCE_POSITION = HORIZONTAL ? Position.Right : Position.Bottom;

/** Rank direction for the auto-arrange pass. */
export const LAYOUT_RANKDIR = HORIZONTAL ? "LR" : "TB";

/**
 * Where to pin one of several outputs along a node's edge.
 *
 * Reading horizontally, a node's outputs stack down its right side; reading
 * vertically they spread across its bottom. Callers pass the output's index
 * and how many there are, so two handles land at a third and two thirds
 * rather than being hand-placed per node type.
 */
export function handleOffset(index: number, total: number) {
  const fraction = `${((index + 1) / (total + 1)) * 100}%`;
  return HORIZONTAL ? { top: fraction } : { left: fraction };
}

/**
 * Layout for the little labels that name a node's outputs.
 *
 * Side by side under the card when reading downwards, stacked and
 * right-aligned when reading across, so each label sits beside the handle it
 * describes instead of drifting away from it.
 */
export const BRANCH_LABELS_CLASS = HORIZONTAL
  ? "flex flex-col items-end gap-0.5 border-t border-border px-3 py-1.5"
  : "flex justify-between border-t border-border px-3 py-1.5";
