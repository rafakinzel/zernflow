/**
 * Where each exit of a node actually goes, written on the node.
 *
 * Following a line across a canvas is fine with six nodes and impossible
 * with forty. Worse, a line that goes nowhere looks the same as one that was
 * never drawn, so the exits that silently end a conversation are invisible
 * precisely when they matter.
 *
 * A button is the hard case. It does not route anything by itself: the
 * message hands off to a Smart Delay, the delay waits, and a condition
 * downstream reads the payload and picks a side. So "where does this button
 * take the person" is a short walk, and this module does the walking once so
 * the canvas can answer the question in place.
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

export interface Destination {
  /** Handle name, or the button's payload. */
  key: string;
  /** What the reader is choosing: a button's own words, or "No reply". */
  label: string;
  /** Null when this exit leads nowhere, which is the point of showing it. */
  targetId: string | null;
  targetTitle: string | null;
}

/** Enough to cross a delay and a condition a few times over. */
const MAX_HOPS = 12;
const TITLE_LENGTH = 38;

function kindOf(node: RawNode): string {
  if (node.type !== "action") return String(node.type ?? "unknown");
  return String(node.data?.actionType ?? "action");
}

function firstText(node: RawNode): string | null {
  const messages = node.data?.messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages as Array<{ text?: string }>) {
    const text = message?.text?.trim();
    if (text) return text;
  }
  return null;
}

/** Payloads a condition treats as its "yes" side. */
function expectedPayloads(node: RawNode): string[] {
  const conditions = node.data?.conditions;
  if (!Array.isArray(conditions)) return [];
  return (conditions as Array<{ field?: string; value?: string }>)
    .filter((c) => c.field === "variable:payload" && typeof c.value === "string")
    .map((c) => c.value as string);
}

/** A short name for a node, as a person would refer to it out loud. */
export function nodeTitle(
  node: RawNode,
  titleForPayload?: (payload: string) => string | undefined
): string {
  const label = (node.data?.label as string | undefined)?.trim();
  const kind = kindOf(node);

  if (kind === "sendMessage") {
    const text = firstText(node);
    if (text) {
      const oneLine = text.replace(/\s+/g, " ").trim();
      return oneLine.length > TITLE_LENGTH
        ? `${oneLine.slice(0, TITLE_LENGTH - 1)}…`
        : oneLine;
    }
    return label || "Message";
  }

  if (label) return label;

  switch (kind) {
    case "smartDelay": {
      const timeout = node.data?.timeout;
      const unit = (node.data?.timeoutUnit as string) ?? "hours";
      return timeout ? `Wait ${timeout}${unit === "hours" ? "h" : unit[0]}` : "Wait";
    }
    case "delay": {
      const duration = node.data?.duration;
      const unit = (node.data?.unit as string) ?? "hours";
      return duration
        ? `Pause ${duration}${unit === "hours" ? "h" : unit === "minutes" ? "min" : "s"}`
        : "Pause";
    }
    case "condition": {
      // "Condition" tells a reader nothing. What the fork actually asks is
      // which answer the person gave, so name it with that answer.
      const asked = expectedPayloads(node)
        .map((p) => titleForPayload?.(p))
        .find(Boolean);
      return asked ? `Chose "${asked}"?` : "Condition";
    }
    case "humanTakeover":
      return "Human takeover";
    case "setCustomField":
      return "Save field";
    case "trigger":
      return "Trigger";
    default:
      return kind;
  }
}

/** Every option a node offers, in the order the person sees them. */
function options(node: RawNode): Array<{ payload: string; title: string }> {
  const messages = node.data?.messages;
  if (!Array.isArray(messages)) return [];

  const found: Array<{ payload: string; title: string }> = [];
  for (const message of messages as Array<{
    buttons?: Array<{ payload?: string; title?: string }>;
    quickReplies?: Array<{ payload?: string; title?: string }>;
  }>) {
    for (const option of [
      ...(message?.buttons ?? []),
      ...(message?.quickReplies ?? []),
    ]) {
      if (option?.payload) {
        found.push({ payload: option.payload, title: option.title?.trim() || option.payload });
      }
    }
  }
  return found;
}

