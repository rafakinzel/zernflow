"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
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

function ratio(top: number | null, bottom: number | null): number | null {
  if (top === null || bottom === null || bottom === 0) return null;
  return top / bottom;
}

/** Per thousand people reached, which is how these numbers compare. */
function per1k(value: number | null, reach: number | null): string {
  const r = ratio(value, reach);
  if (r === null) return "—";
  const n = r * 1000;
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1);
}

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

  const engagedShare = ratio(s.accountsEngaged, s.reach);
  const tapShare = ratio(s.profileLinkTaps, s.reach);
  const viewsEach = ratio(s.views, s.reach);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Instagram{data.username ? ` · @${data.username}` : ""}
        </h2>
        <span className="text-xs text-muted-foreground">Last {data.days} days</span>
      </div>

      <Funnel
        reach={s.reach}
        engaged={s.accountsEngaged}
        taps={s.profileLinkTaps}
        engagedShare={engagedShare}
        tapShare={tapShare}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Followers
          series={s.followerSeries}
          count={s.followerCount}
          net={net}
          gained={s.followersGained}
          lost={s.followersLost}
        />
        <Reactions
          reach={s.reach}
          saves={s.saves}
          shares={s.shares}
          comments={s.comments}
          likes={s.likes}
        />
      </div>

      <section className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <p className="text-3xl font-semibold tracking-tight">
            {viewsEach === null ? "—" : viewsEach.toFixed(1)}×
          </p>
          <p className="pb-1 text-sm text-muted-foreground">
            times the average person saw your content
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {num(s.views)} views across {num(s.reach)} people
        </p>
      </section>

      {s.unavailable.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Instagram did not serve: {s.unavailable.join(", ")}. Those are left
          out rather than shown as a zero.
        </p>
      )}
    </div>
  );
}

/**
 * Reach, then the people who did something, then the people who left for the
 * bio. Three numbers that are usually read apart, drawn to the same scale so
 * the gap between them is the thing you see first.
 */
function Funnel({
  reach,
  engaged,
  taps,
  engagedShare,
  tapShare,
}: {
  reach: number | null;
  engaged: number | null;
  taps: number | null;
  engagedShare: number | null;
  tapShare: number | null;
}) {
  const steps = [
    { label: "Reached", value: reach, share: 1, tone: "bg-primary" },
    { label: "Engaged", value: engaged, share: engagedShare, tone: "bg-primary/60" },
    { label: "Tapped your link", value: taps, share: tapShare, tone: "bg-primary/30" },
  ];

  return (
    <section className="rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium">From seeing you to tapping your link</h3>
      <div className="mt-4 space-y-3">
        {steps.map((step) => {
          // A floor so a tiny step is still a visible sliver rather than
          // nothing at all: three link taps out of 46,000 is the finding.
          const width =
            step.share === null ? 0 : Math.max(step.share * 100, step.value ? 0.6 : 0);
          return (
            <div key={step.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{step.label}</span>
                <span className="font-medium tabular-nums">
                  {num(step.value)}
                  {step.share !== null && step.share < 1 && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {step.share * 100 < 0.1
                        ? "<0.1%"
                        : `${(step.share * 100).toFixed(1)}%`}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", step.tone)}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Followers({
  series,
  count,
  net,
  gained,
  lost,
}: {
  series: Array<{ date: string; value: number }>;
  count: number | null;
  net: number | null;
  gained: number | null;
  lost: number | null;
}) {
  // The series is short and the numbers are large and close together, so a
  // chart from zero would be a flat line. Scale to the range that moved.
  const values = series.map((p) => p.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = max - min || 1;

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Followers</h3>
        {net !== null && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              net >= 0 ? "text-primary" : "text-amber-600 dark:text-amber-500"
            )}
          >
            {net >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {net > 0 ? "+" : ""}
            {net}
          </span>
        )}
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {num(count)}
      </p>
      {gained !== null && lost !== null && (
        <p className="text-xs text-muted-foreground">
          {gained} joined, {lost} left
        </p>
      )}

      {series.length > 1 ? (
        <>
          <div className="mt-4 flex h-16 items-end gap-[3px]">
            {series.map((point) => (
              <div
                key={point.date}
                className="group relative flex-1"
                title={`${point.date}: ${point.value}`}
              >
                <div
                  className="w-full rounded-t-sm bg-primary/70"
                  style={{
                    height: `${Math.max(((point.value - min) / span) * 100, 4)}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{series[0].date.slice(5)}</span>
            <span>{series[series.length - 1].date.slice(5)}</span>
          </div>
        </>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Instagram has only returned {series.length} day
          {series.length === 1 ? "" : "s"} of follower history so far. The line
          fills in as the days accumulate.
        </p>
      )}
    </section>
  );
}

/**
 * What people did, measured against how many saw it.
 *
 * The raw counts favour whatever is easiest, which is always likes. Per
 * thousand reached puts a save next to a like on the same footing, and saves
 * and shares are the two that decide whether a post keeps being shown.
 */
function Reactions({
  reach,
  saves,
  shares,
  comments,
  likes,
}: {
  reach: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  likes: number | null;
}) {
  const rows = [
    { label: "Shares", value: shares, note: "Pushes distribution" },
    { label: "Saves", value: saves, note: "Pushes distribution" },
    { label: "Comments", value: comments },
    { label: "Likes", value: likes },
  ];

  const top = Math.max(...rows.map((r) => r.value ?? 0), 1);

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">How people reacted</h3>
        <span className="text-xs text-muted-foreground">per 1k reached</span>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {row.label}
                {row.note && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground/70">
                    {row.note}
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                <span className="font-medium">{per1k(row.value, reach)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {num(row.value)}
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/50"
                style={{ width: `${((row.value ?? 0) / top) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
