import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  matchCommentTrigger,
  processComment,
  type CommentForMatching,
} from "./comment-processor";
import type { Database } from "@/lib/types/database";

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

function trigger(id: string, config: Record<string, unknown>): Trigger {
  return {
    id,
    flow_id: `flow-${id}`,
    channel_id: null,
    type: "comment_keyword",
    config,
    priority: 50,
    is_active: true,
    created_at: new Date().toISOString(),
  } as unknown as Trigger;
}

const comment = (text: string, postId = "post-1"): CommentForMatching => ({
  text,
  postId,
});

describe("matchCommentTrigger", () => {
  it("matches a contains keyword case-insensitively (default matchType)", () => {
    const t = trigger("t1", { keywords: [{ value: "Socrates" }] });
    expect(matchCommentTrigger([t], comment("love SOCRATES so much"))?.id).toBe("t1");
  });

  it("matches exact only on full trimmed text", () => {
    const t = trigger("t1", { keywords: [{ value: "price", matchType: "exact" }] });
    expect(matchCommentTrigger([t], comment("  PRICE "))?.id).toBe("t1");
    expect(matchCommentTrigger([t], comment("price please"))).toBeNull();
  });

  it("matches startsWith from the beginning only", () => {
    const t = trigger("t1", { keywords: [{ value: "info", matchType: "startsWith" }] });
    expect(matchCommentTrigger([t], comment("info please"))?.id).toBe("t1");
    expect(matchCommentTrigger([t], comment("more info"))).toBeNull();
  });

  it("returns the first matching trigger in array order (caller pre-sorts by priority)", () => {
    const low = trigger("low", { keywords: [{ value: "deal" }] });
    const high = trigger("high", { keywords: [{ value: "deal" }] });
    expect(matchCommentTrigger([high, low], comment("deal me in"))?.id).toBe("high");
  });

  it("respects postIds scoping", () => {
    const t = trigger("t1", { keywords: [{ value: "promo" }], postIds: ["post-9"] });
    expect(matchCommentTrigger([t], comment("promo", "post-1"))).toBeNull();
    expect(matchCommentTrigger([t], comment("promo", "post-9"))?.id).toBe("t1");
  });

  it("skips triggers without keywords and returns null when nothing matches", () => {
    const empty = trigger("t1", {});
    const other = trigger("t2", { keywords: [{ value: "xyz" }] });
    expect(matchCommentTrigger([empty, other], comment("hello world"))).toBeNull();
  });

  it("returns null for empty comment text", () => {
    const t = trigger("t1", { keywords: [{ value: "hi" }] });
    expect(matchCommentTrigger([t], comment("   "))).toBeNull();
  });
});

// ── processComment: the comment-to-run link ─────────────────────────────────

const executeFlowMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flow-engine/engine", () => ({ executeFlow: executeFlowMock }));
vi.mock("@/lib/messaging", () => ({ createMessagingProvider: () => ({}) }));

const channelRow = {
  id: "ch-1",
  workspace_id: "ws-1",
  platform: "instagram",
  late_account_id: "acc-1",
} as unknown as Database["public"]["Tables"]["channels"]["Row"];

const commentTrigger = {
  id: "trg-1",
  flow_id: "flow-1",
  config: { keywords: [{ value: "quero", matchType: "contains" }] },
} as unknown as Database["public"]["Tables"]["triggers"]["Row"];

/**
 * Fake Supabase covering the shapes processComment reaches for. `calls`
 * records the order things happened in, which is the point of two of the
 * assertions below.
 */
function fakeDb({ alreadyLogged = false } = {}) {
  const calls: string[] = [];
  const commentLogRows: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: () => {
          if (table === "comment_logs") {
            return Promise.resolve({
              data: alreadyLogged ? { id: "log-old" } : null,
            });
          }
          // No contact yet on this channel.
          return Promise.resolve({ data: null });
        },
        single: () => {
          if (table === "contacts")
            return Promise.resolve({ data: { id: "contact-1" }, error: null });
          if (table === "workspaces")
            return Promise.resolve({ data: { late_api_key_encrypted: null } });
          if (table === "conversations")
            return Promise.resolve({ data: { id: "conv-1" }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          // The only list read is the trigger lookup.
          const data = table === "triggers" ? [commentTrigger] : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
        insert: () => {
          calls.push(`insert:${table}`);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "contact-1" }, error: null }),
            }),
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(r),
          };
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
        upsert: (row: Record<string, unknown>) => {
          calls.push(`upsert:${table}`);
          if (table === "comment_logs") commentLogRows.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: table === "comment_logs" ? "log-1" : "conv-1" },
                  error: null,
                }),
            }),
          };
        },
      });
      return builder;
    },
  };

  return { client: client as never, calls, commentLogRows };
}

describe("processComment", () => {
  beforeEach(() => executeFlowMock.mockReset());

  it("claims the comment log before the flow runs and hands the run its id", async () => {
    const db = fakeDb();
    executeFlowMock.mockImplementation(() => {
      db.calls.push("executeFlow");
      return Promise.resolve();
    });

    const res = await processComment({
      supabase: db.client,
      channel: channelRow,
      comment: {
        id: "c-1",
        postId: "post-9",
        text: "quero saber mais",
        author: { id: "ig-1", username: "magdahino" },
      },
    });

    expect(res).toMatchObject({ matched: true, triggerId: "trg-1" });

    // The run has to be able to point at the row, so the row goes first.
    const logAt = db.calls.indexOf("upsert:comment_logs");
    const flowAt = db.calls.indexOf("executeFlow");
    expect(logAt).toBeGreaterThanOrEqual(0);
    expect(flowAt).toBeGreaterThan(logAt);

    expect(executeFlowMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceCommentLogId: "log-1" })
    );

    // The post travels with it, which is what makes the join worth having.
    expect(executeFlowMock.mock.calls[0][1].variables).toMatchObject({
      post_id: "post-9",
    });
  });

  it("records what happened once the flow is done", async () => {
    const db = fakeDb();
    executeFlowMock.mockResolvedValue(undefined);

    await processComment({
      supabase: db.client,
      channel: channelRow,
      comment: {
        id: "c-1",
        postId: "post-9",
        text: "quero saber mais",
        author: { id: "ig-1" },
      },
    });

    const last = db.commentLogRows[db.commentLogRows.length - 1];
    expect(last).toMatchObject({
      post_id: "post-9",
      matched_trigger_id: "trg-1",
      dm_sent: true,
    });
  });

  it("does not run the flow twice for a redelivered comment", async () => {
    const db = fakeDb({ alreadyLogged: true });

    const res = await processComment({
      supabase: db.client,
      channel: channelRow,
      comment: {
        id: "c-1",
        postId: "post-9",
        text: "quero saber mais",
        author: { id: "ig-1" },
      },
    });

    expect(res).toEqual({ matched: false, skipped: "already_processed" });
    expect(executeFlowMock).not.toHaveBeenCalled();
  });
});