function edgeFrom(edges: RawEdge[], source: string, handle?: string) {
  if (handle) {
    return edges.find((e) => e.source === source && e.sourceHandle === handle);
  }
  // A plain exit: anything that is not one of the named branch handles.
  return edges.find(
    (e) =>
      e.source === source &&
      !["yes", "no", "true", "false", "reply", "timeout"].includes(
        e.sourceHandle ?? ""
      )
  );
}

/**
 * The first message a button leads to.
 *
 * Walks forward from the node that drew the button, taking the "replied"
 * side of any wait and the side of any condition that matches this payload.
 * Stops at the first message, which is what the person would see next.
 */
function resolveButton(
  nodes: RawNode[],
  edges: RawEdge[],
  fromId: string,
  payload: string
): RawNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let edge = edgeFrom(edges, fromId);
  let last: RawNode | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!edge) return last;
    const node = byId.get(edge.target);
    if (!node) return last;

    const kind = kindOf(node);
    if (kind === "sendMessage") return node;

    last = node;
    if (kind === "smartDelay") {
      edge = edgeFrom(edges, node.id, "reply");
    } else if (kind === "condition") {
      const matches = expectedPayloads(node).includes(payload);
      edge =
        edgeFrom(edges, node.id, matches ? "yes" : "no") ??
        edgeFrom(edges, node.id, matches ? "true" : "false");
    } else {
      edge = edgeFrom(edges, node.id);
    }
  }
  return last;
}

/**
 * Every exit of every node, with where it lands.
 *
 * A node with buttons reports one entry per button. A condition and a Smart
 * Delay report their two sides. Everything else reports its single exit, and
 * only when it leads somewhere, since "Next" on a node with one line drawn
 * out of it adds nothing.
 */
export function nodeDestinations(
  nodes: RawNode[],
  edges: RawEdge[]
): Record<string, Destination[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const allOptions = nodes.flatMap(options);
  const titleForPayload = (payload: string) =>
    allOptions.find((o) => o.payload === payload)?.title;
  const named = (id: string | undefined | null) => {
    const node = id ? byId.get(id) : undefined;
    return node
      ? { targetId: node.id, targetTitle: nodeTitle(node, titleForPayload) }
      : {
      targetId: null,
      targetTitle: null,
    };
  };

  const result: Record<string, Destination[]> = {};

  for (const node of nodes) {
    const kind = kindOf(node);
    const exits: Destination[] = [];

    if (kind === "condition") {
      const payloads = expectedPayloads(node);
      // The button's own words beat "Yes": a reader learns what is being
      // chosen rather than which handle the developer named.
      const yesLabel = payloads.map(titleForPayload).find(Boolean) ?? "Yes";

      exits.push({
        key: "yes",
        label: yesLabel,
        ...named(edgeFrom(edges, node.id, "yes")?.target ?? edgeFrom(edges, node.id, "true")?.target),
      });
      exits.push({
        key: "no",
        label: "Anything else",
        ...named(edgeFrom(edges, node.id, "no")?.target ?? edgeFrom(edges, node.id, "false")?.target),
      });
    } else if (kind === "smartDelay") {
      exits.push({
        key: "reply",
        label: "They reply",
        ...named(edgeFrom(edges, node.id, "reply")?.target),
      });
      exits.push({
        key: "timeout",
        label: "No reply",
        ...named(edgeFrom(edges, node.id, "timeout")?.target),
      });
    } else {
      const buttons = options(node);
      if (buttons.length > 0) {
        for (const button of buttons) {
          const target = resolveButton(nodes, edges, node.id, button.payload);
          exits.push({
            key: button.payload,
            label: button.title,
            targetId: target?.id ?? null,
            targetTitle: target ? nodeTitle(target, titleForPayload) : null,
          });
        }
      } else {
        const target = edgeFrom(edges, node.id)?.target;
        // Only worth saying when it goes nowhere: that is the dead end a
        // reader cannot otherwise see.
        if (!target) {
          exits.push({ key: "next", label: "Then", targetId: null, targetTitle: null });
        }
      }
    }

    result[node.id] = exits;
  }

  return result;
}
