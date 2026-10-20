"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PostLeaderboard } from "./post-leaderboard";
import type { PostPerformance } from "@/lib/analytics/post-performance";

interface Payload {
  rows: PostPerformance[];
  funnel: {
    comments: number;
    matched: number;
    runs: number;
    completed: number;
    completionRate: number | null;
    startRate: number | null;
  };
  days: number;
}

/** Loads the ranking, which waits on Zernio for captions but not for numbers. */
export function PostLeaderboardBlock({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/v1/analytics/posts?days=${days}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body?.error || "Could not load the post ranking.");
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
        <h2 className="text-sm font-semibold">What each post brought in</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-border p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Ranking your posts…
      </section>
    );
  }

  return <PostLeaderboard rows={data.rows} funnel={data.funnel} days={data.days} />;
}
