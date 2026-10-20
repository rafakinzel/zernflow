/**
 * Moves a button's route onto the button.
 *
 * The old shape spelled a choice out in three nodes: a message drew the
 * buttons, a Smart Delay waited, and a condition downstream read the payload
 * and picked a side. It runs correctly and it reads terribly, because the
 * button points at nothing. You cannot draw a line from a button that does
 * not own a destination, so reviewing a flow meant tracing the plumbing.
 *
 * This rewrites that shape into one node with one exit per button. The
 * message keeps the wait, each payload becomes a handle, and the conditions
 * that existed only to sort payloads are dropped.
 *
 * It is deliberately conservative. A condition that tests anything other
 * than a tapped payload is left standing and becomes the destination, a
 * Smart Delay that something else also points at is left alone, and a
 * condition is only deleted once nothing points at it any more. Nothing is
 * rewired on a guess.
 */

export interface RawNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface RawEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  [key: string]: unknown;
}

export interface ChangeLog {
  messageId: string;
  delayId: string;
  /** payload → the node that payload now points at. */
  routes: Record<string, string>;
  /** Where free text, or a button with no route, now goes. */
  fallback: string | null;
  timeout: string | null;
  removedConditions: string[];
}

export interface MigrationResult {
  nodes: RawNode[];
  edges: RawEdge[];
  changes: ChangeLog[];
}

const BRANCH_HANDLES = ["yes", "no", "true", "false", "reply", "timeout"];
const MAX_CONDITION_HOPS = 10;

function kindOf(node: RawNode): string {
  if (node.type !== "action") return String(node.type ?? "unknown");
  return String(node.data?.actionType ?? "action");
}

/** Payload buttons and quick replies, in the order the person sees them. */
function payloadsOf(node: RawNode): string[] {
  const messages = node.data?.messages;
  if (!Array.isArray(messages)) return [];

  const found: string[] = [];
  for (const message of messages as Array<{
    buttons?: Array<{ payload?: string }>;
    quickReplies?: Array<{ payload?: string }>;
  }>) {
    for (const option of [
      ...(message?.buttons ?? []),
      ...(message?.quickReplies ?? []),
    ]) {
      // A link button reports to the platform, not to us, so it has no exit.
      if (option?.payload && !found.includes(option.payload)) {
        found.push(option.payload);
      }
    }
  }
  return found;
}

/**
 * True when every test on this condition is "which button was tapped".
 *
 * A condition that also checks a stored field cannot be replaced by a
 * button's own exit, because the answer depends on more than the tap.
 */
function sortsPayloadsOnly(node: RawNode): boolean {
  const conditions = node.data?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  return (conditions as Array<{ field?: string; operator?: string }>).every(
    (c) => c.field === "variable:payload" && (c.operator ?? "equals") === "equals"
  );
}

function expectedPayloads(node: RawNode): string[] {
  const conditions = node.data?.conditions;
  if (!Array.isArray(conditions)) return [];
  return (conditions as Array<{ value?: string }>)
    .map((c) => c.value)
    .filter((v): v is string => typeof v === "string");
}

function edgeFrom(edges: RawEdge[], source: string, handle?: string) {
  if (handle) {
    const wanted = handle === "yes" ? ["yes", "true"] : handle === "no" ? ["no", "false"] : [handle];
    return edges.find((e) => e.source === source && wanted.includes(e.sourceHandle ?? ""));
  }
  return edges.find(
    (e) => e.source === source && !BRANCH_HANDLES.includes(e.sourceHandle ?? "")
  );
}

/**
 * Follows the condition chain for one payload and reports where it lands.
 *
 * `payload` of null is the free-text case: nothing matches, so every
 * condition takes its "anything else" side.
 */
function resolve(
  byId: Map<string, RawNode>,
  edges: RawEdge[],
  startId: string,
  payload: string | null,
  visited: string[]
): string | null {
  let current: string | null = startId;

  for (let hop = 0; hop < MAX_CONDITION_HOPS; hop++) {
    if (!current) return null;
    const node = byId.get(current);
    if (!node) return null;
    if (kindOf(node) !== "condition" || !sortsPayloadsOnly(node)) return current;

    if (!visited.includes(node.id)) visited.push(node.id);
    const matches = payload !== null && expectedPayloads(node).includes(payload);
    current = edgeFrom(edges, node.id, matches ? "yes" : "no")?.target ?? null;
  }
  return current;
}

