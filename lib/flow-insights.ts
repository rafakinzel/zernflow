/**
 * Reads a flow's shape and run history into the few facts the flows list
 * shows, so the page can rank and filter without opening each flow.
 */

export interface FlowTrigger {
  nodeId: string;
  triggerType: string;
  keywords: string[];
  alsoMatchInDms: boolean;
}

interface RawNode {
  id?: string;
  type?: string;
  data?: {
    triggerType?: string;
    alsoMatchInDms?: boolean;
    keywords?: Array<{ value?: string; matchType?: string }>;
  };
}

/** The trigger nodes of a flow, in canvas order. */
export function extractTriggers(nodes: unknown): FlowTrigger[] {
  if (!Array.isArray(nodes)) return [];

  return (nodes as RawNode[])
    .filter((n) => n?.type === "trigger")
    .map((n) => ({
      nodeId: String(n.id ?? ""),
      triggerType: String(n.data?.triggerType ?? "unknown"),
      keywords: (n.data?.keywords ?? [])
        .map((k) => k?.value?.trim())
        .filter((v): v is string => Boolean(v)),
      alsoMatchInDms: Boolean(n.data?.alsoMatchInDms),
    }));
}

/**
 * One line describing when a trigger fires.
 *
 * Written as the condition rather than the feature name: "Comment contains"
 * tells someone scanning the list what will actually set the flow off, where
 * "comment_keyword" only repeats the setting back at them.
 */
export function describeTrigger(trigger: FlowTrigger): string {
  const where =
    trigger.triggerType === "comment_keyword"
      ? trigger.alsoMatchInDms
        ? "Comment, DM or story reply contains"
        : "Comment contains"
      : trigger.triggerType === "dm_keyword"
        ? "DM contains"
        : trigger.triggerType === "story_reply"
          ? "Story reply contains"
          : "Fires on";

  return trigger.keywords.length > 0 ? where : `${where} any message`;
}

/**
 * Share of runs that reached an end of the flow.
 *
 * Returns null when nothing has run yet, because "0%" on a flow published an
 * hour ago reads as broken when it only means untested. The page shows a dash
 * for null rather than inventing a number.
 */
export function completionRate(
  started: number,
  completed: number
): number | null {
  if (!started || started <= 0) return null;
  return Math.round((Math.min(completed, started) / started) * 100);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Coarse "when did this last change", the way a list wants to read. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const elapsed = now.getTime() - then;
  if (elapsed < 0) return "just now";
  if (elapsed < MINUTE) return "just now";

  const units: Array<[number, string]> = [
    [WEEK, "week"],
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
  ];

  for (const [size, name] of units) {
    const count = Math.floor(elapsed / size);
    if (count >= 1) return `${count} ${name}${count === 1 ? "" : "s"} ago`;
  }

  return "just now";
}

export interface FlowCounts {
  started: number;
  completed: number;
  messagesSent: number;
}

/**
 * Folds raw analytics rows into per-flow counts.
 *
 * Aggregating here rather than in SQL keeps this page free of a database
 * view, which is the right trade while a workspace has hundreds of events
 * rather than millions. The caller caps how many rows it reads; if that cap
 * is ever hit the numbers become a floor, which is why the page labels them
 * as counts rather than as a complete history.
 */
export function tallyEvents(
  rows: Array<{ flow_id: string | null; event_type: string }>
): Record<string, FlowCounts> {
  const out: Record<string, FlowCounts> = {};

  for (const row of rows) {
    if (!row.flow_id) continue;
    const counts = (out[row.flow_id] ??= {
      started: 0,
      completed: 0,
      messagesSent: 0,
    });

    if (row.event_type === "flow_started") counts.started += 1;
    else if (row.event_type === "flow_completed") counts.completed += 1;
    else if (row.event_type === "message_sent") counts.messagesSent += 1;
  }

  return out;
}
