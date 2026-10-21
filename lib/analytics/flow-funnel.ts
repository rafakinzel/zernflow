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

/** Every node reachable from each node, for telling a branch from a fall. */
export function reachableFrom(edges: RawEdge[], start: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const seen = new Set<string>();
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of outgoing.get(id) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return seen;
}

export interface CountedStep extends FunnelStep {
  /** People who reached it. */
  reached: number;
  /** Share of the people who entered the flow, null when nobody entered. */
  share: number | null;
  /** People who got this far and no further, null for the first step. */
  lostBefore: number | null;
  /**
   * True when the step before it on the page cannot actually reach it: the
   * two sit on branches that exclude each other, so the difference between
   * them is a fork, not a fall.
   */
  afterFork: boolean;
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
  entered: number,
  edges: RawEdge[] = []
): CountedStep[] {
  // What each earlier step can actually lead to. A flow branches, so the
  // row above is not always the step people came from: the adviser offer
  // and the course offer exclude each other, and subtracting one from the
  // other reported everyone who took the other branch as lost.
  const reach = new Map<string, Set<string>>();
  for (const step of steps) {
    reach.set(step.nodeId, reachableFrom(edges, step.nodeId));
  }

  // The nearest earlier step that can actually reach each one. -1 means no
  // earlier step reaches it, so it is measured against everyone who entered.
  const baselines = steps.map((step, index) => {
    for (let i = index - 1; i >= 0; i--) {
      if (reach.get(steps[i].nodeId)?.has(step.nodeId)) return i;
    }
    return -1;
  });
  const baselineOf = (index: number) => baselines[index];

  return steps.map((step, index) => {
    const reached = reachedByNode[step.nodeId] ?? 0;
    const fromIndex = baselines[index];

    const previous =
      fromIndex === -1 ? entered : reachedByNode[steps[fromIndex].nodeId] ?? 0;

    // Everyone who came from the same place, this step included. At a fork
    // the people missing from one branch are standing in another, so the
    // loss is what the fork lost altogether, not what each branch lacks.
    const siblings = steps.filter((_, i) => baselineOf(i) === fromIndex);
    const reachedAcross = siblings.reduce(
      (sum, s) => sum + (reachedByNode[s.nodeId] ?? 0),
      0
    );

    // Counted once, on the first branch out of the fork; the others say
    // they are branches rather than repeating the same loss.
    const firstOfFork = siblings[0]?.nodeId === step.nodeId;
    const lost = previous - reachedAcross;

    return {
      ...step,
      reached,
      share: entered > 0 ? reached / entered : null,
      lostBefore: entered === 0 || !firstOfFork ? null : Math.max(lost, 0),
      afterFork: siblings.length > 1 && !firstOfFork,
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