/** Rewrites every message whose choice is spelled out downstream. */
export function inlineButtonRouting(
  nodes: RawNode[],
  edges: RawEdge[]
): MigrationResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const changes: ChangeLog[] = [];

  const removedNodeIds = new Set<string>();
  const conditionCandidates = new Set<string>();
  const droppedEdges = new Set<RawEdge>();
  const addedEdges: RawEdge[] = [];
  const waits = new Map<string, { timeout?: number; timeoutUnit?: string }>();

  let seq = 0;
  const makeEdge = (source: string, target: string, handle: string): RawEdge => ({
    id: `e_btn_${source}_${handle}_${seq++}`,
    source,
    target,
    sourceHandle: handle,
    animated: true,
    style: { stroke: "var(--border)", strokeWidth: 2 },
  });

  for (const node of nodes) {
    if (kindOf(node) !== "sendMessage") continue;
    const payloads = payloadsOf(node);
    if (payloads.length === 0) continue;

    const toDelay = edgeFrom(edges, node.id);
    if (!toDelay) continue;
    const delay = byId.get(toDelay.target);
    if (!delay || kindOf(delay) !== "smartDelay") continue;

    // Something else feeding the delay means collapsing it would silently
    // change that other path too.
    const intoDelay = edges.filter((e) => e.target === delay.id);
    if (intoDelay.length !== 1) continue;

    const replyTarget = edgeFrom(edges, delay.id, "reply")?.target;
    if (!replyTarget) continue;

    const visited: string[] = [];
    const routes: Record<string, string> = {};
    for (const payload of payloads) {
      const target = resolve(byId, edges, replyTarget, payload, visited);
      if (target) routes[payload] = target;
    }
    const fallback = resolve(byId, edges, replyTarget, null, visited);
    const timeoutTarget = edgeFrom(edges, delay.id, "timeout")?.target ?? null;

    // Nothing resolved means the chain is shaped in a way this does not
    // understand. Leaving it exactly as it is beats half-rewriting it.
    if (Object.keys(routes).length === 0 && !fallback) continue;

    for (const [payload, target] of Object.entries(routes)) {
      addedEdges.push(makeEdge(node.id, target, payload));
    }
    if (fallback) addedEdges.push(makeEdge(node.id, fallback, "reply"));
    if (timeoutTarget) addedEdges.push(makeEdge(node.id, timeoutTarget, "timeout"));

    waits.set(node.id, {
      timeout: delay.data?.timeout as number | undefined,
      timeoutUnit: delay.data?.timeoutUnit as string | undefined,
    });

    droppedEdges.add(toDelay);
    removedNodeIds.add(delay.id);
    for (const id of visited) conditionCandidates.add(id);

    changes.push({
      messageId: node.id,
      delayId: delay.id,
      routes,
      fallback,
      timeout: timeoutTarget,
      removedConditions: [...visited],
    });
  }

  // The delays go, and everything attached to them with it.
  let nextEdges = edges
    .filter((e) => !droppedEdges.has(e))
    .filter((e) => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target))
    .concat(addedEdges);

  // A condition only goes once nothing points at it any more. One that is
  // still reachable from somewhere this did not rewrite has to stay.
  let settled = false;
  while (!settled) {
    settled = true;
    for (const id of conditionCandidates) {
      if (removedNodeIds.has(id)) continue;
      const stillReached = nextEdges.some((e) => e.target === id);
      if (!stillReached) {
        removedNodeIds.add(id);
        nextEdges = nextEdges.filter((e) => e.source !== id && e.target !== id);
        settled = false;
      }
    }
  }

  const nextNodes = nodes
    .filter((n) => !removedNodeIds.has(n.id))
    .map((n) => {
      const wait = waits.get(n.id);
      if (!wait) return n;
      return {
        ...n,
        data: {
          ...(n.data ?? {}),
          waitForReply: true,
          ...(wait.timeout ? { timeout: wait.timeout } : {}),
          ...(wait.timeoutUnit ? { timeoutUnit: wait.timeoutUnit } : {}),
        },
      };
    });

  // Report only what survived: a condition kept because something else still
  // reaches it should not be listed as removed.
  for (const change of changes) {
    change.removedConditions = change.removedConditions.filter((id) =>
      removedNodeIds.has(id)
    );
  }

  return { nodes: nextNodes, edges: nextEdges, changes };
}
