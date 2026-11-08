import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

/**
 * POST /api/v1/conversations/:conversationId/automation  { paused: boolean }
 *
 * Rafa (08/11/2026): the team can stop the bot on one conversation when it
 * makes no sense to carry on (they are answering a question by hand), and
 * hand it back later from where it stopped. The lead sees none of this.
 *
 * Pausing only sets the flag: the run stays parked on its step, and the cron
 * holds its scheduled steps instead of sending or dropping them. Resuming
 * clears the flag and brings each held step back to the time it was due, or
 * to now if that time passed while paused. Scheduled jobs are server-only
 * (migration 00029), so this route checks the caller's own access first and
 * then writes with the service key.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const body = await request.json().catch(() => null);
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ error: "paused must be true or false" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read through the caller's own session: RLS decides whether they may.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const service = await createServiceClient();
  const { error } = await service
    .from("conversations")
    .update({ is_automation_paused: body.paused })
    .eq("id", conversationId);
  if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });

  if (!body.paused) {
    const { data: held } = await service
      .from("scheduled_jobs")
      .select("id, payload, run_at")
      .eq("status", "pending")
      .in("type", ["resume_flow", "smart_delay_timeout"])
      .contains("payload", { conversationId });
    const now = Date.now();
    for (const job of held ?? []) {
      const payload = (job.payload ?? {}) as Record<string, unknown>;
      if (typeof payload.dueAt !== "string") continue;
      const due = new Date(payload.dueAt).getTime();
      const { dueAt: _dueAt, ...rest } = payload;
      await service
        .from("scheduled_jobs")
        .update({
          run_at: new Date(Math.max(due, now)).toISOString(),
          payload: rest as unknown as Json,
        })
        .eq("id", job.id)
        .eq("status", "pending");
    }
  }

  return NextResponse.json({ paused: body.paused });
}
