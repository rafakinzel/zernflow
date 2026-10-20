import { ExternalLink } from "lucide-react";
import type { PostPerformance } from "@/lib/analytics/post-performance";

/**
 * Posts ranked by what they produced, not by what they collected.
 *
 * The column that decides things is Runs: people the post put into a flow.
 * Comments sit beside it because the gap between the two is the diagnosis.
 * A post with many comments and few runs is a keyword problem or a reply
 * that did not land; few comments and a high rate is a post worth repeating.
 */
export function PostLeaderboard({
  rows,
  funnel,
  days,
}: {
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
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold">What each post brought in</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No comments logged in the last {days} days. This table fills itself
          as comment triggers fire.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">What each post brought in</h2>
        <span className="text-xs text-muted-foreground">Last {days} days</span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {funnel.comments} comments · {funnel.matched} hit a keyword ·{" "}
        {funnel.runs} started a flow · {funnel.completed} reached the end
        {funnel.completionRate !== null &&
          ` (${Math.round(funnel.completionRate * 100)}% of runs)`}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Post</th>
              <th className="pb-2 text-right font-medium">Comments</th>
              <th className="pb-2 text-right font-medium">Runs</th>
              <th className="pb-2 text-right font-medium">Finished</th>
              <th className="pb-2 text-right font-medium">Runs per comment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.postId} className="border-b border-border/50 last:border-0">
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    {row.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.thumbnail}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                    )}
                    <span className="line-clamp-1 max-w-[22rem] text-foreground">
                      {row.caption ?? row.postId}
                    </span>
                    {row.permalink && (
                      <a
                        href={row.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Open on Instagram"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.comments}
                </td>
                <td className="py-2.5 text-right text-base font-medium tabular-nums">
                  {row.runs}
                </td>
                <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.completed}
                </td>
                <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.runRate === null ? "—" : `${Math.round(row.runRate * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
