import { describe, expect, it, vi } from "vitest";
import type Zernio from "@zernio/node";
import { ZernioProvider } from "./zernio-provider";

/** Builds a Zernio double exposing only the methods a given test exercises. */
function fakeClient(overrides: Record<string, unknown>) {
  return overrides as unknown as Zernio;
}

describe("ZernioProvider.sendMessage", () => {
  it("maps media, buttons and quick replies into the vendor body", async () => {
    const send = vi.fn().mockResolvedValue({ data: { data: { messageId: "m-1" } } });
    const provider = new ZernioProvider(
      fakeClient({ messages: { sendInboxMessage: send } })
    );

    const res = await provider.sendMessage({
      accountId: "acc-1",
      conversationId: "conv-1",
      message: {
        text: "oi",
        attachmentUrl: "https://cdn/x.mp4",
        attachmentType: "video",
        buttons: [{ title: "Sim" }],
        quickReplies: [{ title: "Não" }],
      },
    });

    expect(send).toHaveBeenCalledWith({
      path: { conversationId: "conv-1" },
      body: {
        accountId: "acc-1",
        message: "oi",
        attachmentUrl: "https://cdn/x.mp4",
        attachmentType: "video",
        buttons: [{ title: "Sim" }],
        quickReplies: [{ title: "Não" }],
      },
    });
    expect(res.messageId).toBe("m-1");
  });

  it("defaults attachmentType to image and omits empty option lists", async () => {
    const send = vi.fn().mockResolvedValue({ data: {} });
    const provider = new ZernioProvider(
      fakeClient({ messages: { sendInboxMessage: send } })
    );

    await provider.sendMessage({
      accountId: "acc-1",
      conversationId: "conv-1",
      message: { text: "oi", attachmentUrl: "https://cdn/x.png", buttons: [] },
    });

    expect(send.mock.calls[0][0].body).toEqual({
      accountId: "acc-1",
      message: "oi",
      attachmentUrl: "https://cdn/x.png",
      attachmentType: "image",
    });
  });

  it("reports a null id when the vendor returns none", async () => {
    const send = vi.fn().mockResolvedValue({ data: { data: {} } });
    const provider = new ZernioProvider(
      fakeClient({ messages: { sendInboxMessage: send } })
    );

    const res = await provider.sendMessage({
      accountId: "acc-1",
      conversationId: "conv-1",
      message: { text: "oi" },
    });

    expect(res.messageId).toBeNull();
  });
});

describe("ZernioProvider comment replies", () => {
  it("sends a private reply keyed by post and comment", async () => {
    const privateReply = vi.fn().mockResolvedValue({});
    const provider = new ZernioProvider(
      fakeClient({ comments: { sendPrivateReplyToComment: privateReply } })
    );

    await provider.sendPrivateReply({
      accountId: "acc-1",
      postId: "p-1",
      commentId: "c-1",
      text: "oi",
    });

    expect(privateReply).toHaveBeenCalledWith({
      path: { postId: "p-1", commentId: "c-1" },
      body: { accountId: "acc-1", message: "oi" },
    });
  });

  it("posts a public reply with the comment id in the body, not the path", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const provider = new ZernioProvider(
      fakeClient({ comments: { replyToInboxPost: reply } })
    );

    await provider.replyToComment({
      accountId: "acc-1",
      postId: "p-1",
      commentId: "c-1",
      text: "respondi",
    });

    expect(reply).toHaveBeenCalledWith({
      path: { postId: "p-1" },
      body: { accountId: "acc-1", message: "respondi", commentId: "c-1" },
    });
  });
});

describe("ZernioProvider.listPosts", () => {
  it("drops ad rows and rows without an id", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: "p-1", content: "post", picture: "pic", commentCount: 3 },
          { id: "123:feed", isAd: true },
          { content: "sem id" },
        ],
        pagination: { nextCursor: "cur-2" },
      },
    });
    const provider = new ZernioProvider(
      fakeClient({ comments: { listInboxComments: list } })
    );

    const res = await provider.listPosts({ accountId: "acc-1", limit: 24 });

    expect(res.posts).toEqual([
      {
        id: "p-1",
        caption: "post",
        thumbnail: "pic",
        permalink: null,
        createdAt: null,
        commentCount: 3,
      },
    ]);
    expect(res.nextCursor).toBe("cur-2");
  });
});

