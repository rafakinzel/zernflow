"use client";

import { Handle, type NodeProps } from "@xyflow/react";
import {
  BRANCH_LABELS_CLASS,
  SOURCE_POSITION,
  TARGET_POSITION,
  handleOffset,
} from "@/lib/flow-orientation";
import {
  Tag,
  FileText,
  Globe,
  ArrowRightLeft,
  UserCheck,
  Bell,
  Shuffle,
  Hourglass,
  Cog,
  MessageCircleReply,
  Send,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/types/database";
import type { Destination } from "@/lib/flow-destinations";
import { NodeExit } from "./node-exit";

export interface ActionNodeProps {
  label?: string;
  actionType?: NodeType;
  tagName?: string;
  action?: "add" | "remove";
  fieldSlug?: string;
  value?: string;
  method?: string;
  url?: string;
  flowId?: string;
  message?: string;
  text?: string;
  paths?: Array<{ name: string; weight: number }>;
  timeout?: number;
  timeoutUnit?: string;
  email?: string;
  listId?: string;
  fieldValues?: Array<{ field: string; value: string }>;
  tagIds?: string[];
  /** Attached by the canvas for display only; never saved on the flow. */
  exits?: Destination[];
}

/**
 * What an action does to the conversation, which is what the canvas should
 * communicate at a glance. Colouring every action the same grey meant a
 * zoomed-out flow was an undifferentiated column, so a reader had to click
 * each card to find the one that waits or the one that ends the run.
 */
type ActionRole = "data" | "wait" | "integration" | "message" | "split" | "ending";

const roleStyles: Record<
  ActionRole,
  { header: string; handle: string; selected: string }
> = {
  data: {
    header: "bg-slate-500",
    handle: "!border-slate-400",
    selected: "border-slate-400",
  },
  wait: {
    header: "bg-amber-500",
    handle: "!border-amber-400",
    selected: "border-amber-400",
  },
  integration: {
    header: "bg-emerald-600",
    handle: "!border-emerald-500",
    selected: "border-emerald-500",
  },
  message: {
    header: "bg-blue-500",
    handle: "!border-blue-500",
    selected: "border-blue-500",
  },
  split: {
    header: "bg-violet-500",
    handle: "!border-violet-400",
    selected: "border-violet-400",
  },
  ending: {
    header: "bg-rose-500",
    handle: "!border-rose-400",
    selected: "border-rose-400",
  },
};

const actionRoles: Record<string, ActionRole> = {
  addTag: "data",
  removeTag: "data",
  setCustomField: "data",
  subscribe: "data",
  unsubscribe: "data",
  smartDelay: "wait",
  activeCampaign: "integration",
  httpRequest: "integration",
  enrollSequence: "integration",
  commentReply: "message",
  privateReply: "message",
  abSplit: "split",
  goToFlow: "ending",
  humanTakeover: "ending",
};

const actionConfig: Record<
  string,
  { icon: typeof Cog; label: string; color: string }
> = {
  addTag: {
    icon: Tag,
    label: "Add Tag",
    color: "bg-gray-500",
  },
  removeTag: {
    icon: Tag,
    label: "Remove Tag",
    color: "bg-gray-500",
  },
  setCustomField: {
    icon: FileText,
    label: "Set Field",
    color: "bg-gray-500",
  },
  activeCampaign: {
    icon: Mail,
    label: "ActiveCampaign",
    color: "bg-gray-500",
  },
  httpRequest: {
    icon: Globe,
    label: "HTTP Request",
    color: "bg-gray-500",
  },
  goToFlow: {
    icon: ArrowRightLeft,
    label: "Go To Flow",
    color: "bg-gray-500",
  },
  humanTakeover: {
    icon: UserCheck,
    label: "Human Takeover",
    color: "bg-gray-500",
  },
  subscribe: {
    icon: Bell,
    label: "Subscribe",
    color: "bg-gray-500",
  },
  unsubscribe: {
    icon: Bell,
    label: "Unsubscribe",
    color: "bg-gray-500",
  },
  commentReply: {
    icon: MessageCircleReply,
    label: "Comment Reply",
    color: "bg-blue-500",
  },
  privateReply: {
    icon: Send,
    label: "Private Reply",
    color: "bg-blue-500",
  },
  abSplit: {
    icon: Shuffle,
    label: "A/B Split",
    color: "bg-gray-500",
  },
  smartDelay: {
    icon: Hourglass,
    label: "Smart Delay",
    color: "bg-gray-500",
  },
};

function getSummary(nodeData: ActionNodeProps): string | null {
  const type = nodeData.actionType;
  if (!type) return null;

  switch (type) {
    case "addTag":
      return nodeData.tagName ? `Add "${nodeData.tagName}"` : null;
    case "removeTag":
      return nodeData.tagName ? `Remove "${nodeData.tagName}"` : null;
    case "setCustomField":
      return nodeData.fieldSlug
        ? `${nodeData.fieldSlug} = ${nodeData.value || "..."}`
        : null;
    case "httpRequest":
      return nodeData.url
        ? `${nodeData.method || "GET"} ${nodeData.url}`
        : null;
    case "goToFlow":
      return nodeData.flowId ? `Flow: ${nodeData.flowId.slice(0, 8)}...` : null;
    case "humanTakeover":
      return nodeData.message || "Hand off to agent";
    case "subscribe":
      return "Subscribe contact";
    case "unsubscribe":
      return "Unsubscribe contact";
    case "abSplit":
      if (nodeData.paths && nodeData.paths.length > 0) {
        return nodeData.paths.map((p) => `${p.name}: ${p.weight}%`).join(", ");
      }
      return null;
    case "smartDelay":
      return nodeData.timeout
        ? `Wait up to ${nodeData.timeout} ${nodeData.timeoutUnit || "minutes"}`
        : null;
    case "activeCampaign": {
      if (!nodeData.email) return null;
      const extras = [
        nodeData.fieldValues?.length
          ? `${nodeData.fieldValues.length} field(s)`
          : null,
        nodeData.tagIds?.length ? `${nodeData.tagIds.length} tag(s)` : null,
      ].filter(Boolean);
      const suffix = extras.length ? `, ${extras.join(", ")}` : "";
      return nodeData.listId
        ? `${nodeData.email} → list ${nodeData.listId}${suffix}`
        : `${nodeData.email}, no list${suffix}`;
    }
    case "commentReply":
    case "privateReply":
      return nodeData.text || null;
    default:
      return null;
  }
}

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as ActionNodeProps;
  const deadExits = (nodeData.exits ?? []).filter((e) => !e.targetId);
  const actionType = nodeData.actionType || "addTag";
  const config = actionConfig[actionType] || {
    icon: Cog,
    label: "Action",
    color: "bg-gray-500",
  };
  const Icon = config.icon;
  const label = nodeData.label || config.label;
  const summary = getSummary(nodeData);

  const isAbSplit = actionType === "abSplit";
  const paths = isAbSplit ? nodeData.paths || [] : [];
  // A Smart Delay with a timeout needs a second output so the flow can say
  // what happens when the contact never replies.
  const isSmartDelayWithTimeout =
    actionType === "smartDelay" && Boolean(nodeData.timeout);

  const role = actionRoles[actionType] ?? "data";
  const style = roleStyles[role];

  // Bookkeeping steps get a one-line pill rather than a full card. They are
  // the most numerous nodes and the least interesting to read, so giving them
  // the same footprint as a message made flows look twice as long as the
  // conversation they describe.
  const compact = role === "data" && !isAbSplit && !isSmartDelayWithTimeout;

  if (compact) {
    return (
      <div
        className={cn(
          "flex w-44 items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-sm transition-shadow",
          selected ? cn(style.selected, "shadow-md") : "border-border"
        )}
      >
        <Handle
          type="target"
          position={TARGET_POSITION}
          className={cn("!h-2.5 !w-2.5 !border-2 !bg-white", style.handle)}
        />
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate text-[11px] text-foreground">
          {summary || config.label}
        </span>
        <Handle
          type="source"
          position={SOURCE_POSITION}
          className={cn("!h-2.5 !w-2.5 !border-2 !bg-white", style.handle)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected ? cn(style.selected, "shadow-md") : "border-border"
      )}
    >
      <Handle
        type="target"
        position={TARGET_POSITION}
        className={cn("!h-3 !w-3 !border-2 !bg-white", style.handle)}
      />
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-lg px-3 py-2 text-white",
          style.header
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">{config.label}</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{label}</p>
        {summary ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground italic">Not configured</p>
        )}

        {deadExits.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {deadExits.map((exit) => (
              <NodeExit key={exit.key} destination={exit} tone="muted" />
            ))}
          </div>
        )}
      </div>
      {isAbSplit && paths.length > 0 ? (
        <>
          {paths.map((path, i) => (
            <Handle
              key={path.name}
              type="source"
              position={SOURCE_POSITION}
              id={`split-${i}`}
              style={handleOffset(i, paths.length)}
              className={cn("!h-3 !w-3 !border-2 !bg-white", style.handle)}
            />
          ))}
        </>
      ) : isSmartDelayWithTimeout ? (
        <>
          <div className={cn(BRANCH_LABELS_CLASS, "text-[10px] font-medium")}>
            <span className="text-emerald-600">Replied</span>
            <span className="text-amber-600">No reply</span>
          </div>
          <Handle
            type="source"
            position={SOURCE_POSITION}
            id="reply"
            style={handleOffset(0, 2)}
            className="!h-3 !w-3 !border-2 !border-emerald-500 !bg-white"
          />
          <Handle
            type="source"
            position={SOURCE_POSITION}
            id="timeout"
            style={handleOffset(1, 2)}
            className="!h-3 !w-3 !border-2 !border-amber-500 !bg-white"
          />
        </>
      ) : (
        <Handle
          type="source"
          position={SOURCE_POSITION}
          className={cn("!h-3 !w-3 !border-2 !bg-white", style.handle)}
        />
      )}
    </div>
  );
}
