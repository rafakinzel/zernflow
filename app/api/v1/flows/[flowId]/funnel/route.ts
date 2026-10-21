import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  biggestDrop,
  countSteps,
  funnelSteps,
  type RawEdge,
  type RawNode,
} from "@/lib/analytics/flow-funnel";

/**
 * One flow end to end: how people arrived, and where they stopped.
 *
 * The two doors are counted apart because they fail apart. A post that
 * nobody comments on and a keyword nobody sends are different problems with
 * the same symptom, and a single "entered" number hides which one you have.
 *
 * GET /api/v1/flows/<id>/funnel?days=30
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
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

  const days = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("days") || "30", 10) || 30, 1),
    365
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: flow } = await supabase
    .from("flows")
    .select("id, name, nodes, edges")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!flow) {
    return NextResponse.json({ error: "Flow not found." }, { status: 404 });
  }

  const steps = funnelSteps(
    (flow.nodes ?? []) as unknown as RawNode[],
    (flow.edges ?? []) as unknown as RawEdge[]
  );

  const [sessionsRes, nodeEventsRes, triggersRes] = await Promise.all([
    supabase
      .from("flow_sessions")
      .select("contact_id, source_comment_log_id")
      .eq("flow_id", flowId)
      .gte("created_at", since),
    // One row per node execution; the distinct contacts per node are what
    // the funnel counts, since a rescue can run a node twice for one person.
    supabase
      .from("analytics_events")
      .select("contact_id, metadata")
      .eq("workspace_id", membership.workspace_id)
      .eq("flow_id", flowId)
      .eq("event_type", "node_executed")
      .gte("created_at", since)
      .limit(50000),
    supabase.from("triggers").select("id").eq("flow_id", flowId),
  ]);

  const sessions = sessionsRes.data ?? [];
  const entered = new Set(sessions.map((s) => s.contact_id)).size;
  const fromComment = new Set(
    sessions.filter((s) => s.source_comment_log_id).map((s) => s.contact_id)
  ).size;

  // Distinct contacts per node.
  const perNode = new Map<string, Set<string>>();
  for (const event of nodeEventsRes.data ?? []) {
    const nodeId = (event.metadata as { nodeId?: string } | null)?.nodeId;
    if (!nodeId || !event.contact_id) continue;
    const seen = perNode.get(nodeId);
    if (seen) seen.add(event.contact_id);
    else perNode.set(nodeId, new Set([event.contact_id]));
  }
  const reachedByNode: Record<string, number> = {};
  for (const [nodeId, contacts] of perNode) reachedByNode[nodeId] = contacts.size;

  const triggerIds = (triggersRes.data ?? []).map((t) => t.id);

  // The comment door: how many commented, and how many of them got a DM.
  // Whether a rule recognised the text in between is a detail of how the
  // bot works, not a number anyone acts on; what matters is the gap.
  let comments = { arrived: 0, dmSent: 0 };
  if (triggerIds.length > 0) {
    const [arrivedRes, dmRes] = await Promise.all([
      // Comments are logged per workspace, not per flow, so one that matched
      // nothing cannot be attributed to a flow. Counted all the same: a
      // comment nobody's rule caught is the finding.
      supabase
        .from("comment_logs")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", membership.workspace_id)
        .gte("created_at", since),
      supabase
        .from("comment_logs")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", membership.workspace_id)
        .in("matched_trigger_id", triggerIds)
        .eq("dm_sent", true)
        .gte("created_at", since),
    ]);
    comments = {
      arrived: arrivedRes.count ?? 0,
      dmSent: dmRes.count ?? 0,
    };
  }

  const counted = countSteps(
    steps,
    reachedByNode,
    entered,
    (flow.edges ?? []) as unknown as RawEdge[]
  );

  return NextResponse.json({
    flow: { id: flow.id, name: flow.name },
    days,
    comments,
    entered,
    fromComment,
    fromDirect: Math.max(entered - fromComment, 0),
    steps: counted,
    worst: biggestDrop(counted),
  });
}
