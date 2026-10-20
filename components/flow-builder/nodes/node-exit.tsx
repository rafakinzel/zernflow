import { cn } from "@/lib/utils";
import type { Destination } from "@/lib/flow-destinations";

/**
 * One way out of a node.
 *
 * An earlier version wrote the destination's text under every exit. It
 * answered "what leads where" and made the card unreadable doing it, which
 * is a bad trade on a canvas whose whole job is to be scanned. The line
 * belongs on the canvas; the card keeps only what the line cannot show.
 *
 * What the line cannot show is an exit nobody wired, because a line never
 * drawn looks exactly like one that goes nowhere. That one still gets a
 * word, and nothing else does. For a couple of exits an empty one is not a
 * dead end at all but a deliberate behaviour, and those say which.
 */
export function NodeExit({
  destination,
  trailing,
  tone = "default",
}: {
  destination: Destination;
  /** Anything to pin on the right of the label, such as a tap count. */
  trailing?: React.ReactNode;
  tone?: "default" | "muted";
}) {
  const dead = !destination.targetId;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "min-w-0 flex-1 truncate rounded-full border px-1.5 py-0.5 text-[10px]",
          tone === "muted"
            ? "border-border text-muted-foreground"
            : "border-blue-200 text-blue-700 dark:border-blue-900 dark:text-blue-300"
        )}
      >
        {destination.label}
      </span>
      {dead ? (
        <span
          className={cn(
            "shrink-0 text-[10px]",
            destination.unwiredNote
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-500"
          )}
        >
          {destination.unwiredNote ?? "ends here"}
        </span>
      ) : (
        trailing
      )}
    </div>
  );
}
