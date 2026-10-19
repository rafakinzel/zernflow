"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowStatus } from "@/lib/types/database";

/**
 * Takes a flow on or off the air from the list, without opening it.
 *
 * Going live goes through the publish route rather than a status write, so a
 * flow put live from here gets the same version and snapshot as one
 * published from the builder. Pausing is a plain status change: nothing
 * about the graph is being promoted, it just stops answering.
 */
export function FlowStatusToggle({
  flowId,
  status,
  hasTrigger,
}: {
  flowId: string;
  status: FlowStatus;
  hasTrigger: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = status === "published";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = live
        ? await fetch(`/api/v1/flows/${flowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "draft" }),
          })
        : await fetch(`/api/v1/flows/${flowId}/publish`, { method: "POST" });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || "Could not change this flow.");
        setTimeout(() => setError(null), 4000);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  // A flow with no trigger can be published, and then never runs. Saying so
  // here is cheaper than wondering later why a live flow is silent.
  const blocked = !live && !hasTrigger;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || blocked}
        title={
          blocked
            ? "Add a trigger before putting this flow live"
            : live
              ? "Pause this flow"
              : "Put this flow live"
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          live
            ? "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            : "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
        )}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : live ? (
          <Pause className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        {live ? "Pause" : "Go live"}
      </button>

      {error && (
        <p className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-red-500/40 bg-card p-2 text-[11px] text-red-600 shadow-sm dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
