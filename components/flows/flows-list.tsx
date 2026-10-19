"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowStatusToggle } from "./flow-status-toggle";
import {
  DeleteFlowButton,
  DuplicateFlowButton,
  ExportFlowButton,
} from "@/components/flow-actions";
import {
  describeTrigger,
  type FlowTrigger,
  type FlowCounts,
} from "@/lib/flow-insights";
import type { FlowStatus, Json } from "@/lib/types/database";

export interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  updatedLabel: string;
  updatedAt: string;
  nodeCount: number;
  triggers: FlowTrigger[];
  counts: FlowCounts;
  completion: number | null;
  nodes: Json;
  edges: Json;
  version: number;
}

const statusStyles: Record<FlowStatus, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
  published: {
    label: "Live",
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  archived: {
    label: "Paused",
    classes:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

type SortKey = "updated" | "name" | "runs";

const sortLabels: Record<SortKey, string> = {
  updated: "Last edited",
  name: "Name",
  runs: "Runs",
};

/** A number worth reading, or a dash when there is nothing to report yet. */
function Metric({
  value,
  suffix,
  muted,
}: {
  value: number | null;
  suffix?: string;
  muted?: boolean;
}) {
  if (value === null) {
    return <span className="text-sm text-muted-foreground/50">&mdash;</span>;
  }
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        muted ? "text-muted-foreground" : "font-medium text-foreground"
      )}
    >
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

export function FlowsList({ flows }: { flows: FlowRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | FlowStatus>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = flows.filter((flow) => {
      if (status !== "all" && flow.status !== status) return false;
      if (!needle) return true;
      // Searching the keywords too: people look for "#rd" far more often
      // than they look for the name they gave the flow months ago.
      return (
        flow.name.toLowerCase().includes(needle) ||
        (flow.description ?? "").toLowerCase().includes(needle) ||
        flow.triggers.some((t) =>
          t.keywords.some((k) => k.toLowerCase().includes(needle))
        )
      );
    });

    return [...matches].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "runs") return b.counts.started - a.counts.started;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [flows, query, status, sort]);

  const totals = useMemo(
    () =>
      flows.reduce(
        (acc, f) => ({
          live: acc.live + (f.status === "published" ? 1 : 0),
          runs: acc.runs + f.counts.started,
          messages: acc.messages + f.counts.messagesSent,
        }),
        { live: 0, runs: 0, messages: 0 }
      ),
    [flows]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Live flows" value={totals.live} />
        <SummaryTile label="Runs started" value={totals.runs} />
        <SummaryTile label="Messages sent" value={totals.messages} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flows or keywords"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | FlowStatus)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
        >
          <option value="all">Any status</option>
          <option value="published">Live</option>
          <option value="draft">Draft</option>
          <option value="archived">Paused</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
        >
          {(Object.keys(sortLabels) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              Sort by {sortLabels[key].toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="hidden items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:flex">
          <span className="flex-1">Flow</span>
          <span className="w-20 text-right">Runs</span>
          <span className="w-24 text-right">Completed</span>
          <span className="w-24 text-right">Messages</span>
          <span className="w-28 text-right">Last edited</span>
          <span className="w-40" />
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No flow matches that.
          </p>
        ) : (
          visible.map((flow) => {
            const style = statusStyles[flow.status] ?? statusStyles.draft;
            const isOpen = expanded[flow.id] ?? false;
            const shown = isOpen ? flow.triggers : flow.triggers.slice(0, 2);

            return (
              <div
                key={flow.id}
                className="border-b border-border last:border-b-0"
              >
                <div className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-accent/40 md:flex-row md:items-center md:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          style.classes
                        )}
                      >
                        {style.label}
                      </span>
                      <Link
                        href={`/dashboard/flows/${flow.id}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {flow.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {flow.nodeCount} steps
                      </span>
                    </div>

                    {flow.triggers.length === 0 ? (
                      <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
                        No trigger set, so nothing starts this flow.
                      </p>
                    ) : (
                      <div className="mt-1.5 space-y-1">
                        {shown.map((trigger) => (
                          <div
                            key={trigger.nodeId}
                            className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                          >
                            <Zap className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                            <span>{describeTrigger(trigger)}</span>
                            {trigger.keywords.map((keyword) => (
                              <span
                                key={keyword}
                                className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground"
                              >
                                {keyword}
                              </span>
                            ))}
                          </div>
                        ))}
                        {flow.triggers.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [flow.id]: !isOpen,
                              }))
                            }
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3 w-3 transition-transform",
                                isOpen && "rotate-180"
                              )}
                            />
                            {isOpen
                              ? "Show fewer"
                              : `Show all ${flow.triggers.length}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 md:contents">
                    <span className="w-20 text-right md:block">
                      <Metric value={flow.counts.started} />
                    </span>
                    <span className="w-24 text-right md:block">
                      <Metric value={flow.completion} suffix="%" muted />
                    </span>
                    <span className="w-24 text-right md:block">
                      <Metric value={flow.counts.messagesSent} muted />
                    </span>
                    <span className="w-28 text-right text-xs text-muted-foreground md:block">
                      {flow.updatedLabel}
                    </span>
                    <span className="flex w-40 items-center justify-end gap-1 md:flex">
                      <FlowStatusToggle
                        flowId={flow.id}
                        status={flow.status}
                        hasTrigger={flow.triggers.length > 0}
                      />
                      <DuplicateFlowButton flow={flow} />
                      <ExportFlowButton flow={flow} />
                      <DeleteFlowButton flow={flow} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
