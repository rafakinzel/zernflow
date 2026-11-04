import { describe, it, expect } from "vitest";
import { planBackfill, type ProviderThreadMessage } from "./backfill-messages";

function msg(over: Partial<ProviderThreadMessage> = {}): ProviderThreadMessage {
  return {
    id: "z-1",
    direction: "inbound",
    text: "oi",
    attachments: null,
    platformMessageId: "ig-1",
    createdAt: "2026-10-25T02:00:00.000Z",
    ...over,
  };
}

describe("planBackfill", () => {
  it("brings back what the person wrote", () => {
    const { rows } = planBackfill({
      conversationId: "c1",
      messages: [msg({ text: "#FA" })],
      earliestStoredInboundAt: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversation_id: "c1",
      direction: "inbound",
      text: "#FA",
      platform_message_id: "ig-1",
      created_at: "2026-10-25T02:00:00.000Z",
    });
  });

  it("leaves our own sends alone", () => {
    // They are already stored by the flow engine, and carry no platform id,
    // so nothing would stop a second copy landing beside each one.
    const { rows, skipped } = planBackfill({
      conversationId: "c1",
      messages: [msg({ direction: "outbound" }), msg()],
      earliestStoredInboundAt: null,
    });

    expect(rows).toHaveLength(1);
    expect(skipped.outbound).toBe(1);
  });

  it("stops at the point the webhook took over", () => {
    const older = msg({ id: "z-old", createdAt: "2026-10-25T02:00:00.000Z" });
    const atBoundary = msg({ id: "z-b", createdAt: "2026-11-04T00:00:00.000Z" });
    const newer = msg({ id: "z-new", createdAt: "2026-11-04T06:00:00.000Z" });

    const { rows, skipped } = planBackfill({
      conversationId: "c1",
      messages: [older, atBoundary, newer],
      earliestStoredInboundAt: "2026-11-04T00:00:00.000Z",
    });

    expect(rows.map((r) => r.platform_message_id)).toEqual(["ig-1"]);
    expect(rows).toHaveLength(1);
    expect(skipped.alreadyCovered).toBe(2);
  });

  it("takes the whole thread when nothing was stored yet", () => {
    const { rows } = planBackfill({
      conversationId: "c1",
      messages: [
        msg({ id: "a", platformMessageId: "ig-a" }),
        msg({ id: "b", platformMessageId: "ig-b" }),
      ],
      earliestStoredInboundAt: null,
    });
    expect(rows).toHaveLength(2);
  });

  it("falls back to the provider id when there is no platform id", () => {
    const { rows } = planBackfill({
      conversationId: "c1",
      messages: [msg({ platformMessageId: null, id: "z-42" })],
      earliestStoredInboundAt: null,
    });
    expect(rows[0].platform_message_id).toBe("z-42");
  });

  it("skips a message with no key at all rather than risk a duplicate", () => {
    // The unique index is partial, so an unkeyed row is unprotected against
    // a second run of the backfill.
    const { rows, skipped } = planBackfill({
      conversationId: "c1",
      messages: [msg({ platformMessageId: null, id: null })],
      earliestStoredInboundAt: null,
    });
    expect(rows).toHaveLength(0);
    expect(skipped.noKey).toBe(1);
  });

  it("skips a message with no usable date", () => {
    const { rows, skipped } = planBackfill({
      conversationId: "c1",
      messages: [msg({ createdAt: null }), msg({ createdAt: "nonsense" })],
      earliestStoredInboundAt: null,
    });
    expect(rows).toHaveLength(0);
    expect(skipped.noDate).toBe(2);
  });

  it("keeps real attachments and drops entries of another shape", () => {
    // The column is jsonb and would accept anything, so what Zernio sends is
    // checked rather than trusted.
    const { rows } = planBackfill({
      conversationId: "c1",
      messages: [
        msg({
          attachments: [
            { type: "image", url: "https://x/1.jpg" },
            { type: "image" },
            "nope",
            null,
            { type: "video", url: "https://x/2.mp4", payload: "p" },
          ],
        }),
      ],
      earliestStoredInboundAt: null,
    });

    expect(rows[0].attachments).toEqual([
      { type: "image", url: "https://x/1.jpg" },
      { type: "video", url: "https://x/2.mp4", payload: "p" },
    ]);
  });

  it("stores no attachments when none of them hold up", () => {
    const { rows } = planBackfill({
      conversationId: "c1",
      messages: [msg({ attachments: [{ broken: true }] })],
      earliestStoredInboundAt: null,
    });
    expect(rows[0].attachments).toBeNull();
  });

  it("has nothing to do with an empty thread", () => {
    const { rows, skipped } = planBackfill({
      conversationId: "c1",
      messages: [],
      earliestStoredInboundAt: null,
    });
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ outbound: 0, alreadyCovered: 0, noKey: 0, noDate: 0 });
  });
});
