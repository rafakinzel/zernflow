import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildNodeStats,
  tally,
  type RawNode,
} from "@/lib/flow-engine/node-stats";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/**
 * GET /api/v1/flows/[flowId]/stats?days=30
 *
 * How many people reached each node, and which button they pressed there.
 *
 * Both come from events we already record: a node execution carries its
 * node id, and a tap carries its payload and the node that offered it. The
 * flow itself supplies the buttons, so a node that nobody reached still
 * comes back with zeros rather than being absent.
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Scoped to the caller's workspace, so a flow id from elsewhere answers
  // 404 rather than handing over another tenant's numbers.
  const { data: flow } = await supabase
    .from("flows")
    .select("nodes")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  if (!flow) return NextResponse.json({ error: "Flow not found" }, { status: 404 });

  const requested = Number(request.nextUrl.searchParams.get("days"));
  const days =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_DAYS)
      : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [reached, taps] = await Promise.all([
    supabase
      .from("analytics_events")
      .select("metadata")
      .eq("workspace_id", membership.workspace_id)
      .eq("flow_id", flowId)
      .eq("event_type", "node_executed")
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("metadata")
      .eq("workspace_id", membership.workspace_id)
      .eq("flow_id", flowId)
      .eq("event_type", "button_tapped")
      .gte("created_at", since),
  ]);

  const readKey = (key: string) => (row: { metadata: unknown }) => {
    const value = (row.metadata as Record<string, unknown> | null)?.[key];
    return typeof value === "string" ? value : null;
  };

  const stats = buildNodeStats({
    nodes: (flow.nodes ?? []) as unknown as RawNode[],
    reachedByNode: tally(reached.data ?? [], readKey("nodeId")),
    tapsByPayload: tally(taps.data ?? [], readKey("payload")),
  });

  return NextResponse.json({ days, stats });
}
