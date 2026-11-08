import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { isStopRequest } from "./opt-out";

type Db = SupabaseClient<Database>;

/**
 * What happens to a message typed in the middle of a flow that is not an
 * answer the flow can read (Rafa, 08/11/2026).
 *
 * The run carries on: it keeps waiting where it was, for a tap or for its own
 * deadline, and nothing is paused. A question is not a lost lead, and pausing
 * the bot on every one left people waiting on a person who never came. The
 * message is recorded as `typed_during_flow` so the Central can answer it
 * (GET /api/v1/central/perguntas-no-fluxo).
 *
 * The one exception is a plain request to stop (`isStopRequest`), which ends
 * the run at once. Pausing a conversation is otherwise only ever a person's
 * decision, from the inbox.
 */
export async function handleTypedDuringFlow(
  supabase: Db,
  s: {
    workspaceId: string;
    contactId: string;
    conversationId: string;
    sessionId: string;
    flowId: string;
    nodeId: string | null;
    text: string;
  }
): Promise<"stopped" | "noted"> {
  if (isStopRequest(s.text)) {
    await stopRun(supabase, s.sessionId);
    await supabase.from("analytics_events").insert({
      workspace_id: s.workspaceId,
      flow_id: s.flowId,
      contact_id: s.contactId,
      event_type: "flow_stopped_by_contact",
      metadata: { sessionId: s.sessionId, nodeId: s.nodeId, text: s.text.slice(0, 500) } as unknown as Json,
    });
    return "stopped";
  }

  await supabase.from("analytics_events").insert({
    workspace_id: s.workspaceId,
    flow_id: s.flowId,
    contact_id: s.contactId,
    event_type: "typed_during_flow",
    metadata: {
      sessionId: s.sessionId,
      nodeId: s.nodeId,
      conversationId: s.conversationId,
      text: s.text.slice(0, 1000),
    } as unknown as Json,
  });
  return "noted";
}

/** Ends a run and everything it had scheduled. */
export async function stopRun(supabase: Db, sessionId: string) {
  await supabase
    .from("scheduled_jobs")
    .delete()
    .in("type", ["smart_delay_timeout", "resume_flow"])
    .eq("status", "pending")
    .contains("payload", { sessionId });
  await supabase
    .from("flow_sessions")
    .update({ status: "cancelled", waiting_for_input: false, waiting_until: null })
    .eq("id", sessionId)
    .eq("status", "active");
}

/**
 * A message that reached no waiting step: the run is inside a timed Delay, or
 * the conversation is paused by the team. Same rule: note it, or stop on a
 * request to stop. Returns false when the contact has no run going.
 */
export async function handleTextOutsideAStep(
  supabase: Db,
  s: { workspaceId: string; contactId: string; channelId: string; conversationId: string; text: string }
): Promise<boolean> {
  const { data: runs } = await supabase
    .from("flow_sessions")
    .select("id, flow_id, current_node_id")
    .eq("contact_id", s.contactId)
    .eq("channel_id", s.channelId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (!runs?.length) return false;

  if (isStopRequest(s.text)) {
    for (const run of runs) {
      await handleTypedDuringFlow(supabase, {
        ...s, sessionId: run.id, flowId: run.flow_id, nodeId: run.current_node_id,
      });
    }
    return true;
  }
  const run = runs[0];
  await handleTypedDuringFlow(supabase, {
    ...s, sessionId: run.id, flowId: run.flow_id, nodeId: run.current_node_id,
  });
  return true;
}
