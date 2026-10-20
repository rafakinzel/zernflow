"use client";

import { Handle, type NodeProps } from "@xyflow/react";
import {
  SOURCE_POSITION,
  TARGET_POSITION,
} from "@/lib/flow-orientation";
import { Clock, MessageSquare, Users, Zap } from "lucide-react";
import type { NodeStat } from "@/lib/flow-engine/node-stats";
import { cn } from "@/lib/utils";

const POST_ACTION_LABELS: Record<string, string> = {
  setCustomField: "save field",
  addTag: "add tag",
  removeTag: "remove tag",
  activeCampaign: "ActiveCampaign",
};

export interface SendMessageNodeProps {
  label?: string;
  messages?: Array<{
    text?: string;
    imageUrl?: string;
    delaySeconds?: number;
    quickReplies?: Array<{ title: string; payload: string }>;
    buttons?: Array<{ title: string; type: string; payload?: string; url?: string }>;
  }>;
  postActions?: Array<{ actionType?: string }>;
  /** Attached by the canvas for display only; never saved on the flow. */
  stats?: NodeStat;
}

export function SendMessageNode({ data, selected }: NodeProps) {
  const nodeData = data as SendMessageNodeProps;
  const label = nodeData.label || "Send Message";
  const firstMessage = nodeData.messages?.[0];
  const messageCount = nodeData.messages?.length || 0;
  const replyTitles = (nodeData.messages ?? []).flatMap((m) =>
    [...(m.buttons ?? []), ...(m.quickReplies ?? [])]
      .map((b) => b.title?.trim())
      .filter((t): t is string => Boolean(t))
  );

  // One card can now hold a paced sequence, so the total wait is worth
  // showing: otherwise a node that takes 20 seconds to finish looks
  // identical to one that fires instantly.
  const pausedSeconds = (nodeData.messages ?? []).reduce(
    (total, m) => total + Math.max(0, m.delaySeconds ?? 0),
    0
  );

  const stats = nodeData.stats;
  // Buttons carry their own share once there are numbers, which is the
  // reading a node-level count cannot give: not how many got here, but which
  // of the options they took and which one nobody takes.
  const buttonStats = stats?.buttons ?? [];

  const actionLabels = (nodeData.postActions ?? [])
    .map((a) => (a.actionType ? POST_ACTION_LABELS[a.actionType] ?? a.actionType : null))
    .filter((l): l is string => Boolean(l));

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-blue-500 shadow-md" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={TARGET_POSITION}
        className="!h-3 !w-3 !border-2 !border-blue-500 !bg-white"
      />
      <div className="flex items-center gap-2 rounded-t-lg bg-blue-500 px-3 py-2 text-white">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Send Message</span>
        {stats && (
          <span
            className="ml-auto flex items-center gap-1 text-[10px] font-medium tabular-nums"
            title="People who reached this step in the last 30 days"
          >
            <Users className="h-2.5 w-2.5" />
            {stats.reached}
          </span>
        )}
      </div>
      <div className="p-3">
        {/* The header already says "Send Message", so the default label would
            spend the card's most readable line saying it twice. On a canvas
            with dozens of nodes the message itself is what tells them apart. */}
        {label !== "Send Message" && (
          <p className="mb-1 text-sm font-medium">{label}</p>
        )}

        {firstMessage?.text ? (
          <p className="line-clamp-3 text-xs leading-snug text-muted-foreground">
            {firstMessage.text}
          </p>
        ) : firstMessage?.imageUrl ? (
          <p className="text-xs text-muted-foreground">Image message</p>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            No message configured
          </p>
        )}

        {/* Button titles rather than a count: two nodes asking a yes/no
            question look identical until you can read the answers. */}
        {buttonStats.length > 0 ? (
          <div className="mt-2 space-y-1">
            {buttonStats.map((button) => (
              <div
                key={button.payload}
                className="flex items-center gap-1.5 text-[10px]"
              >
                <span className="min-w-0 flex-1 truncate rounded-full border border-blue-200 px-1.5 py-0.5 text-blue-700 dark:border-blue-900 dark:text-blue-300">
                  {button.title}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {button.taps}
                  {button.rate !== null && ` · ${Math.round(button.rate * 100)}%`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          replyTitles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {replyTitles.slice(0, 2).map((title, i) => (
                <span
                  key={i}
                  className="max-w-full truncate rounded-full border border-blue-200 px-1.5 py-0.5 text-[10px] text-blue-700 dark:border-blue-900 dark:text-blue-300"
                >
                  {title}
                </span>
              ))}
              {replyTitles.length > 2 && (
                <span className="rounded-full px-1 py-0.5 text-[10px] text-muted-foreground">
                  +{replyTitles.length - 2}
                </span>
              )}
            </div>
          )
        )}

        {(messageCount > 1 || pausedSeconds > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {messageCount > 1 && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {messageCount} messages
              </span>
            )}
            {pausedSeconds > 0 && (
              <span className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {pausedSeconds}s
              </span>
            )}
          </div>
        )}

        {/* Attached side effects, so the canvas still says what the step does
            even though these no longer have cards of their own. */}
        {actionLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-2">
            <Zap className="h-2.5 w-2.5 text-muted-foreground" />
            {actionLabels.map((label, i) => (
              <span
                key={i}
                className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={SOURCE_POSITION}
        className="!h-3 !w-3 !border-2 !border-blue-500 !bg-white"
      />
    </div>
  );
}
