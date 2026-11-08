/**
 * Zernio implementation of MessagingProvider.
 *
 * A thin mapping onto `@zernio/node`. The vendor quirks it absorbs, each of
 * which was found the hard way and is preserved here exactly:
 *  - sendInboxMessage nests its id at `data.data.messageId`;
 *  - getInboxConversationMessages answers `{ messages }`, not `{ data }`;
 *  - listInboxComments answers POSTS, not comments;
 *  - pagination only continues while `hasMore` is true.
 */

import type Zernio from "@zernio/node";
import { createZernioClient } from "@/lib/zernio-client";
import type {
  MessagingProvider,
  PrivateReplyButton,
  OutboundMessage,
  ProviderConversation,
  ProviderMessage,
  ProviderPost,
  SendMessageResult,
} from "./provider";

type SendBody = Parameters<Zernio["messages"]["sendInboxMessage"]>[0]["body"];

/** Builds the vendor send body from the engine's message description. */
function toSendBody(accountId: string, message: OutboundMessage): SendBody {
  const body: Record<string, unknown> = {
    accountId,
    message: message.text,
  };
  if (message.attachmentUrl) {
    body.attachmentUrl = message.attachmentUrl;
    body.attachmentType = message.attachmentType || "image";
  }
  if (message.buttons?.length) body.buttons = message.buttons;
  if (message.quickReplies?.length) body.quickReplies = message.quickReplies;
  if (message.template) body.template = message.template;
  if (message.replyMarkup) body.replyMarkup = message.replyMarkup;
  if (message.humanAgent) {
    // The pair is required together: the tag is only read when the type
    // says a tag is being used.
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }
  return body as SendBody;
}

export class ZernioProvider implements MessagingProvider {
  readonly name = "zernio" as const;

  constructor(private readonly client: Zernio) {}

  async sendMessage({
    accountId,
    conversationId,
    message,
  }: {
    accountId: string;
    conversationId: string;
    message: OutboundMessage;
  }): Promise<SendMessageResult> {
    const res = await this.client.messages.sendInboxMessage({
      path: { conversationId },
      body: toSendBody(accountId, message),
    });
    // `|| null` rather than `??`: an empty id is as absent as a missing one,
    // and the messages table stores null for "the vendor gave us nothing".
    const messageId =
      (res.data as { data?: { messageId?: string } } | undefined)?.data
        ?.messageId || null;
    return { messageId };
  }

  async sendPrivateReply({
    accountId,
    postId,
    commentId,
    text,
    buttons,
    quickReplies,
  }: {
    accountId: string;
    postId: string;
    commentId: string;
    text: string;
    buttons?: PrivateReplyButton[];
    quickReplies?: Array<{ title: string; payload: string }>;
  }): Promise<void> {
    // Zernio takes one or the other, never both.
    await this.client.comments.sendPrivateReplyToComment({
      path: { postId, commentId },
      body: {
        accountId,
        message: text,
        ...(buttons?.length
          ? { buttons }
          : quickReplies?.length
            ? { quickReplies }
            : {}),
      },
    });
  }

  async replyToComment({
    accountId,
    postId,
    commentId,
    text,
  }: {
    accountId: string;
    postId: string;
    commentId: string;
    text: string;
  }): Promise<void> {
    await this.client.comments.replyToInboxPost({
      path: { postId },
      body: { accountId, message: text, commentId },
    });
  }

  async listPosts({
    accountId,
    limit,
    cursor,
  }: {
    accountId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ posts: ProviderPost[]; nextCursor: string | null }> {
    const res = await this.client.comments.listInboxComments({
      query: {
        accountId,
        limit,
        sortBy: "date",
        sortOrder: "desc",
        ...(cursor ? { cursor } : {}),
      },
    });

    type PostRow = {
      id?: string;
      content?: string;
      picture?: string | null;
      permalink?: string | null;
      createdTime?: string;
      commentCount?: number;
      isAd?: boolean;
    };
    const rows: PostRow[] = res.data?.data ?? [];
    // Ad rows are boosted/dark posts whose id is "{adId}:{placement}", not a
    // post id the comment matcher can ever compare against, so leave them out.
    const posts = rows
      .filter((row) => row?.id && !row.isAd)
      .map((row) => ({
        id: row.id as string,
        caption: row.content ?? "",
        thumbnail: row.picture ?? null,
        permalink: row.permalink ?? null,
        createdAt: row.createdTime ?? null,
        commentCount: row.commentCount ?? 0,
      }));

    return { posts, nextCursor: res.data?.pagination?.nextCursor ?? null };
  }

  async listConversations({
    accountId,
    limit,
    cursor,
  }: {
    accountId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    conversations: ProviderConversation[];
    nextCursor: string | null;
  }> {
    const res = await this.client.messages.listInboxConversations({
      query: { accountId, limit, sortOrder: "desc", cursor },
    });

    const conversations = (res.data?.data ?? []) as ProviderConversation[];
    const pagination = res.data?.pagination;
    // Zernio can hand back a cursor on the last page; `hasMore` is the
    // authoritative stop signal, so a cursor without it means "done".
    const nextCursor =
      pagination?.hasMore && pagination.nextCursor ? pagination.nextCursor : null;

    return { conversations, nextCursor };
  }

  /**
   * Zernio says `outgoing`, not `outbound`.
   *
   * The old comparison was against "outbound", which this endpoint never
   * sends, so every message in every thread came back marked as if the
   * contact had written it: the inbox showed our own replies as theirs, and
   * a backfill built on it filed 3,604 of our messages as incoming.
   */
  private static directionOf(raw: unknown): "inbound" | "outbound" {
    return raw === "outgoing" || raw === "outbound" ? "outbound" : "inbound";
  }

  async getConversationMessages({
    accountId,
    conversationId,
  }: {
    accountId: string;
    conversationId: string;
  }): Promise<ProviderMessage[]> {
    const all: ProviderMessage[] = [];
    let cursor: string | undefined;

    // Paginated, 100 a page. Reading only the first page was invisible while
    // the inbox showed one recent thread at a time, and silently truncated
    // every thread longer than that once anything started counting them.
    // Bounded so a provider that keeps handing back a cursor cannot spin.
    for (let page = 0; page < 50; page++) {
      const res = await this.client.messages.getInboxConversationMessages({
        path: { conversationId },
        query: { accountId, limit: 100, ...(cursor ? { cursor } : {}) },
      });

      // This endpoint answers `{ success, messages }`, unlike every other one.
      const data = res.data as {
        messages?: unknown[];
        data?: unknown[];
        pagination?: { hasMore?: boolean; nextCursor?: string | null };
      } | null;

      const rows = (data?.messages ?? data?.data ?? []) as Array<Record<string, any>>;

      for (const m of rows) {
        all.push({
          id: m.id ?? null,
          direction: ZernioProvider.directionOf(m.direction),
          text: m.message ?? m.text ?? null,
          attachments: m.attachments?.length ? m.attachments : null,
          platformMessageId: m.platformMessageId ?? null,
          createdAt: m.createdAt ?? m.sentAt ?? null,
        });
      }

      // hasMore is the stop signal; a cursor without it means done.
      const more = data?.pagination?.hasMore && data.pagination.nextCursor;
      if (!more) break;
      cursor = data.pagination!.nextCursor!;
    }

    return all;
  }
}

/** Builds a Zernio-backed provider from a workspace API key. */
export function createZernioProvider(apiKey: string): ZernioProvider {
  return new ZernioProvider(createZernioClient(apiKey));
}
