import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";

/**
 * GET /api/v1/posts
 *
 * Lists the workspace's published posts so the trigger panel can show a
 * thumbnail grid instead of asking for raw post ids. Zernio exposes this
 * through the comments inbox: the rows are posts, each with its media
 * thumbnail, caption, permalink and comment count.
 *
 * Query: channelId (optional, defaults to the first active channel),
 *        limit (optional, 1..50), cursor (optional).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", membership.workspace_id)
    .single();

  if (!workspace?.late_api_key_encrypted) {
    return NextResponse.json(
      { error: "Add your Zernio API key in Settings first." },
      { status: 400 }
    );
  }

  const channelId = request.nextUrl.searchParams.get("channelId");
  let channelQuery = supabase
    .from("channels")
    .select("late_account_id, platform")
    .eq("workspace_id", membership.workspace_id)
    .eq("is_active", true);

  if (channelId) channelQuery = channelQuery.eq("id", channelId);

  const { data: channels } = await channelQuery.limit(1);
  const channel = channels?.[0];

  if (!channel?.late_account_id) {
    return NextResponse.json(
      { error: "Connect a channel first." },
      { status: 400 }
    );
  }

  const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 24;
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined;

  try {
    const zernio = createZernioClient(workspace.late_api_key_encrypted);
    const res = await zernio.comments.listInboxComments({
      query: {
        accountId: channel.late_account_id,
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

    return NextResponse.json({
      posts,
      nextCursor: res.data?.pagination?.nextCursor ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load posts from Zernio";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
