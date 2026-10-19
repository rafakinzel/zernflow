import type { PostAction } from "./types";

/** Gap used between bubbles of one node when none was configured. */
export const DEFAULT_MESSAGE_GAP_MS = 500;

/** Ceiling for a single bubble's configured pause. */
export const MAX_MESSAGE_DELAY_MS = 30_000;

/** Ceiling for everything one Send Message node may wait, in total. */
export const MAX_NODE_INLINE_DELAY_MS = 60_000;

/** Post-actions that write variables, so the session row needs saving after. */
const STATEFUL_POST_ACTIONS = new Set(["setCustomField", "activeCampaign"]);

/**
 * How long to wait before sending one bubble of a Send Message node.
 *
 * These pauses exist so a paced sequence fits in one card instead of
 * alternating message and delay nodes. They run inside the request, so they
 * are bounded three ways: per bubble, by what is left of the node's budget,
 * and never below zero. A pause longer than the ceiling is clamped rather
 * than rejected, because the alternative is a node that silently sends
 * nothing; a wait that genuinely needs minutes belongs in a Delay node,
 * which parks the session instead of holding a webhook open.
 *
 * A bubble with no pause configured keeps the old fixed gap, so flows built
 * before this existed keep the rhythm they were built with.
 */
export function messageDelayMs(
  delaySeconds: number | undefined,
  index: number,
  budgetMs: number
): number {
  const requested = Math.max(0, (delaySeconds ?? 0) * 1000);
  const wanted = requested || (index > 0 ? DEFAULT_MESSAGE_GAP_MS : 0);
  return Math.max(
    0,
    Math.min(wanted, MAX_MESSAGE_DELAY_MS, Math.max(0, budgetMs))
  );
}

/** The side effects a node carries, ignoring anything malformed. */
export function readPostActions(data: unknown): PostAction[] {
  const actions = (data as { postActions?: unknown })?.postActions;
  if (!Array.isArray(actions)) return [];
  return actions.filter(
    (a): a is PostAction =>
      Boolean(a) && typeof (a as PostAction).actionType === "string"
  );
}

/** Whether a node's side effects write variables worth persisting. */
export function hasStatefulPostAction(data: unknown): boolean {
  return readPostActions(data).some((a) =>
    STATEFUL_POST_ACTIONS.has(a.actionType)
  );
}
