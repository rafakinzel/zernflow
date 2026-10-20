import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/secrets";
import { fetchInstagramSummary } from "@/lib/analytics/instagram-insights";

/** Instagram's insights windows are days, and a month is the useful one. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/v1/analytics/instagram?days=30
 *
 * The account insights for the workspace's Instagram channel.
 *
 * A route of its own rather than part of the page's server render, because
 * it calls a third party: a slow or sulking Zernio would otherwise hold up
 * the whole Analytics page, where everything else comes straight from our
 * own database and renders immediately.
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

  const workspace = membership?.workspaces as
    | { late_api_key_encrypted: string | null }
    | undefined;

  if (!membership || !workspace) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspace.late_api_key_encrypted) {
    return NextResponse.json(
      { error: "No Zernio API key is set. Settings has the field." },
      { status: 400 }
    );
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("late_account_id, username")
    .eq("workspace_id", membership.workspace_id)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!channel?.late_account_id) {
    return NextResponse.json(
      { error: "No Instagram account is connected on this workspace." },
      { status: 404 }
    );
  }

  const requested = Number(request.nextUrl.searchParams.get("days"));
  const days =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_DAYS)
      : DEFAULT_DAYS;

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const summary = await fetchInstagramSummary({
      apiKey: decryptSecret(workspace.late_api_key_encrypted),
      accountId: channel.late_account_id,
      since: isoDay(since),
      until: isoDay(until),
    });

    return NextResponse.json({ summary, username: channel.username ?? null, days });
  } catch (err) {
    // decryptSecret throws on a key that neither the current nor the previous
    // ENCRYPTION_KEY opens, which is worth saying plainly rather than as a 500.
    const message = err instanceof Error ? err.message : "Could not read insights.";
    console.error("[analytics/instagram] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
