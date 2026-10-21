"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CountedStep } from "@/lib/analytics/flow-funnel";

interface Funnel {
  flow: { id: string; name: string };
  days: number;
  comments: { arrived: number; matched: number; dmSent: number };
  entered: number;
  fromComment: number;
  fromDirect: number;
  steps: CountedStep[];
  worst: CountedStep | null;
}

export function FlowFunnelBlock({
  flows,
  days = 30,
}: {
  flows: Array<{ id: string; name: string }>;
  days?: number;
}) {
  const [flowId, setFlowId] = useState(flows[0]?.id ?? "");
  const [data, setData] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;
    setData(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/v1/flows/${flowId}/funnel?days=${days}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body?.error || "Could not load this funnel.");
        else setData(body);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flowId, days]);

  if (flows.length === 0) return null;

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">From keyword to booked</h2>
        {flows.length > 1 && (
          <select
            aria-label="Flow"
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
          >
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-muted-foreground">{error}</p>}

      {!data && !error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Counting…
        </p>
      )}

      {data && <FunnelBody data={data} flowId={flowId} />}
    </section>
  );
}

function FunnelBody({ data, flowId }: { data: Funnel; flowId: string }) {
  const { comments, entered, fromComment, fromDirect, steps, worst } = data;

  return (
    <div className="mt-4 space-y-5">
      {/* The two doors, counted apart: a post nobody comments on and a
          keyword nobody sends are different problems with one symptom. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Door title="Through a comment">
          <Line label="Commented" value={comments.arrived} />
          <Line
            label="Matched a keyword"
            value={comments.matched}
            of={comments.arrived}
          />
          <Line label="Got the DM" value={comments.dmSent} of={comments.arrived} />
          {comments.arrived > 0 && comments.matched === 0 && (
            <p className="pt-1 text-xs text-amber-600 dark:text-amber-500">
              Comments arrived and none matched a rule. Worth reading what they
              wrote.
            </p>
          )}
        </Door>

        <Door title="Straight into the DMs">
          <Line label="Started this flow" value={fromDirect} />
          <p className="pt-1 text-xs text-muted-foreground">
            {fromComment > 0
              ? `${fromComment} more came in from a comment.`
              : "Nobody has come in from a comment in this period."}
          </p>
        </Door>
      </div>

      {steps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">
            This flow has no steps marked yet, so there is nothing to follow
            after someone enters. Open a message in{" "}
            <Link
              href={`/dashboard/flows/${flowId}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              the flow
            </Link>{" "}
            and tick &ldquo;Count as a funnel step&rdquo; on the two or three
            moments that matter.
          </p>
        </div>
      ) : (
        <div>
          <Step label="Entered the flow" value={entered} width={1} />
          {steps.map((step) => (
            <div key={step.nodeId}>
              {step.lostBefore !== null && (
                <Drop
                  lost={step.lostBefore}
                  worst={worst?.nodeId === step.nodeId}
                />
              )}
              <Step
                label={step.label}
                value={step.reached}
                width={step.share ?? 0}
                share={step.share}
              />
            </div>
          ))}
        </div>
      )}

      {worst && worst.lostBefore ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Steepest fall: </span>
          {worst.lostBefore} {worst.lostBefore === 1 ? "person" : "people"} got
          as far as the step before{" "}
          <span className="font-medium">{worst.label}</span> and stopped.
        </p>
      ) : null}
    </div>
  );
}

function Door({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3.5">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="mt-2.5 space-y-2">{children}</div>
    </div>
  );
}

function Line({ label, value, of }: { label: string; value: number; of?: number }) {
  const share = of && of > 0 ? value / of : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value}
          {share !== null && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {Math.round(share * 100)}%
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/50"
          style={{ width: `${(share ?? (value > 0 ? 1 : 0)) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Step({
  label,
  value,
  width,
  share,
}: {
  label: string;
  value: number;
  width: number;
  share?: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-sm text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="h-8 flex-1 overflow-hidden rounded-md bg-muted">
        <div
          className="h-full rounded-md bg-primary"
          style={{ width: `${Math.max(width * 100, value > 0 ? 1 : 0)}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-sm tabular-nums">
        <span className="font-medium">{value}</span>
        {share !== null && share !== undefined && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {Math.round(share * 100)}%
          </span>
        )}
      </span>
    </div>
  );
}

/** The gap between two steps, which is where the answer usually is. */
function Drop({ lost, worst }: { lost: number; worst: boolean }) {
  if (lost <= 0) {
    return (
      <div className="py-1.5 pl-[11.5rem] text-xs text-muted-foreground">
        nobody lost here
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 py-1.5 pl-[11.5rem] text-xs",
        worst
          ? "font-medium text-amber-600 dark:text-amber-500"
          : "text-muted-foreground"
      )}
    >
      <ArrowDown className="h-3 w-3" />
      {lost} stopped here{worst && ", the steepest fall"}
    </div>
  );
}
