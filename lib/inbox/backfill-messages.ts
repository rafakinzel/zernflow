/**
 * Which messages of a thread are worth bringing back from Zernio.
 *
 * The webhook now files every inbound message as it arrives, but it only
 * started doing that on 4 Nov 2026. Everything people wrote before then lives
 * only in Zernio, and the inbox reads it live, so none of it is countable
 * here. This decides what to copy across.
 *
 * Both directions, because the question this is for is who spoke last. A
 * reply Thiago typed into the Instagram app himself never passes through the
 * flow engine, so leaving outbound behind would show every hand-answered
 * lead as still waiting: the exact mistake this is meant to end.
 *
 * Each direction stops at the first row the conversation already holds in
 * that direction, which marks where our own recording took over. Without
 * that boundary the run would lean entirely on the unique index, and Zernio
 * does not always give a platform id to lean on.
 *
 * The engine's own sends carry no platform id, so the rows imported for the
 * period it was already covering are duplicates of them. They are reconciled
 * once, in SQL, rather than guessed at here.
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

export type BackfillRow = Omit<InboundMessageRow, "direction"> & {
  direction: "inbound" | "outbound";
};

export interface BackfillPlan {
  rows: BackfillRow[];
  /** Seen but left alone, and why, so a run can be read rather than trusted. */
  skipped: {
    alreadyCovered: number;
    noKey: number;
    noDate: number;
  };
}

function boundaryOf(at: string | null): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Builds the rows to insert for one conversation.
 *
 * The two `earliestStored*At` values are the created_at of the oldest row the
 * conversation already holds in each direction, or null when it holds none.
 */
export function planBackfill(params: {
  conversationId: string;
  messages: ProviderThreadMessage[];
  earliestStoredInboundAt: string | null;
  earliestStoredOutboundAt?: string | null;
}): BackfillPlan {
  const { conversationId, messages, earliestStoredInboundAt } = params;

  const boundary = {
    inbound: boundaryOf(earliestStoredInboundAt),
    outbound: boundaryOf(params.earliestStoredOutboundAt ?? null),
  };

  const rows: BackfillRow[] = [];
  const skipped = { alreadyCovered: 0, noKey: 0, noDate: 0 };

  for (const m of messages) {
    // No date means no way to place it against the boundary, and a message
    // stamped "now" would sort as if it had just arrived.
    const at = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
    if (Number.isNaN(at)) {
      skipped.noDate++;
      continue;
    }

    const edge = boundary[m.direction];
    if (edge !== null && at >= edge) {
      skipped.alreadyCovered++;
      continue;
    }

    // A row with no key is not protected by the unique index against a
    // second run, so it is better left out than filed twice.
    const key = m.platformMessageId || m.id;
    if (!key) {
      skipped.noKey++;
      continue;
    }

    rows.push({
      ...inboundMessageRow({
        conversationId,
        message: {
          text: m.text,
          platformMessageId: key,
          attachments: asAttachments(m.attachments),
          sentAt: m.createdAt,
        },
      }),
      direction: m.direction,
    });
  }

  return { rows, skipped };
}
