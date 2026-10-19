/**
 * Walks one path through a flow and turns it into the thread a contact
 * would receive, so copy can be read in order instead of node by node.
 */

interface RawNode {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
}

interface RawEdge {
  id?: string;
  source?: string;
  target?: string;
  sourceHandle?: string | null;
}

export interface ThreadBubble {
  text?: string;
  mediaUrl?: string;
  imageUrl?: string;
  mediaType?: "image" | "video" | "audio";
  delaySeconds?: number;
  buttons?: Array<{ title: string; type: "postback" | "url"; payload?: string; url?: string }>;
  quickReplies?: Array<{ title: string; payload: string }>;
}

export type ThreadStep =
  | { kind: "message"; nodeId: string; bubbles: ThreadBubble[] }
  | { kind: "wait"; nodeId: string; label: string }
  | { kind: "reply"; nodeId: string; label: string }
  | { kind: "action"; nodeId: string; label: string };

export interface Branch {
  /** Edge taken when this branch is chosen. */
  edgeId: string;
  handle: string;
  label: string;
}

export interface Thread {
  steps: ThreadStep[];
  /** Branches waiting on a choice, or null when the path simply ended. */
  pending: Branch[] | null;
  /** Why the walk stopped, for the panel to explain itself. */
  ending: "branch" | "end" | "loop";
}

/** Guard against the re-ask loops a flow legitimately contains. */
const MAX_STEPS = 200;

function nodeKind(node: RawNode): string {
  if (node.type !== "action") return String(node.type ?? "unknown");
  return String(node.data?.actionType ?? "action");
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The label for one side of a branch.
 *
 * A condition that tests a button's payload is labelled with the button's
 * own words, found by searching the flow for whichever button carries that
 * payload. "Sim, é isso mesmo!" tells the reader what they are choosing;
 * "Yes" only repeats the handle name back at them.
 */
function branchLabel(
  node: RawNode,
  handle: string,
  nodes: RawNode[]
): string {
  const conditions = node.data?.conditions;
  const first = Array.isArray(conditions) ? conditions[0] : undefined;
  const payload =
    first &&
    typeof first === "object" &&
    (first as { field?: string }).field === "variable:payload"
      ? String((first as { value?: string }).value ?? "")
      : "";

  if (payload && (handle === "yes" || handle === "true")) {
    const title = findButtonTitle(nodes, payload);
    if (title) return title;
  }

  if (payload && (handle === "no" || handle === "false")) {
    const title = findButtonTitle(nodes, payload);
    if (title) return `Anything other than "${title}"`;
  }

  const fallbacks: Record<string, string> = {
    yes: "Yes",
    true: "Yes",
    no: "No",
    false: "No",
    reply: "They reply",
    timeout: "No reply",
  };

  return fallbacks[handle] ?? handle ?? "Continue";
}

function findButtonTitle(nodes: RawNode[], payload: string): string | null {
  for (const node of nodes) {
    const messages = node.data?.messages;
    if (!Array.isArray(messages)) continue;
    for (const message of messages as ThreadBubble[]) {
      for (const option of [
        ...(message.buttons ?? []),
        ...(message.quickReplies ?? []),
      ]) {
        if (option.payload === payload && option.title?.trim()) {
          return option.title.trim();
        }
      }
    }
  }
  return null;
}

function describeAction(node: RawNode): string | null {
  const data = node.data ?? {};
  switch (nodeKind(node)) {
    case "setCustomField":
      return `Saves ${String(data.fieldSlug ?? "a field")}`;
    case "addTag":
      return `Tags "${String(data.tagName ?? "")}"`;
    case "removeTag":
      return `Removes tag "${String(data.tagName ?? "")}"`;
    case "activeCampaign":
      return "Sends the contact to ActiveCampaign";
    case "humanTakeover":
      return "Hands the conversation to a person";
    case "goToFlow":
      return "Moves the contact to another flow";
    default:
      return null;
  }
}

/**
 * Follows the flow from its trigger, taking `choices` in order at each
 * branch, and returns everything the contact would see up to the next
 * unanswered branch.
 *
 * Side effects are reported rather than hidden: a reader checking copy still
 * wants to know a tag is applied here, even though nothing is sent.
 */
export function buildThread(
  rawNodes: unknown,
  rawEdges: unknown,
  choices: string[] = []
): Thread {
  const nodes: RawNode[] = Array.isArray(rawNodes) ? (rawNodes as RawNode[]) : [];
  const edges: RawEdge[] = Array.isArray(rawEdges) ? (rawEdges as RawEdge[]) : [];

  const byId = new Map(nodes.filter((n) => n.id).map((n) => [String(n.id), n]));
  const steps: ThreadStep[] = [];

  let current: RawNode | undefined = nodes.find((n) => n.type === "trigger");
  if (!current) return { steps, pending: null, ending: "end" };

  let choiceIndex = 0;
  let guard = 0;

  while (current && guard++ < MAX_STEPS) {
    const node: RawNode = current;
    const id = String(node.id);
    const kind = nodeKind(node);

    if (kind === "sendMessage") {
      const messages = node.data?.messages;
      if (Array.isArray(messages) && messages.length > 0) {
        steps.push({ kind: "message", nodeId: id, bubbles: messages as ThreadBubble[] });
      }
    } else if (kind === "delay") {
      const duration = Number(node.data?.duration ?? 0);
      const unit = String(node.data?.unit ?? "seconds").replace(/s$/, "");
      steps.push({ kind: "wait", nodeId: id, label: `Waits ${plural(duration, unit)}` });
    } else if (kind === "smartDelay") {
      const timeout = Number(node.data?.timeout ?? 0);
      const unit = String(node.data?.timeoutUnit ?? "hours").replace(/s$/, "");
      steps.push({
        kind: "reply",
        nodeId: id,
        label: timeout
          ? `Waits for a reply, up to ${plural(timeout, unit)}`
          : "Waits for a reply",
      });
    } else {
      const label = describeAction(node);
      if (label) steps.push({ kind: "action", nodeId: id, label });
    }

    const outgoing: RawEdge[] = edges.filter((e) => e.source === id);
    if (outgoing.length === 0) {
      return { steps, pending: null, ending: "end" };
    }

    let next: RawEdge | undefined;

    if (outgoing.length === 1) {
      next = outgoing[0];
    } else {
      const branches: Branch[] = outgoing.map((e) => ({
        edgeId: String(e.id ?? `${e.source}->${e.target}`),
        handle: String(e.sourceHandle ?? ""),
        label: branchLabel(node, String(e.sourceHandle ?? ""), nodes),
      }));

      const chosen = choices[choiceIndex++];
      next = outgoing.find(
        (e) => String(e.id ?? `${e.source}->${e.target}`) === chosen
      );

      if (!next) return { steps, pending: branches, ending: "branch" };
    }

    const target: RawNode | undefined = next?.target
      ? byId.get(String(next.target))
      : undefined;
    if (!target) return { steps, pending: null, ending: "end" };
    current = target;
  }

  return { steps, pending: null, ending: "loop" };
}
