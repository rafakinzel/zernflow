import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Destination } from "@/lib/flow-destinations";

/**
 * One way out of a node, with where it goes written underneath.
 *
 * The canvas answer to "what leads where" used to be: follow the line. That
 * works until the line crosses the whole screen, and it never works at all
 * for an exit nobody wired, because a line that was never drawn looks
 * exactly like one that goes nowhere. Naming the destination in place
 * answers both, and an unwired exit says so in its own words.
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
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5">
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
        {trailing}
      </div>
      <div
        className={cn(
          "mt-0.5 flex items-center gap-1 pl-1.5 text-[10px]",
          dead ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
        )}
      >
        <CornerDownRight className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">
          {dead ? "ends the conversation" : destination.targetTitle}
        </span>
      </div>
    </div>
  );
}