describe("ZernioProvider.listConversations", () => {
  it("stops paging when hasMore is false, even with a cursor present", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        data: [{ id: "c-1", participantId: "s-1" }],
        pagination: { hasMore: false, nextCursor: "cur-2" },
      },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { listInboxConversations: list } })
    );

    const res = await provider.listConversations({ accountId: "acc-1", limit: 50 });

    expect(res.conversations).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it("hands back the cursor while hasMore is true", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { data: [], pagination: { hasMore: true, nextCursor: "cur-2" } },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { listInboxConversations: list } })
    );

    const res = await provider.listConversations({ accountId: "acc-1", limit: 50 });

    expect(res.nextCursor).toBe("cur-2");
  });
});

describe("ZernioProvider.getConversationMessages", () => {
  it("reads the `messages` key this endpoint uses instead of `data`", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        messages: [
          { id: "m-1", direction: "outbound", text: "oi", sentAt: "2026-01-01" },
          { id: "m-2", direction: "whatever", message: "ola", attachments: [] },
        ],
      },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { getInboxConversationMessages: get } })
    );

    const res = await provider.getConversationMessages({
      accountId: "acc-1",
      conversationId: "conv-1",
    });

    expect(res).toEqual([
      {
        id: "m-1",
        direction: "outbound",
        text: "oi",
        attachments: null,
        platformMessageId: null,
        createdAt: "2026-01-01",
      },
      {
        id: "m-2",
        direction: "inbound",
        text: "ola",
        attachments: null,
        platformMessageId: null,
        createdAt: null,
      },
    ]);
  });

  it("reads Zernio's own words for direction, which are incoming and outgoing", async () => {
    // The old comparison was against "outbound", a value this endpoint never
    // sends, so every message came back as if the contact had written it.
    const get = vi.fn().mockResolvedValue({
      data: {
        messages: [
          { id: "m-1", direction: "incoming", message: "quero saber mais" },
          { id: "m-2", direction: "outgoing", message: "Posso te mostrar como funciona?" },
        ],
      },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { getInboxConversationMessages: get } })
    );

    const res = await provider.getConversationMessages({
      accountId: "acc-1",
      conversationId: "conv-1",
    });

    expect(res.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });

  it("takes the text from `message`, which is the field this endpoint fills", async () => {
    const get = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "m-1", direction: "incoming", message: "oi" }] },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { getInboxConversationMessages: get } })
    );

    const res = await provider.getConversationMessages({
      accountId: "acc-1",
      conversationId: "conv-1",
    });

    expect(res[0].text).toBe("oi");
  });

  it("walks every page of a long thread", async () => {
    // Reading only the first page silently truncated every thread past 100
    // messages, which is invisible until something starts counting them.
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messages: [{ id: "m-1", direction: "incoming", message: "um" }],
          pagination: { hasMore: true, nextCursor: "cur-2" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          messages: [{ id: "m-2", direction: "outgoing", message: "dois" }],
          pagination: { hasMore: false, nextCursor: null },
        },
      });

    const provider = new ZernioProvider(
      fakeClient({ messages: { getInboxConversationMessages: get } })
    );

    const res = await provider.getConversationMessages({
      accountId: "acc-1",
      conversationId: "conv-1",
    });

    expect(res.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0].query.cursor).toBe("cur-2");
  });

  it("stops when a cursor comes back without hasMore", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        messages: [{ id: "m-1", direction: "incoming", message: "um" }],
        pagination: { hasMore: false, nextCursor: "cur-2" },
      },
    });
    const provider = new ZernioProvider(
      fakeClient({ messages: { getInboxConversationMessages: get } })
    );

    await provider.getConversationMessages({
      accountId: "acc-1",
      conversationId: "conv-1",
    });

    expect(get).toHaveBeenCalledTimes(1);
  });
});
