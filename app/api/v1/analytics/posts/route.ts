import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createMessagingProvider } from "@/lib/messaging";
import {
  overallFunnel,
  rankPosts,
  type PostMeta,
} from "@/lib/analytics/post-performance";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
/** Enough rows to see a pattern, few enough to read without scrolling. */
const TOP_N = 10;
/** One page of recent posts is plenty to caption a month of comments. */
const POSTS_FOR_CAPTIONS = 50;

/**
 * GET /api/v1/analytics/posts?days=30
 *
 * Posts ranked by the runs their comments started.
 *
 * The ranking itself is ours and comes out of the database. The captions and
 * thumbnails come from Zernio, which is why this is a route and not part of
 * the page render: the numbers must not wait on a third party, and if the
 * captions never arrive the table still ranks correctly with post ids in
 * place of titles.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(late_api_key_encrypted)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = Number(request.nextUrl.searchParams.get("days"));
  const days =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_DAYS)
      : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: comments } = await supabase
    .from("comment_logs")
    .select("id, post_id, matched_trigger_id, dm_sent")
    .eq("workspace_id", membership.workspace_id)
    .gte("created_at", since);

  const commentRows = comments ?? [];

  // Only the runs those comments started. Fetching every session in the
  // window and filtering here would drag in DM-triggered runs that have no
  // post behind them at all.
  const commentIds = commentRows.map((c) => c.id);
  const { data: sessions } = commentIds.length
    ? await supabase
        .from("flow_sessions")
        .select("source_comment_log_id, status")
        .in("source_comment_log_id", commentIds)
    : { data: [] };

  const posts = await captionsFor(
    supabase,
    membership.workspace_id,
    (membership.workspaces as { late_api_key_encrypted: string | null } | undefined)
      ?.late_api_key_encrypted ?? null
  );

  const rows = rankPosts({
    comments: commentRows,
    sessions: sessions ?? [],
    posts,
    limit: TOP_N,
  });

  // The totals are for the whole period, not just the rows shown, or the
  // summary line would disagree with itself the moment there are 11 posts.
  const funnel = overallFunnel(
    rankPosts({ comments: commentRows, sessions: sessions ?? [] })
  );

  return NextResponse.json({ rows, funnel, days });
}

/**
 * Recent posts, for captions and thumbnails. Best effort: a failure here
 * costs the table its titles, not its numbers.
 */
async function captionsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  apiKey: string | null
): Promise<PostMeta[]> {
  if (!apiKey) return [];

  try {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", "instagram")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!channel?.late_account_id) return [];

    const messaging = createMessagingProvider(apiKey);
    const { posts } = await messaging.listPosts({
      accountId: channel.late_account_id,
      limit: POSTS_FOR_CAPTIONS,
    });

    return posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      thumbnail: post.thumbnail,
      permalink: post.permalink,
    }));
  } catch (err) {
    console.error("[analytics/posts] could not read captions:", err);
    return [];
  }
}
