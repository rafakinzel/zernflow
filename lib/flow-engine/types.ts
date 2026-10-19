import type { NodeType, Platform } from "@/lib/types/database";

export interface FlowNode {
  id: string;
  type: NodeType;
  data: NodeData;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export type NodeData =
  | TriggerNodeData
  | SendMessageNodeData
  | ConditionNodeData
  | DelayNodeData
  | TagNodeData
  | SetFieldNodeData
  | HttpRequestNodeData
  | GoToFlowNodeData
  | HumanTakeoverNodeData
  | ABSplitNodeData
  | SmartDelayNodeData
  | SubscribeNodeData
  | CommentReplyNodeData
  | PrivateReplyNodeData
  | AiResponseNodeData
  | EnrollSequenceNodeData
  | ActiveCampaignNodeData;

export interface TriggerNodeData {
  triggerType: string;
  keywords?: Array<{
    value: string;
    matchType: "exact" | "contains" | "startsWith";
  }>;
  payload?: string;
}

/**
 * Work a node does after its own, without earning a node of its own.
 *
 * Storing a tag or a field used to cost a whole card on the canvas, so a
 * four-step funnel drew as twelve. These ride along on the node that caused
 * them instead. Only side effects are allowed: nothing here can branch, wait
 * or hand the contact to another flow, because that would hide control flow
 * inside a card that looks like a single step.
 */
export type PostAction =
  | ({ actionType: "setCustomField" } & SetFieldNodeData)
  | ({ actionType: "addTag" | "removeTag" } & TagNodeData)
  | ({ actionType: "activeCampaign" } & ActiveCampaignNodeData);

export interface SendMessageNodeData {
  messages: Array<{
    text?: string;
    imageUrl?: string;
    /**
     * Seconds to wait before this bubble is sent, so one card can hold a
     * paced sequence instead of alternating message and delay nodes.
     * Capped by the engine: this runs inside the request, so a long wait
     * still belongs in a Delay node.
     */
    delaySeconds?: number;
    quickReplies?: Array<{ title: string; payload: string }>;
    buttons?: Array<{
      title: string;
      type: "postback" | "url";
      payload?: string;
      url?: string;
    }>;
    carousel?: {
      elements: Array<{
        imageUrl?: string;
        title: string;
        subtitle?: string;
        buttons?: Array<{
          type: "postback" | "url";
          title: string;
          payload?: string;
          url?: string;
        }>;
      }>;
    };
  }>;
  /** Side effects to run once the messages are out. */
  postActions?: PostAction[];
}

export interface ConditionNodeData {
  conditions: Array<{
    field: string;
    operator: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt";
    value: string;
  }>;
  logic: "and" | "or";
}

export interface DelayNodeData {
  duration: number;
  unit: "seconds" | "minutes" | "hours" | "days";
}

export interface TagNodeData {
  action: "add" | "remove";
  tagName: string;
}

export interface SetFieldNodeData {
  fieldSlug: string;
  value: string;
}

/**
 * Sends the contact to ActiveCampaign. The credentials are not here on
 * purpose: they live on the workspace, so rotating a key does not mean
 * hunting through every node of every flow.
 */
export interface ActiveCampaignNodeData {
  /** ActiveCampaign list id to subscribe to; empty means "contact only". */
  listId?: string;
  /** Interpolated before sending, so "{{email}}" is the usual value. */
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** Custom fields, keyed by the numeric ActiveCampaign field id. */
  fieldValues?: Array<{ field: string; value: string }>;
  /** Existing ActiveCampaign tags to apply, by tag id. */
  tagIds?: string[];
  /** Variable to receive the ActiveCampaign contact id, when set. */
  responseVariable?: string;
}

export interface HttpRequestNodeData {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  responseVariable?: string;
}

/**
 * Hands the contact over to another flow. The handover is one-way: there is
 * no return. The `flow_stack` column exists for a future version that pushes
 * the caller and comes back, which is why `returnAfter` is not offered here
 * rather than offered and ignored.
 */
export interface GoToFlowNodeData {
  flowId: string;
}

export interface HumanTakeoverNodeData {
  message?: string;
}

export interface ABSplitNodeData {
  paths: Array<{ name: string; weight: number }>;
}

export interface SmartDelayNodeData {
  timeout: number;
  timeoutUnit: "minutes" | "hours" | "days";
}

export interface SubscribeNodeData {
  action: "subscribe" | "unsubscribe";
}

export interface CommentReplyNodeData {
  /** Text to reply to the comment with. Supports {{variable}} interpolation. */
  text: string;
}

export interface PrivateReplyNodeData {
  /** Text to send as a private DM to the commenter. Supports {{variable}} interpolation. */
  text: string;
  imageUrl?: string;
}

export interface AiResponseNodeData {
  label?: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextMessages: number;
  /**
   * The generated text is always stored in the ai_response variable. When false,
   * the node ONLY stores it (no send), so a later Send Message node can use
   * {{ai_response}} without double-sending. Defaults to true for back-compat.
   */
  sendDirectly?: boolean;
}

export interface EnrollSequenceNodeData {
  /** The ID of the sequence to enroll the contact into */
  sequenceId: string;
}

export interface FlowExecutionContext {
  triggerId: string;
  flowId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
  workspaceId: string;
  /** The Zernio API conversation ID (from conversations.late_conversation_id) */
  lateConversationId?: string;
  /** The Zernio API account ID (from channels.late_account_id) */
  lateAccountId?: string;
  incomingMessage: {
    text?: string;
    postbackPayload?: string;
    quickReplyPayload?: string;
    callbackData?: string;
    sender?: { id: string; name?: string; username?: string };
  };
  variables?: Record<string, string>;
  platform?: Platform;
}
