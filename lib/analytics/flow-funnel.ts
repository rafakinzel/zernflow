/**
 * The steps of a flow's funnel, as the flow itself declares them.
 *
 * Which moments matter is a question about the business, not about the
 * graph: "saw the offer" is a different node in every flow and moves
 * whenever the flow is rewritten. So the flow carries the answer. A node
 * marked as a funnel step in the builder becomes a row here, and nothing
 * else does, which means rewriting a flow never leaves a report measuring
 * nodes that no longer mean what they used to.
 */

export interface RawNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface RawEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface FunnelStep {
  nodeId: string;
  label: string;
  /** How far from the trigger, which is the order people meet them in. */
  depth: number;
}

/** A short name for the step, falling back to the node's own first words. */
function stepLabel(node: RawNode): string {
  const given = (node.data?.funnelLabel as string | undefined)?.trim();
  if (given) return given;

  const label = (node.data?.label as string | undefined)?.trim();
  if (label) return label;

  const messages = node.data?.messages;
  if (Array.isArray(messages)) {
    for (const message of messages as Array<{ text?: string }>) {
      const text = message?.text?.trim();
      if (text) {
        const oneLine = text.replace(/\s+/g, " ").trim();
        return oneLine.length > 40 ? `${oneLine.slice(0, 39)}…` : oneLine;
      }
    }
  }
  return node.id;
}

/**
 * How many edges from the trigger each node sits, by breadth-first walk.
 *
 * Branches mean a node can be reached several ways; the shortest is the one
 * used, so a step on a short branch does not sort after a later step on a
 * long one. A node nothing reaches gets no depth and sorts last, since the
 * alternative is dropping it silently from the report.
 */
export function depths(nodes: RawNode[], edges: RawEdge[]): Map<string, number> {
  const start = nodes.find((n) => n.type === "trigger")?.id ?? nodes[0]?.id;
  const found = new Map<string, number>();
  if (!start) return found;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  found.set(start, 0);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const depth = found.get(id) ?? 0;
      for (const target of outgoing.get(id) ?? []) {
        if (found.has(target)) continue;
        found.set(target, depth + 1);
        next.push(target);
      }
    }
    frontier = next;
  }
  return found;
}

/** Every node the flow marks as a funnel step, in the order people meet them. */
export function funnelSteps(nodes: RawNode[], edges: RawEdge[]): FunnelStep[] {
  const depthOf = depths(nodes, edges);
  const unreachable = Number.MAX_SAFE_INTEGER;

  return nodes
    .filter((n) => n.data?.isFunnelStep === true)
    .map((n) => ({
      nodeId: n.id,
      label: stepLabel(n),
      depth: depthOf.get(n.id) ?? unreachable,
    }))
    .sort((a, b) => a.depth - b.depth);
}

export interface CountedStep extends FunnelStep {
  /** People who reached it. */
  reached: number;
  /** Share of the people who entered the flow, null when nobody entered. */
  share: number | null;
  /** People who got this far and no further, null for the first step. */
  lostBefore: number | null;
}

/**
 * Puts the counts against the steps.
 *
 * A later step with more people than the one before it is reported as it
 * was measured rather than smoothed: it is a real thing that happens when a
 * rescue sends someone back through a node, and hiding it would make the
 * report lie to protect a shape.
 */
export function countSteps(
  steps: FunnelStep[],
  reachedByNode: Record<string, number>,
  entered: number
): CountedStep[] {
  return steps.map((step, index) => {
    const reached = reachedByNode[step.nodeId] ?? 0;
    const previous =
      index === 0 ? entered : reachedByNode[steps[index - 1].nodeId] ?? 0;
    const lost = previous - reached;

    return {
      ...step,
      reached,
      share: entered > 0 ? reached / entered : null,
      lostBefore: index === 0 && entered === 0 ? null : Math.max(lost, 0),
    };
  });
}

/** The step with the steepest fall, which is where to spend the next hour. */
export function biggestDrop(steps: CountedStep[]): CountedStep | null {
  let worst: CountedStep | null = null;
  for (const step of steps) {
    if (step.lostBefore === null || step.lostBefore <= 0) continue;
    if (!worst || step.lostBefore > (worst.lostBefore ?? 0)) worst = step;
  }
  return worst;
}
