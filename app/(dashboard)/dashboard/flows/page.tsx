import { getWorkspace } from "@/lib/workspace";
import Link from "next/link";
import { GitBranch, Sparkles, Plug } from "lucide-react";
import { CreateFlowButton } from "@/components/create-flow-button";
import { ImportFlowButton } from "@/components/flow-actions";
import { FlowsList, type FlowRow } from "@/components/flows/flows-list";
import {
  completionRate,
  extractTriggers,
  relativeTime,
  tallyEvents,
} from "@/lib/flow-insights";
import type { FlowStatus } from "@/lib/types/database";

/**
 * How many analytics rows the list reads to build its counts.
 *
 * The counts are folded in JS rather than by a database view, which is the
 * right trade at this size and keeps the page free of a migration. The cap
 * is what stops a busy workspace from pulling its whole history into a list
 * page; past it the numbers become a floor, which is why the column is
 * labelled Runs rather than presented as a complete history.
 */
const EVENT_SCAN_LIMIT = 20_000;

export default async function FlowsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [{ data: flows }, { count: channelCount }, { data: events }] =
    await Promise.all([
      supabase
        .from("flows")
        .select("id, name, description, status, updated_at, version, nodes, edges")
        .eq("workspace_id", workspace.id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("channels")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("is_active", true),
      supabase
        .from("analytics_events")
        .select("flow_id, event_type")
        .eq("workspace_id", workspace.id)
        .in("event_type", ["flow_started", "flow_completed", "message_sent"])
        .limit(EVENT_SCAN_LIMIT),
    ]);

  const counts = tallyEvents(events ?? []);
  const now = new Date();

  const rows: FlowRow[] = (flows ?? []).map((flow) => {
    const flowCounts = counts[flow.id] ?? {
      started: 0,
      completed: 0,
      messagesSent: 0,
    };

    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      status: flow.status as FlowStatus,
      updatedAt: flow.updated_at,
      updatedLabel: relativeTime(flow.updated_at, now),
      nodeCount: Array.isArray(flow.nodes) ? flow.nodes.length : 0,
      triggers: extractTriggers(flow.nodes),
      counts: flowCounts,
      completion: completionRate(flowCounts.started, flowCounts.completed),
      nodes: flow.nodes,
      edges: flow.edges,
      version: flow.version,
    };
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Flows</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build automated chatbot flows for your channels
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ImportFlowButton />
            <Link
              href="/dashboard/flows/templates"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Templates
            </Link>
            <CreateFlowButton />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
      {(channelCount ?? 0) === 0 && (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-dashed border-border bg-card p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Connect a channel to get started</p>
            <p className="text-xs text-muted-foreground">
              Link your social media accounts so your flows can send and receive messages.
            </p>
          </div>
          <Link
            href="/dashboard/channels"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Connect
          </Link>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No flows yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your first flow to start automating conversations.
          </p>
          <div className="mt-4">
            <CreateFlowButton />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <FlowsList flows={rows} />
        </div>
      )}
      </div>
    </div>
  );
}
