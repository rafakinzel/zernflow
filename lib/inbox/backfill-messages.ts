/**
 * Which messages of a thread are worth bringing back from Zernio.
 *
 * The webhook now files every inbound message as it arrives, but it only
 * started doing that on 4 Nov 2026. Everything people wrote before then lives
 * only in Zernio, and the inbox reads it live, so none of it is countable
 * here. This decides what to copy across.
 *
 * Two rules, both there to avoid filing the same message twice:
 *
 * Inbound only. Our own sends are already stored by the flow engine, and
 * those rows carry no platform id, so nothing would stop a second copy from
 * landing beside each one.
 *
 * Older than the first inbound row the conversation already has. That row
 * marks the moment the webhook took over for this thread; anything after it
 * is already accounted for. Without the boundary we would lean entirely on
 * the unique index, and Zernio does not always give a platform id to lean on.
 */

import {
  inboundMessageRow,
  type InboundAttachment,
  type InboundMessageRow,
} from "./inbound-message";

export interface ProviderThreadMessage {
  id: string | null;
  direction: "inbound" | "outbound";
  text: string | null;
  /** Whatever Zernio put here; the shape is theirs, so it is checked. */
  attachments: unknown[] | null;
  platformMessageId: string | null;
  createdAt: string | null;
}

/**
 * Keeps the entries that really are attachments.
 *
 * The column is jsonb and would swallow anything, which is the reason to
 * check: an entry of some other shape would sit in the record looking like
 * an attachment until something downstream tried to render it.
 */
function asAttachments(value: unknown[] | null | undefined): InboundAttachment[] | null {
  if (!Array.isArray(value)) return null;

  const kept = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { type, url, payload } = entry as Record<string, unknown>;
    if (typeof type !== "string" || typeof url !== "string") return [];
    return [
      typeof payload === "string" ? { type, url, payload } : { type, url },
    ];
  });

  return kept.length > 0 ? kept : null;
}

export interface BackfillPlan {
  rows: InboundMessageRow[];
  /** Seen but left alone, and why, so a run can be read rather than trusted. */
  skipped: {
    outbound: number;
    alreadyCovered: number;
    noKey: number;
    noDate: number;
  };
}

/**
 * Builds the rows to insert for one conversation.
 *
 * `earliestStoredInboundAt` is the created_at of the oldest inbound row this
 * conversation already holds, or null when it holds none.
 */
export function planBackfill(params: {
  conversationId: string;
  messages: ProviderThreadMessage[];
  earliestStoredInboundAt: string | null;
}): BackfillPlan {
  const { conversationId, messages, earliestStoredInboundAt } = params;

  const boundary = earliestStoredInboundAt
    ? new Date(earliestStoredInboundAt).getTime()
    : null;

  const rows: InboundMessageRow[] = [];
  const skipped = { outbound: 0, alreadyCovered: 0, noKey: 0, noDate: 0 };

  for (const m of messages) {
    if (m.direction !== "inbound") {
      skipped.outbound++;
      continue;
    }

    // No date means no way to place it against the boundary, and a message
    // stamped "now" would sort as if it had just arrived.
    const at = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
    if (Number.isNaN(at)) {
      skipped.noDate++;
      continue;
    }

    if (boundary !== null && at >= boundary) {
      skipped.alreadyCovered++;
      continue;
    }

    // The unique index is partial: a row with no key is not protected from a
    // second run, so it is better left out than filed twice.
    const key = m.platformMessageId || m.id;
    if (!key) {
      skipped.noKey++;
      continue;
    }

    rows.push(
      inboundMessageRow({
        conversationId,
        message: {
          text: m.text,
          platformMessageId: key,
          attachments: asAttachments(m.attachments),
          sentAt: m.createdAt,
        },
      })
    );
  }

  return { rows, skipped };
}
