import { describe, it, expect } from "vitest";
import { overallFunnel, rankPosts } from "./post-performance";

const comment = (
  id: string,
  post: string | null,
  extra: { matched?: boolean; dm?: boolean } = {}
) => ({
  id,
  post_id: post,
  matched_trigger_id: extra.matched === false ? null : "trg-1",
  dm_sent: extra.dm ?? true,
});

const session = (commentId: string | null, status = "active") => ({
  source_comment_log_id: commentId,
  status,
});

describe("rankPosts", () => {
  it("credits a run to the post its comment lived on", () => {
    const rows = rankPosts({
      comments: [comment("l1", "post-a"), comment("l2", "post-b")],
      sessions: [session("l1"), session("l1"), session("l2")],
    });

    expect(rows.map((r) => [r.postId, r.runs])).toEqual([
      ["post-a", 2],
      ["post-b", 1],
    ]);
  });

  it("ranks by runs, not by comments", () => {
    const rows = rankPosts({
      comments: [
        // The popular post: lots of comments, nobody follows through.
        comment("l1", "loud"),
        comment("l2", "loud"),
        comment("l3", "loud"),
        comment("l4", "loud"),
        comment("l5", "quiet"),
      ],
      sessions: [session("l5"), session("l1")],
    });

    // Both started one run, so comments break the tie and "loud" wins it.
    expect(rows[0].postId).toBe("loud");

    const withMore = rankPosts({
      comments: [comment("l1", "loud"), comment("l2", "loud"), comment("l5", "quiet")],
      sessions: [session("l5"), session("l5"), session("l1")],
    });
    expect(withMore[0].postId).toBe("quiet");
    expect(withMore[0].runs).toBe(2);
  });

  it("counts matched comments and sent DMs apart from the total", () => {
    const rows = rankPosts({
      comments: [
        comment("l1", "post-a"),
        comment("l2", "post-a", { matched: false, dm: false }),
        comment("l3", "post-a", { dm: false }),
      ],
      sessions: [],
    });

    expect(rows[0]).toMatchObject({ comments: 3, matched: 2, dmsSent: 1 });
  });

  it("counts finished runs separately", () => {
    const rows = rankPosts({
      comments: [comment("l1", "post-a")],
      sessions: [session("l1", "completed"), session("l1", "active")],
    });

    expect(rows[0]).toMatchObject({ runs: 2, completed: 1 });
  });

  it("drops comments with no post rather than bucketing them as unknown", () => {
    const rows = rankPosts({
      comments: [comment("l1", null), comment("l2", "post-a")],
      sessions: [session("l1"), session("l2")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].postId).toBe("post-a");
    expect(rows[0].runs).toBe(1);
  });

  it("ignores a run whose comment is outside the window", () => {
    // Crediting it would put traffic in the table that the comment counts
    // beside it do not account for.
    const rows = rankPosts({
      comments: [comment("l1", "post-a")],
      sessions: [session("l1"), session("l-older")],
    });

    expect(rows[0].runs).toBe(1);
  });

  it("has no run rate for a post nobody commented on", () => {
    const rows = rankPosts({
      comments: [comment("l1", "post-a")],
      sessions: [],
      posts: [{ id: "post-a", caption: "  Como investir  ", thumbnail: null }],
    });

    expect(rows[0].runRate).toBe(0);
    expect(rows[0].caption).toBe("Como investir");
  });

  it("attaches the caption and link when the post is known", () => {
    const rows = rankPosts({
      comments: [comment("l1", "post-a")],
      sessions: [],
      posts: [
        {
          id: "post-a",
          caption: "Como investir",
          thumbnail: "https://cdn/t.jpg",
          permalink: "https://instagram.com/p/x",
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      caption: "Como investir",
      thumbnail: "https://cdn/t.jpg",
      permalink: "https://instagram.com/p/x",
    });
  });

  it("leaves an unknown post usable rather than hiding it", () => {
    const rows = rankPosts({ comments: [comment("l1", "post-z")], sessions: [] });
    expect(rows[0]).toMatchObject({ postId: "post-z", caption: null });
  });

  it("honours a limit", () => {
    const rows = rankPosts({
      comments: [comment("l1", "a"), comment("l2", "b"), comment("l3", "c")],
      sessions: [],
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });
});

describe("overallFunnel", () => {
  it("adds the period up and reports the two rates", () => {
    const rows = rankPosts({
      comments: [
        comment("l1", "a"),
        comment("l2", "a"),
        comment("l3", "b", { matched: false }),
      ],
      sessions: [session("l1", "completed"), session("l2")],
    });

    expect(overallFunnel(rows)).toEqual({
      comments: 3,
      matched: 2,
      runs: 2,
      completed: 1,
      completionRate: 0.5,
      startRate: 1,
    });
  });

  it("reports no rate rather than zero when nothing happened", () => {
    // Zero percent on a week with no comments reads as broken when it only
    // means there is nothing to divide.
    expect(overallFunnel([])).toMatchObject({
      completionRate: null,
      startRate: null,
    });
  });
});
