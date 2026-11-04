import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createMessagingProvider } from "@/lib/messaging";
import { planBackfill } from "@/lib/inbox/backfill-messages";

/**
 * Brings the inbound history back from Zernio into our own messages table.
 *
 * POST /api/v1/admin/backfill-messages
 *
 * The webhook stores inbound messages from 4 Nov 2026 on. Everything before
 * that exists only in Zernio, which the inbox reads live one thread at a
 * time. That is fine for reading and useless for counting: no query here can
 * tell a lead waiting on us from one who stopped replying while half of every
 * conversation is somewhere else.
 *
 * Resumable on purpose. One Zernio call per conversation against a few
 * hundred conversations will outlast any serverless request, so the run works
 * to a time budget, reports what is left, and is safe to call again: the
 * boundary in `planBackfill` plus the unique index on platform_message_id
 * mean a second run over the same thread files nothing.
 */

/** Leaves room to answer before the platform cuts the request off. */
const TIME_BUDGET_MS = 40_000;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = membership.workspace_id;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", workspaceId)
    .single();
  if (!workspace?.late_api_key_encrypted) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  // Every conversation with a thread on the other side, ordered by id so the
  // sequence is stable and a run that stopped halfway can say exactly where.
  // Without the cursor each call would re-walk the same first conversations
  // until the budget ran out, and never reach the tail.
  const cursor = (await request.json().catch(() => ({})))?.cursor as
    | string
    | undefined;

  let query = supabase
    .from("conversations")
    .select("id, late_conversation_id, channels(late_account_id)")
    .eq("workspace_id", workspaceId)
    .not("late_conversation_id", "is", null)
    .order("id", { ascending: true });

  if (cursor) query = query.gt("id", cursor);

  const { data: conversations, error: convError } = await query;

  if (convError) {
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }

  const messaging = createMessagingProvider(workspace.late_api_key_encrypted);

  let lastVisitedId: string | null = null;
  let rateLimited: string | null = null;

  const totals = {
    conversations: conversations?.length ?? 0,
    visited: 0,
    inserted: 0,
    alreadyCovered: 0,
    noKey: 0,
    noDate: 0,
    failed: 0,
  };
  const failures: Array<{ conversationId: string; reason: string }> = [];

  for (const conv of conversations ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const channel = conv.channels as { late_account_id: string } | null;
    if (!channel?.late_account_id || !conv.late_conversation_id) {
      totals.visited++;
      lastVisitedId = conv.id;
      continue;
    }

    try {
      // Where the webhook took over for this thread. Anything from here on
      // is already ours, so the backfill stops short of it.
      const { data: earliest } = await supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", conv.id)
        .eq("direction", "inbound")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const thread = await messaging.getConversationMessages({
        accountId: channel.late_account_id,
        conversationId: conv.late_conversation_id,
      });

      // No boundary in either direction. The boundaries existed to stop a
      // second run filing a message twice, which the upsert below now
      // handles on its own by updating the row it finds. Dropping them also
      // makes the run corrective rather than additive: the first import ran
      // against a provider that labelled every message inbound, and a
      // boundary would now treat those wrong rows as already done.
      const { rows, skipped } = planBackfill({
        conversationId: conv.id,
        messages: thread,
        earliestStoredInboundAt: null,
        earliestStoredOutboundAt: null,
      });

      totals.alreadyCovered += skipped.alreadyCovered;
      totals.noKey += skipped.noKey;
      totals.noDate += skipped.noDate;

      if (rows.length > 0) {
        const { error: insertError, count } = await supabase
          .from("messages")
          .upsert(rows, {
            // Update rather than ignore, so a row already here is corrected
            // instead of left as it was. Nothing is deleted: the key is
            // Zernio's own message id, so a second run rewrites the same row.
            onConflict: "platform_message_id",
            ignoreDuplicates: false,
            count: "exact",
          });

        if (insertError) throw new Error(insertError.message);
        totals.inserted += count ?? rows.length;
      }

      totals.visited++;
      lastVisitedId = conv.id;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // Zernio rate-limits, and a rate limit says nothing about this thread:
      // it says to come back later. Counting it as visited would carry the
      // cursor past a conversation that was never read, and the run would
      // report itself done having quietly skipped everything it hit the
      // limit on.
      if (/rate limit/i.test(reason)) {
        rateLimited = reason;
        break;
      }

      totals.visited++;
      // A thread Zernio refuses for its own reasons must not stall the run,
      // so the cursor does move past it; it is named in `failures` instead.
      lastVisitedId = conv.id;
      totals.failed++;
      if (failures.length < 20) failures.push({ conversationId: conv.id, reason });
      console.error(`[backfill] conversation ${conv.id} failed:`, reason);
    }
  }

  const remaining = Math.max(totals.conversations - totals.visited, 0);

  return NextResponse.json({
    done: remaining === 0 && !rateLimited,
    rateLimited,
    remaining,
    // Hand this back as `cursor` on the next call to carry on from here.
    cursor: lastVisitedId,
    elapsedMs: Date.now() - startedAt,
    ...totals,
    failures,
  });
}
