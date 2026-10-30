/**
 * Messaging provider interface.
 *
 * Everything that sends or reads a message, a comment reply or a post goes
 * through this interface instead of calling a vendor SDK directly, so the
 * transport behind the flow engine can be swapped (Zernio today, the Meta
 * Graph API next) without touching the engine, the inbox or the cron jobs.
 *
 * Deliberately NOT in here: connecting an account, listing connected accounts,
 * disconnecting one, and registering a webhook. Those are shaped by how a
 * vendor models accounts and have no common denominator worth inventing
 * (Zernio derives accounts from one API key; Meta derives one account from an
 * OAuth grant), so each provider keeps its own routes for them.
 */

/** Outbound message as the flow engine describes it, before vendor mapping. */
export interface OutboundMessage {
  text: string;
  /** Media to deliver alongside the text. */
  attachmentUrl?: string;
  /** "image" | "video" | "audio"; defaults to "image" when a URL is present. */
  attachmentType?: string;
  buttons?: unknown[];
  quickReplies?: unknown[];
  template?: unknown;
  replyMarkup?: unknown;
  /**
   * Send as a human agent's reply, which Meta allows for seven days from the
   * person's last message instead of the usual twenty-four hours.
   *
   * Only ever true for a message a person typed in the inbox: the tag says
   * a human is answering, and using it for anything automated is a policy
   * breach. Instagram accepts no other tag.
   */
  humanAgent?: boolean;
}

export interface SendMessageResult {
  /** Vendor id of the sent message, when the vendor returns one. */
  messageId: string | null;
}

/** A published post, as the comment-trigger post picker needs it. */
export interface ProviderPost {
  id: string;
  caption: string;
  thumbnail: string | null;
  permalink: string | null;
  createdAt: string | null;
  commentCount: number;
}

/** A DM thread, as the inbox backfill needs it. */
export interface ProviderConversation {
  id?: string;
  participantId?: string;
  participantName?: string;
  participantUsername?: string | null;
  participantPicture?: string | null;
  /**
   * Instagram's own facts about the participant. Only Instagram conversations
   * carry it, and the provider leaves it out when the platform sent nothing.
   */
  instagramProfile?: {
    isFollower?: boolean | null;
    isFollowing?: boolean | null;
    followerCount?: number | null;
    isVerified?: boolean | null;
    fetchedAt?: string | null;
  } | null;
  lastMessage?: string;
  updatedTime?: string;
  status?: "active" | "archived";
  unreadCount?: number | null;
}

/** A single message inside a thread, as the inbox UI needs it. */
export interface ProviderMessage {
  id: string | null;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: unknown[] | null;
  platformMessageId: string | null;
  createdAt: string | null;
}

export interface MessagingProvider {
  /** Which transport this is, for logging and for provider-specific branches. */
  readonly name: "zernio" | "meta";

  /** Sends a DM inside an existing conversation. */
  sendMessage(params: {
    accountId: string;
    conversationId: string;
    message: OutboundMessage;
  }): Promise<SendMessageResult>;

  /**
   * Sends a DM to a commenter from the comment context, which is the only way
   * to open a thread off a comment. Instagram allows exactly one of these per
   * comment, within 7 days of it.
   */
  sendPrivateReply(params: {
    accountId: string;
    postId: string;
    commentId: string;
    text: string;
  }): Promise<void>;

  /** Posts a public reply under a comment. */
  replyToComment(params: {
    accountId: string;
    postId: string;
    commentId: string;
    text: string;
  }): Promise<void>;

  /** Lists published posts, newest first. */
  listPosts(params: {
    accountId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ posts: ProviderPost[]; nextCursor: string | null }>;

  /** Lists DM threads, newest first. */
  listConversations(params: {
    accountId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ conversations: ProviderConversation[]; nextCursor: string | null }>;

  /** Reads the messages of one DM thread. */
  getConversationMessages(params: {
    accountId: string;
    conversationId: string;
  }): Promise<ProviderMessage[]>;
}
