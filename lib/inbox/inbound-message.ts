/**
 * The row to store when a contact sends us something.
 *
 * The inbox reads threads live from Zernio, so for a long time nothing of what
 * people wrote was kept here and only our own sends were. That was invisible
 * until somebody asked a question the database could not answer: whether a
 * lead is waiting on us or simply stopped replying. Both look identical when
 * half of every conversation is missing, and a lead who had already been
 * answered was reported as waiting.
 *
 * Zernio stays the source of truth for reading one thread. This row is the
 * local record that lets us count, classify and audit across all of them
 * without walking somebody else's API conversation by conversation.
 */

/**
 * An attachment exactly as the webhook sends it, which is already JSON.
 *
 * A type alias rather than an interface on purpose: only an alias is
 * assignable to the `Json` column type, because an interface carries no
 * implicit index signature.
 */
export type InboundAttachment = {
  type: string;
  url: string;
  payload?: string;
};

export interface InboundWebhookMessage {
  text: string | null;
  platformMessageId?: string | null;
  attachments?: InboundAttachment[] | null;
  sentAt?: string | null;
}

export interface InboundWebhookMetadata {
  quickReplyPayload?: string;
  callbackData?: string;
  postbackPayload?: string;
  postbackTitle?: string;
}

export interface InboundMessageRow {
  conversation_id: string;
  direction: "inbound";
  text: string | null;
  attachments: InboundAttachment[] | null;
  quick_reply_payload: string | null;
  postback_payload: string | null;
  callback_data: string | null;
  platform_message_id: string | null;
  /** Inbound has no send to succeed or fail: it arrived. */
  status: "delivered";
  created_at: string;
}

/** A timestamp Postgres will accept, or null to let the row default to now(). */
function sentAtOrNow(sentAt: string | null | undefined, now: Date): string {
  if (!sentAt) return now.toISOString();
  const parsed = new Date(sentAt);
  // Zernio has sent us unparseable timestamps before. A wrong date is worse
  // than an approximate one: ordering a thread by it would scramble it.
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  return parsed.toISOString();
}

/**
 * Builds the row for an inbound webhook message.
 *
 * A tap on a button carries no text, only a payload, so the text column is
 * left null rather than filled with the button's title: what the person did
 * was tap, and the payload is the record of which button.
 */
export function inboundMessageRow(params: {
  conversationId: string;
  message: InboundWebhookMessage;
  metadata?: InboundWebhookMetadata;
  now?: Date;
}): InboundMessageRow {
  const { conversationId, message, metadata } = params;
  const now = params.now ?? new Date();

  const text = message.text?.trim() ? message.text : null;
  const attachments =
    Array.isArray(message.attachments) && message.attachments.length > 0
      ? message.attachments
      : null;

  return {
    conversation_id: conversationId,
    direction: "inbound",
    text,
    attachments,
    quick_reply_payload: metadata?.quickReplyPayload ?? null,
    postback_payload: metadata?.postbackPayload ?? null,
    callback_data: metadata?.callbackData ?? null,
    platform_message_id: message.platformMessageId || null,
    status: "delivered",
    created_at: sentAtOrNow(message.sentAt, now),
  };
}
