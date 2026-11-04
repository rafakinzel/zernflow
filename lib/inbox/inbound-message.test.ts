import { describe, it, expect } from "vitest";
import { inboundMessageRow } from "./inbound-message";

const now = new Date("2026-11-04T00:30:00.000Z");

describe("inboundMessageRow", () => {
  it("keeps what the person wrote, and when they wrote it", () => {
    const row = inboundMessageRow({
      conversationId: "conv-1",
      message: {
        text: "#FA",
        platformMessageId: "ig-123",
        sentAt: "2026-11-03T04:42:00.000Z",
      },
      now,
    });

    expect(row).toMatchObject({
      conversation_id: "conv-1",
      direction: "inbound",
      text: "#FA",
      platform_message_id: "ig-123",
      status: "delivered",
      created_at: "2026-11-03T04:42:00.000Z",
    });
  });

  it("records a button tap by its payload, with no text", () => {
    // The title belongs to the button, not to the person: they tapped.
    const row = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: null, platformMessageId: "ig-9" },
      metadata: { postbackPayload: "QUERO_O_CURSO", postbackTitle: "Quero o curso" },
      now,
    });

    expect(row.text).toBeNull();
    expect(row.postback_payload).toBe("QUERO_O_CURSO");
    expect(row.quick_reply_payload).toBeNull();
  });

  it("keeps a quick reply payload apart from a postback", () => {
    const row = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: null },
      metadata: { quickReplyPayload: "SIM", callbackData: "cb-1" },
      now,
    });

    expect(row.quick_reply_payload).toBe("SIM");
    expect(row.callback_data).toBe("cb-1");
    expect(row.postback_payload).toBeNull();
  });

  it("treats whitespace as no text rather than storing a blank", () => {
    const row = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: "   " },
      now,
    });
    expect(row.text).toBeNull();
  });

  it("falls back to now when the timestamp is missing or unusable", () => {
    // A wrong date would scramble the order of the thread, which is worse
    // than an approximate one.
    for (const sentAt of [null, undefined, "", "not a date"]) {
      const row = inboundMessageRow({
        conversationId: "conv-1",
        message: { text: "oi", sentAt },
        now,
      });
      expect(row.created_at).toBe(now.toISOString());
    }
  });

  it("stores attachments only when there are some", () => {
    const withFiles = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: null, attachments: [{ type: "image", url: "u" }] },
      now,
    });
    expect(withFiles.attachments).toEqual([{ type: "image", url: "u" }]);

    const withoutFiles = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: "oi", attachments: [] },
      now,
    });
    expect(withoutFiles.attachments).toBeNull();
  });

  it("leaves the platform id null when the provider sends none", () => {
    // The unique index that makes a redelivered webhook harmless is partial,
    // so a row with no id must not carry an empty string instead.
    const row = inboundMessageRow({
      conversationId: "conv-1",
      message: { text: "oi", platformMessageId: "" },
      now,
    });
    expect(row.platform_message_id).toBeNull();
  });
});
