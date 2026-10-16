"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SendMessageNodeProps {
  label?: string;
  messages?: Array<{
    text?: string;
    imageUrl?: string;
    quickReplies?: Array<{ title: string; payload: string }>;
    buttons?: Array<{ title: string; type: string; payload?: string; url?: string }>;
  }>;
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

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? "border-blue-500 shadow-md" : "border-border"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-blue-500 !bg-white"
      />
      <div className="flex items-center gap-2 rounded-t-lg bg-blue-500 px-3 py-2 text-white">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">Send Message</span>
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
        {replyTitles.length > 0 && (
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
        )}

        {messageCount > 1 && (
          <span className="mt-2 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            {messageCount} messages
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-blue-500 !bg-white"
      />
    </div>
  );
}
