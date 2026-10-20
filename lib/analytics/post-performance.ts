/**
 * What each post actually produced.
 *
 * Instagram ranks a post by how many people liked it. The only ranking worth
 * acting on here is how many people it put into a flow, and that one belongs
 * to us: a comment row knows its post, a run knows the comment that started
 * it. A post with 400 likes and 2 conversations loses to one with 80 likes
 * and 15, and on Instagram those two look identical.
 *
 * Pure on purpose. Everything below is arithmetic over rows the caller has
 * already fetched, so the ranking can be tested without a database.
 */

export interface CommentLogRow {
  id: string;
  post_id: string | null;
  matched_trigger_id: string | null;
  dm_sent: boolean | null;
}

export interface SessionRow {
  source_comment_log_id: string | null;
  status: string | null;
}

export interface PostMeta {
  id: string;
  caption?: string;
  thumbnail?: string | null;
  permalink?: string | null;
}

export interface PostPerformance {
  postId: string;
  caption: string | null;
  thumbnail: string | null;
  permalink: string | null;
  /** Comments we logged on this post, matched or not. */
  comments: number;
  /** Comments that hit a keyword and were meant to start something. */
  matched: number;
  /** Comments where the DM actually went out. */
  dmsSent: number;
  /** Runs started by those comments. */
  runs: number;
  /** Runs that reached the end of the flow. */
  completed: number;
  /**
   * Runs per comment. Null when there are no comments, rather than zero:
   * a post nobody commented on has no conversion rate, it has no data.
   */
  runRate: number | null;
}

/**
 * Ranks posts by runs started, then by comments.
 *
 * Comments with no post id are dropped. They come from a platform that did
 * not tell us where the comment lived, and a bucket called "unknown" sitting
 * at the top of a leaderboard is worse than a shorter leaderboard.
 */
export function rankPosts({
  comments,
  sessions,
  posts = [],
  limit,
}: {
  comments: CommentLogRow[];
  sessions: SessionRow[];
  posts?: PostMeta[];
  limit?: number;
}): PostPerformance[] {
  const metaById = new Map(posts.map((p) => [p.id, p]));

  // Which post each comment belongs to, so a run can be credited through it.
  const postByCommentId = new Map<string, string>();
  const byPost = new Map<string, PostPerformance>();

  const blank = (postId: string): PostPerformance => {
    const meta = metaById.get(postId);
    return {
      postId,
      caption: meta?.caption?.trim() || null,
      thumbnail: meta?.thumbnail ?? null,
      permalink: meta?.permalink ?? null,
      comments: 0,
      matched: 0,
      dmsSent: 0,
      runs: 0,
      completed: 0,
      runRate: null,
    };
  };

  for (const comment of comments) {
    if (!comment.post_id) continue;
    postByCommentId.set(comment.id, comment.post_id);

    const row = byPost.get(comment.post_id) ?? blank(comment.post_id);
    row.comments++;
    if (comment.matched_trigger_id) row.matched++;
    if (comment.dm_sent) row.dmsSent++;
    byPost.set(comment.post_id, row);
  }

  for (const session of sessions) {
    if (!session.source_comment_log_id) continue;
    const postId = postByCommentId.get(session.source_comment_log_id);
    // A run whose comment is outside the window being reported on. Counting
    // it would credit a post for traffic that is not in the same period as
    // the comments shown beside it.
    if (!postId) continue;

    const row = byPost.get(postId) ?? blank(postId);
    row.runs++;
    if (session.status === "completed") row.completed++;
    byPost.set(postId, row);
  }

  const ranked = [...byPost.values()].map((row) => ({
    ...row,
    runRate: row.comments > 0 ? row.runs / row.comments : null,
  }));

  ranked.sort((a, b) => b.runs - a.runs || b.comments - a.comments);

  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

/**
 * The one-line read over the whole period: did the comments turn into
 * conversations at all.
 */
export function overallFunnel(rows: PostPerformance[]): {
  comments: number;
  matched: number;
  runs: number;
  completed: number;
  /** Of the runs that started, the share that reached the end. */
  completionRate: number | null;
  /** Of the comments that matched a keyword, the share that became a run. */
  startRate: number | null;
} {
  const sum = (pick: (r: PostPerformance) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  const comments = sum((r) => r.comments);
  const matched = sum((r) => r.matched);
  const runs = sum((r) => r.runs);
  const completed = sum((r) => r.completed);

  return {
    comments,
    matched,
    runs,
    completed,
    completionRate: runs > 0 ? completed / runs : null,
    startRate: matched > 0 ? runs / matched : null,
  };
}
