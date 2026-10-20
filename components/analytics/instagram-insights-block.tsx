"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type { InstagramSummary } from "@/lib/analytics/instagram-insights";

interface Payload {
  summary: InstagramSummary;
  username: string | null;
  days: number;
}

/** A missing metric is a dash, never a zero. */
function num(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * The Instagram readings worth acting on.
 *
 * Loaded from the browser rather than rendered on the server because it is
 * the only thing on this page that waits on a third party. Everything else
 * is already on screen while this is still arriving.
 */
export function InstagramInsightsBlock({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/v1/analytics/instagram?days=${days}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body?.error || "Could not load Instagram insights.");
        else setData(body);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) {
    return (
      <section className="rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold">Instagram</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-border p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading Instagram insights…
      </section>
    );
  }

  const s = data.summary;
  const net =
    s.followersGained !== null && s.followersLost !== null
      ? s.followersGained - s.followersLost
      : null;

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Instagram{data.username ? ` · @${data.username}` : ""}
        </h2>
        <span className="text-xs text-muted-foreground">Last {data.days} days</span>
      </div>

      {/* The one reading the app makes hardest to get: whether the content is
          reaching anyone new, or circling the people already there. */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        <p className="text-3xl font-semibold tracking-tight">
          {pct(s.newAudienceShare)}
        </p>
        <p className="pb-1 text-sm text-muted-foreground">
          of your reach was people who don&apos;t follow you
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {num(s.reach)} reached · {num(s.reachFromNonFollowers)} new ·{" "}
        {num(s.reachFromFollowers)} already following
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Saves" value={num(s.saves)} hint="Pushes distribution" />
        <Stat label="Shares" value={num(s.shares)} hint="Pushes distribution" />
        <Stat label="Link taps" value={num(s.profileLinkTaps)} hint="Left for the bio" />
        <Stat
          label="Net followers"
          value={net === null ? "—" : `${net > 0 ? "+" : ""}${net}`}
          hint={
            s.followersGained === null
              ? undefined
              : `${s.followersGained} in, ${s.followersLost} out`
          }
          trend={net === null ? undefined : net >= 0 ? "up" : "down"}
        />
      </dl>

      {s.unavailable.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Instagram did not serve: {s.unavailable.join(", ")}. Those show as a
          dash rather than a zero.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down";
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1 text-lg font-medium">
        {trend === "up" && <TrendingUp className="h-3.5 w-3.5 text-primary" />}
        {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-amber-500" />}
        {value}
      </dd>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
