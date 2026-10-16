"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface FlowOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/**
 * Picks the flow to hand the contact over to.
 *
 * The flows come from the workspace, by name: this used to be a text box for
 * a raw UUID, which meant opening the other flow in a tab and copying its id
 * out of the address bar.
 */
export function GoToFlowPanel({ data, onChange }: Props) {
  const pathname = usePathname();
  const currentFlowId = pathname?.split("/").filter(Boolean).pop() ?? "";
  const flowId = (data.flowId as string) ?? "";

  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/flows");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Could not load your flows.");
        return;
      }
      setFlows(Array.isArray(body) ? body : []);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A flow cannot hand over to itself: that is an immediate loop.
  const options = flows.filter((f) => f.id !== currentFlowId);
  const chosen = flows.find((f) => f.id === flowId);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            Go to flow
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title="Reload"
            className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
          >
            <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </button>
        </div>

        <select
          value={flowId}
          onChange={(e) => onChange({ ...data, flowId: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">Choose a flow</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.status === "published" ? "" : " (draft)"}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-xs text-muted-foreground">
          The contact enters that flow from its start, carrying what was already
          captured here, such as name and email.
        </p>
      </div>

      {chosen && chosen.status !== "published" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-xs text-foreground">
            That flow is a draft. While it stays one, anyone reaching this node
            gets nothing. Publish it before using this node.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="text-xs">
            <p className="text-foreground">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-1 font-medium text-emerald-500 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && flows.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading your flows.
        </p>
      )}

      <p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
        This node ends the current flow. Anything wired after it never runs, so
        keep it as the last step on its path.
      </p>
    </div>
  );
}
