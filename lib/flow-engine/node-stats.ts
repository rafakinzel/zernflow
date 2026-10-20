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

/**
 * The node that offered a payload.
 *
 * A tap arrives knowing only its payload, and the node that was waiting when
 * it landed is the delay after the message, not the message itself. Payloads
 * are authored unique within a flow, so the first node offering it is the
 * one that offered it.
 */
export function findPayloadOwner(
  nodes: RawNode[],
  payload: string
): { nodeId: string; title: string } | null {
  for (const node of nodes) {
    for (const option of nodeOptions(node)) {
      if (option.payload === payload) {
        return { nodeId: node.id, title: option.title?.trim() || payload };
      }
    }
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
