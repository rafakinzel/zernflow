/**
 * Per-node and per-button numbers for the builder.
 *
 * A flow report that lives on another screen makes you hold the structure in
 * your head while you read the numbers. Drawing them on the nodes answers
 * "where do people stop" by looking at the picture, and the per-button share
 * answers the question a node-level count cannot: which of three options the
 * person took, and which one nobody takes.
 *
 * Everything here is arithmetic over rows the caller fetched, so the maths
 * can be tested without a database.
 */

interface RawOption {
  payload?: string | null;
  title?: string | null;
}

interface RawBubble {
  buttons?: RawOption[];
  quickReplies?: RawOption[];
}

export interface RawNode {
  id: string;
  data?: { messages?: unknown } | null;
}

export interface RawEdge {
  source: string;
  target: string;
  /** A button's payload, for the per-button exits; absent on a plain edge. */
  sourceHandle?: string | null;
}

/**
 * How far back to look for the node that drew a button.
 *
 * In practice it is one hop: a message, then the Smart Delay that waits on
 * it. A couple more covers a rescue that routes through a condition first,
 * and the cap stops a cycle from walking forever.
 */
const MAX_HOPS_BACK = 4;

export interface ButtonStat {
  payload: string;
  title: string;
  taps: number;
  /**
   * Taps divided by the people who reached the node. Null when nobody did:
   * a node nothing ran through has no tap rate, it has no denominator.
   */
  rate: number | null;
}

export interface NodeStat {
  reached: number;
  buttons: ButtonStat[];
}

/** Every option a node offers, in the order the person sees them. */
export function nodeOptions(node: RawNode): RawOption[] {
  const messages = node.data?.messages;
  if (!Array.isArray(messages)) return [];

  const options: RawOption[] = [];
  for (const message of messages as RawBubble[]) {
    for (const option of [
      ...(message?.buttons ?? []),
      ...(message?.quickReplies ?? []),
    ]) {
      // A link button has no payload: tapping it tells the platform, not us.
      if (option?.payload) options.push(option);
    }
  }
  return options;
}

/** The payload's option on a node, when that node offers it. */
function optionOn(node: RawNode, payload: string) {
  for (const option of nodeOptions(node)) {
    if (option.payload === payload) {
      return { nodeId: node.id, title: option.title?.trim() || payload };
    }
  }
  return null;
}

/**
 * The node that offered a payload.
 *
 * A tap arrives knowing only its payload, and the node waiting when it lands
 * is the delay after the message, not the message that drew the button.
 *
 * Scanning the flow for the payload is not enough, because the same payload
 * is deliberately reused: a rescue message re-offers the original buttons so
 * the reply lands back on the condition that already exists. `FA_SIM` is on
 * the pitch and on the rescue, and crediting both taps to whichever comes
 * first in the array would quietly make the busier of the two look better
 * than it is.
 *
 * So when the waiting node is known, the walk starts there and goes
 * backwards: the nearest node offering the payload is the one the person was
 * actually looking at. The flow-wide scan stays as the fallback for a tap
 * with no session behind it.
 */
export function findPayloadOwner(
  nodes: RawNode[],
  payload: string,
  context?: { waitingAt?: string | null; edges?: RawEdge[] }
): { nodeId: string; title: string } | null {
  const waitingAt = context?.waitingAt;
  const edges = context?.edges;

  if (waitingAt && edges?.length) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let frontier = [waitingAt];
    const seen = new Set(frontier);

    for (let hop = 0; hop < MAX_HOPS_BACK && frontier.length > 0; hop++) {
      const found = frontier
        .map((id) => byId.get(id))
        .filter((node): node is RawNode => Boolean(node))
        .map((node) => optionOn(node, payload))
        .find((owner) => owner !== null);
      if (found) return found;

      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of edges) {
          if (edge.target === id && !seen.has(edge.source)) {
            seen.add(edge.source);
            next.push(edge.source);
          }
        }
      }
      frontier = next;
    }
  }

  for (const node of nodes) {
    const owner = optionOn(node, payload);
    if (owner) return owner;
  }
  return null;
}

/**
 * Folds the event rows into one entry per node.
 *
 * A node with no events still appears, with zeros, because a message that
 * nobody reached is exactly what the reader is looking for and leaving it
 * out of the map would render it as "no data" instead of "nobody got here".
 */
export function buildNodeStats({
  nodes,
  reachedByNode,
  tapsByPayload,
}: {
  nodes: RawNode[];
  reachedByNode: Record<string, number>;
  tapsByPayload: Record<string, number>;
}): Record<string, NodeStat> {
  const stats: Record<string, NodeStat> = {};

  for (const node of nodes) {
    const reached = reachedByNode[node.id] ?? 0;
    const options = nodeOptions(node);

    stats[node.id] = {
      reached,
      buttons: options.map((option) => {
        const payload = option.payload as string;
        const taps = tapsByPayload[payload] ?? 0;
        return {
          payload,
          title: option.title?.trim() || payload,
          taps,
          rate: reached > 0 ? taps / reached : null,
        };
      }),
    };
  }

  return stats;
}

/** Counts rows by a key read out of each row, skipping the ones without it. */
export function tally<T>(rows: T[], key: (row: T) => string | null | undefined) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Every node that offers a payload and has an exit drawn for it.
 *
 * People tap a button they have scrolled back to. The flow has moved on by
 * then, so the node the session is parked on knows nothing about that
 * payload, and routing from where the session happens to be sends them
 * somewhere they did not choose. The button itself still knows where it goes,
 * and this is how to ask it.
 *
 * Several nodes can offer the same payload, because a rescue re-offers the
 * original buttons. The caller settles which one by looking at what was
 * actually sent to this person most recently; this only narrows the field.
 */
export function payloadRoutes(
  nodes: RawNode[],
  edges: RawEdge[],
  payload: string
): Array<{ nodeId: string; targetId: string }> {
  const routes: Array<{ nodeId: string; targetId: string }> = [];
  for (const node of nodes) {
    if (!nodeOptions(node).some((o) => o.payload === payload)) continue;
    const edge = edges.find(
      (e) => e.source === node.id && e.sourceHandle === payload
    );
    if (edge) routes.push({ nodeId: node.id, targetId: edge.target });
  }
  return routes;
}
