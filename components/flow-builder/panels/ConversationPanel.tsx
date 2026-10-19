"use client";

import { useMemo, useState } from "react";
import { Clock, CornerDownLeft, MessageSquare, RotateCcw, X, Zap } from "lucide-react";
import { buildThread } from "@/lib/flow-walk";
import { MessagePreview } from "./MessagePreview";

/**
 * Reads one path through the flow as the thread a contact receives.
 *
 * The canvas answers "what is wired to what". It does not answer "what does
 * this actually sound like", which is the question anyone reviewing copy is
 * holding: on a flow of thirty nodes that means opening each card in order
 * and keeping the sequence in your head. Here the path plays out in order,
 * and at every fork the reader picks the branch in the words the contact
 * would see.
 */
export function ConversationPanel({
  nodes,
  edges,
  onClose,
  onHighlightNode,
}: {
  nodes: unknown;
  edges: unknown;
  onClose: () => void;
  onHighlightNode?: (nodeId: string) => void;
}) {
  const [choices, setChoices] = useState<string[]>([]);

  const thread = useMemo(
    () => buildThread(nodes, edges, choices),
    [nodes, edges, choices]
  );

  const messageCount = thread.steps.filter((s) => s.kind === "message").length;

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Conversation</p>
            <p className="text-[11px] text-muted-foreground">
              {messageCount === 0
                ? "Nothing sent on this path yet"
                : `${messageCount} message${messageCount === 1 ? "" : "s"} so far`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {choices.length > 0 && (
            <button
              type="button"
              onClick={() => setChoices([])}
              title="Start over"
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4">
        {thread.steps.length === 0 && (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            Add a trigger and a message to see the conversation.
          </p>
        )}

        {thread.steps.map((step, i) => {
          if (step.kind === "message") {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onHighlightNode?.(step.nodeId)}
                className="block w-full cursor-pointer text-left"
                title="Open this step on the canvas"
              >
                <MessagePreview messages={step.bubbles} />
              </button>
            );
          }

          const Icon =
            step.kind === "wait"
              ? Clock
              : step.kind === "reply"
                ? CornerDownLeft
                : Zap;

          return (
            <div
              key={i}
              className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"
            >
              <span className="h-px flex-1 bg-border" />
              <Icon className="h-3 w-3 shrink-0" />
              <span>{step.label}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          );
        })}

        {thread.pending && (
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              What happens next?
            </p>
            <div className="mt-2 space-y-1.5">
              {thread.pending.map((branch) => (
                <button
                  key={branch.edgeId}
                  type="button"
                  onClick={() => setChoices((prev) => [...prev, branch.edgeId])}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-[13px] transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {branch.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.ending === "end" && thread.steps.length > 0 && (
          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            End of this path.
          </p>
        )}

        {thread.ending === "loop" && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
            This path keeps going round. That is normal for a question that
            re-asks itself, but worth a look if you did not expect it.
          </p>
        )}
      </div>
    </div>
  );
}
