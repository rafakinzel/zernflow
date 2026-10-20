/**
 * Meta's standard messaging window.
 *
 * A business can send a free-form message for 24 hours after the person's
 * last action. After that the send is refused, which in a flow looks like a
 * message that simply never arrived.
 *
 * This is the rule behind the most expensive silent failure in a rescue
 * sequence: a Smart Delay set to wait 24 hours fires its timeout branch
 * exactly on the boundary, so the message written to win the person back is
 * the one most likely to be refused.
 *
 * The guard here is deliberately one-sided. It blocks a send only when there
 * is positive evidence the window has closed, and lets everything else
 * through. Our own record of inbound messages can be incomplete, and a guard
 * that refuses on missing data would invent a failure the platform never had.
 */

export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sending at 23 hours 59 is a race against a clock we do not own: the
 * platform measures from its own record of the inbound, not ours, and a
 * queued job can sit for minutes before it runs.
 */
export const WINDOW_SAFETY_MS = 10 * 60 * 1000;

export interface WindowState {
  /** False only when we can prove the window has closed. */
  open: boolean;
  /** Milliseconds left before the window closes; null when unknown. */
  remainingMs: number | null;
  reason: "no_record" | "open" | "closing" | "closed";
}

/**
 * Whether a free-form message may still be sent.
 *
 * `lastInboundAt` is when the person last wrote or tapped something. Null
 * means we have no record of it, which is not the same as "they never did".
 */
export function messagingWindow(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date()
): WindowState {
  if (!lastInboundAt) {
    return { open: true, remainingMs: null, reason: "no_record" };
  }

  const last =
    lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(last.getTime())) {
    return { open: true, remainingMs: null, reason: "no_record" };
  }

  const elapsed = now.getTime() - last.getTime();
  const remainingMs = MESSAGING_WINDOW_MS - elapsed;

  // A clock skew that puts the inbound in the future is not a closed window.
  if (remainingMs <= 0) {
    return { open: false, remainingMs, reason: "closed" };
  }
  if (remainingMs <= WINDOW_SAFETY_MS) {
    return { open: false, remainingMs, reason: "closing" };
  }
  return { open: true, remainingMs, reason: "open" };
}

/** Hours, rounded, for a log line a person has to read. */
export function hoursSince(
  lastInboundAt: string | Date,
  now: Date = new Date()
): number {
  const last =
    lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  return Math.round((now.getTime() - last.getTime()) / (60 * 60 * 1000));
}
