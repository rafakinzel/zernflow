import dagre from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
}

export interface LayoutEdge {
  source: string;
  target: string;
}

/**
 * Sizes used when a node has not been measured yet, which is the case right
 * after a flow loads and before React Flow has rendered it. They only need to
 * be close: dagre spaces by box, and being a few pixels off shifts a column
 * rather than tangling it.
 */
const FALLBACK_SIZES: Record<string, { width: number; height: number }> = {
  trigger: { width: 224, height: 110 },
  sendMessage: { width: 224, height: 150 },
  condition: { width: 224, height: 170 },
  delay: { width: 224, height: 110 },
  action: { width: 224, height: 130 },
  aiResponse: { width: 224, height: 140 },
};

const DEFAULT_SIZE = { width: 224, height: 130 };

function sizeOf(node: LayoutNode) {
  const measuredWidth = node.measured?.width ?? node.width ?? undefined;
  const measuredHeight = node.measured?.height ?? node.height ?? undefined;
  const fallback = (node.type && FALLBACK_SIZES[node.type]) || DEFAULT_SIZE;
  return {
    width: measuredWidth || fallback.width,
    height: measuredHeight || fallback.height,
  };
}

/**
 * Lays a flow out top to bottom and returns the new positions by node id.
 *
 * Hand-placed nodes drift as a flow grows: branches overlap, a card added
 * later sits in the wrong column, and edges cross for no reason. This gives
 * one command that makes the drawing match the structure.
 *
 * Nodes that no edge touches are left exactly where they are. Dagre would
 * otherwise sweep them into the main column, which moves work the person
 * parked aside on purpose.
 */
export function layoutFlow(
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): Record<string, { x: number; y: number }> {
  if (nodes.length === 0) return {};

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", ranksep: 90, nodesep: 60, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));

  const laidOut = nodes.filter((n) => connected.has(n.id));
  const byId = new Map(laidOut.map((n) => [n.id, n]));

  for (const node of laidOut) {
    graph.setNode(node.id, sizeOf(node));
  }

  for (const edge of edges) {
    // An edge can outlive the node it pointed at; adding it would make dagre
    // invent a phantom box and skew every rank around it.
    if (byId.has(edge.source) && byId.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of laidOut) {
    const placed = graph.node(node.id);
    if (!placed) continue;
    const { width, height } = sizeOf(node);
    // Dagre centres a node on its coordinates; React Flow positions by the
    // top-left corner, so a direct copy drifts by half a card.
    positions[node.id] = {
      x: Math.round(placed.x - width / 2),
      y: Math.round(placed.y - height / 2),
    };
  }

  return positions;
}
