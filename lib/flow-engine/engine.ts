import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type {
  FlowNode,
  FlowEdge,
  FlowExecutionContext,
  SendMessageNodeData,
  ConditionNodeData,
  DelayNodeData,
  TagNodeData,
  SetFieldNodeData,
  HttpRequestNodeData,
  GoToFlowNodeData,
  ABSplitNodeData,
  SmartDelayNodeData,
  CommentReplyNodeData,
  PrivateReplyNodeData,
  AiResponseNodeData,
  EnrollSequenceNodeData,
  ActiveCampaignNodeData,
} from "./types";
import {
  addContactToList,
  getWorkspaceCredentials,
  syncContact,
} from "@/lib/activecampaign";
import { executeAiResponse } from "./nodes/ai-response";
import { adaptMessage } from "./platform-adapter";
import { createMessagingProvider } from "@/lib/messaging";
import type { MessagingProvider, OutboundMessage } from "@/lib/messaging";

/**
 * Variables that belong to the event being processed right now. A value stored
 * on the contact must never fill one of these: a saved field named `message`
 * would otherwise stand in for what the contact just typed on a cron resume,
 * and every condition written against it would read the wrong turn.
 */
const EVENT_OWNED_VARIABLES = new Set([
  "message",
  "payload",
  "post_id",
  "comment_id",
]);

export async function executeFlow(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
) {
  // Ensure variables always exists so nodes (aiResponse, httpRequest) can write
  // outputs even when the trigger passed none (e.g. DM-triggered flows).
  context.variables ??= {};

  // Seed {{message}} from the incoming message text so the variable offered in
  // the builder resolves in production, not just in the simulator (which seeds
  // it itself). Guarded so cron resumes with an empty incomingMessage don't
  // clobber a previously stored value.
  if (context.incomingMessage.text) {
    context.variables.message ??= context.incomingMessage.text;
  }

  // A button or quick-reply tap arrives as its visible label, so {{message}}
  // holds the label and a condition written against it breaks the day someone
  // rewords the button. Expose the payload separately as the stable handle.
  const tappedPayload =
    context.incomingMessage.quickReplyPayload ||
    context.incomingMessage.postbackPayload ||
    context.incomingMessage.callbackData;
  if (tappedPayload) {
    context.variables.payload = tappedPayload;
  }

  // Seed what this contact has already told us, then fall back to the profile
  // name. A flow that asked "what's your name?" three weeks ago must not greet
  // the person by their @ today, so a stored field outranks the platform
  // profile. full_name is the guard because it is always set below: when it is
  // present the variables were restored from the session and the read is moot.
  if (!context.variables.full_name) {
    const { data: profile } = await supabase
      .from("contacts")
      .select(
        "display_name, contact_custom_fields(value, custom_field_definitions(slug))"
      )
      .eq("id", context.contactId)
      .single();

    const storedFields = (profile?.contact_custom_fields ?? []) as Array<{
      value: string | null;
      custom_field_definitions: { slug: string } | null;
    }>;

    for (const field of storedFields) {
      const slug = field.custom_field_definitions?.slug;
      if (!slug || EVENT_OWNED_VARIABLES.has(slug)) continue;
      const value = field.value?.trim();
      if (!value) continue;
      if (!context.variables[slug]) context.variables[slug] = value;
    }

    const displayName = profile?.display_name?.trim();
    // A contact with no name and no username falls back to the raw platform
    // id, which must never be greeted as a name ("Opa 17829384562, vamos").
    // Seed blanks instead, and interpolation tidies the leftover punctuation.
    const usable = displayName && !/^\d{5,}$/.test(displayName);
    if (!context.variables.full_name) {
      context.variables.full_name = usable ? displayName : "";
    }
    if (!context.variables.first_name) {
      context.variables.first_name = usable ? displayName.split(/\s+/)[0] : "";
    }
  }

  // A matched trigger means the contact sent the keyword, which reads as
  // "start over", so retire whatever run they were parked in. Resuming
  // instead would swallow the keyword as the answer to the last question the
  // flow asked, and skip the fresh-start work below (the public reply).
  // A resume (cron, or a reply that matched no trigger) passes no triggerId.
  if (context.triggerId) {
    await supabase
      .from("flow_sessions")
      .update({ status: "cancelled" })
      .eq("contact_id", context.contactId)
      .eq("channel_id", context.channelId)
      .eq("status", "active")
      .eq("waiting_for_input", true);
  } else {
    const { data: activeSession } = await supabase
      .from("flow_sessions")
      .select("*")
      .eq("contact_id", context.contactId)
      .eq("channel_id", context.channelId)
      .eq("status", "active")
      .eq("waiting_for_input", true)
      .maybeSingle();

    if (activeSession) {
      return resumeSession(supabase, activeSession, context);
    }
  }

  // Load flow
  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", context.flowId)
    .eq("status", "published")
    .single();

  if (!flow) return;

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  // Get channel platform and late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id from the conversation record if not already set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  // Create session
  const { data: session } = await supabase
    .from("flow_sessions")
    .insert({
      contact_id: context.contactId,
      flow_id: context.flowId,
      channel_id: context.channelId,
      status: "active",
      variables: context.variables || {},
    })
    .select("id")
    .single();

  if (!session) return;

  // Track flow_started
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "flow_started",
    metadata: { triggerId: context.triggerId },
  });

  // Find the trigger node (entry point)
  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) return;

  // The public reply under the comment is posted by the comment processor
  // before the flow runs (see pickCommentReply), so nothing to do here.

  // Get the first connected node
  const firstEdge = edges.find((e) => e.source === triggerNode.id);
  if (!firstEdge) return;

  const startNode = nodes.find((n) => n.id === firstEdge.target);
  if (!startNode) return;

  await traverseNodes(supabase, session.id, startNode, nodes, edges, context, 0);
}

const MAX_TRAVERSAL_DEPTH = 50;

/** Delays at or below this run inline instead of going through the cron. */
const INLINE_DELAY_MAX_MS = 10_000;

// Thrown before resumeSession advances current_node_id, so callers may retry
// without cancelling the session.
export class FlowLoadError extends Error {}

export async function resumeSession(
  supabase: SupabaseClient<Database>,
  session: Database["public"]["Tables"]["flow_sessions"]["Row"],
  context: FlowExecutionContext
) {
  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", session.flow_id)
    .single();

  if (!flow) {
    // postgrest-js swallows transient failures into { data: null, error }, it
    // does not throw. Only PGRST116 (zero rows) means the flow row is genuinely
    // gone; anything else is a transient DB/network blip, so throw and let the
    // caller recover (cron retry with backoff, or the contact's next message on
    // the webhook path) instead of permanently cancelling the session.
    if (flowError && flowError.code !== "PGRST116") {
      throw new FlowLoadError(
        `flow ${session.flow_id} could not be loaded: ${flowError.message}`
      );
    }
    await cancelUnresumableSession(
      supabase,
      session.id,
      `flow ${session.flow_id} no longer exists`
    );
    return;
  }

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id if not set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  context.variables = (session.variables as Record<string, string>) || {};

  // The resume is driven by a fresh reply; make {{message}} reflect it. A tap
  // on a button or quick reply carries no text, so fall back to its payload —
  // otherwise a condition node can never tell which button was pressed.
  const tapped =
    context.incomingMessage.quickReplyPayload ||
    context.incomingMessage.postbackPayload ||
    context.incomingMessage.callbackData;
  const replyText = context.incomingMessage.text || tapped;
  if (replyText) {
    context.variables.message = replyText;
  }
  // The payload is the stable handle for a tap; the label can be reworded.
  if (tapped) {
    context.variables.payload = tapped;
  }

  // The contact replied, so the Smart Delay give-up job must not fire later
  // and push them down the "no reply" branch mid-conversation.
  await supabase
    .from("scheduled_jobs")
    .delete()
    .eq("type", "smart_delay_timeout")
    .eq("status", "pending")
    .contains("payload", { sessionId: session.id });

  // Update session
  await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: false, waiting_until: null })
    .eq("id", session.id);

  // Continue from current node
  const currentNode = nodes.find((n) => n.id === session.current_node_id);
  if (!currentNode) {
    // The flow was edited and the paused-on node removed; the session can
    // never advance, so settle it instead of leaving it active forever.
    await cancelUnresumableSession(
      supabase,
      session.id,
      `node ${session.current_node_id} no longer exists in flow ${session.flow_id}`
    );
    return;
  }

  // Get next node after the current one. A Smart Delay with a timeout has two
  // outputs, so a reply must follow the "replied" one and never fall into the
  // "no reply" branch just because that edge was drawn first.
  const outgoing = edges.filter((e) => e.source === currentNode.id);
  const nextEdge =
    outgoing.find((e) => e.sourceHandle === "reply") ??
    outgoing.find((e) => e.sourceHandle !== "timeout");
  if (!nextEdge) {
    await completeSession(supabase, session.id);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge.target);
  if (!nextNode) {
    await completeSession(supabase, session.id);
    return;
  }

  await traverseNodes(supabase, session.id, nextNode, nodes, edges, context, 0);
}

async function cancelUnresumableSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  reason: string
) {
  console.error(`Cancelling flow session ${sessionId}: ${reason}`);
  const { error } = await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  if (error) {
    // postgrest swallows network failures into { error }, so an unchecked
    // cancel can silently no-op and strand the session as active forever.
    // current_node_id has not advanced, so FlowLoadError lets callers retry
    // and re-attempt the cancel.
    throw new FlowLoadError(
      `session ${sessionId} could not be cancelled (${reason}): ${error.message}`
    );
  }
}

async function traverseNodes(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: FlowExecutionContext,
  depth: number = 0
) {
  if (depth >= MAX_TRAVERSAL_DEPTH) {
    console.error(`Flow traversal exceeded max depth (${MAX_TRAVERSAL_DEPTH}), stopping. Flow: ${context.flowId}`);
    await completeSession(supabase, sessionId);
    return;
  }
  // Update current node
  await supabase
    .from("flow_sessions")
    .update({ current_node_id: node.id })
    .eq("id", sessionId);

  // Track analytics
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "node_executed",
    metadata: { nodeId: node.id, nodeType: resolveNodeType(node) },
  });

  // Execute the node
  const result = await executeNode(supabase, node, context, sessionId);

  // Persist variables written by output-producing nodes so they survive
  // pauses (resumeSession reloads them from the session row).
  // Persist on pause too, and after setCustomField: resumeSession reloads
  // variables from the session row, so anything captured before a Smart Delay
  // was silently lost when the contact replied.
  const executedType = resolveNodeType(node);
  if (
    executedType === "aiResponse" ||
    executedType === "httpRequest" ||
    executedType === "setCustomField" ||
    executedType === "activeCampaign" ||
    result === "pause"
  ) {
    await supabase
      .from("flow_sessions")
      .update({ variables: (context.variables ?? {}) as Json })
      .eq("id", sessionId);
  }

  // If the node pauses execution (delay, wait for input, human takeover), stop
  if (result === "pause") return;

  // Find next node(s)
  let nextEdge: FlowEdge | undefined;

  if (result && typeof result === "string" && result.startsWith("handle:")) {
    // Condition/split nodes specify which handle to follow. The builder draws
    // the condition outputs as "yes"/"no" while the engine speaks
    // "true"/"false", so accept both spellings or every condition dead-ends.
    const handle = result.replace("handle:", "");
    const accepted =
      handle === "true"
        ? ["true", "yes"]
        : handle === "false"
          ? ["false", "no"]
          : [handle];
    nextEdge = edges.find(
      (e) => e.source === node.id && accepted.includes(e.sourceHandle ?? "")
    );
  } else {
    nextEdge = edges.find((e) => e.source === node.id);
  }

  if (!nextEdge) {
    await completeSession(supabase, sessionId);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge!.target);
  if (!nextNode) {
    await completeSession(supabase, sessionId);
    return;
  }

  // Continue to next node
  await traverseNodes(supabase, sessionId, nextNode, nodes, edges, context, depth + 1);
}

/**
 * The flow builder saves every Actions-category node with type "action" and
 * keeps the real kind in data.actionType, so this switch never matched them
 * and they ran as silent no-ops. Resolve the real kind before dispatching.
 */
function resolveNodeType(node: FlowNode): FlowNode["type"] {
  if ((node.type as string) !== "action") return node.type;
  const actionType = (node.data as { actionType?: string }).actionType;
  return (actionType ?? node.type) as FlowNode["type"];
}

async function executeNode(
  supabase: SupabaseClient<Database>,
  node: FlowNode,
  context: FlowExecutionContext,
  sessionId: string
): Promise<string | void> {
  const nodeType = resolveNodeType(node);

  switch (nodeType) {
    case "sendMessage":
      return executeSendMessage(supabase, node.data as SendMessageNodeData, context);
    case "condition":
      return executeCondition(supabase, node.data as ConditionNodeData, context);
    case "delay":
      return executeDelay(supabase, node.data as DelayNodeData, sessionId, node.id, context);
    case "addTag":
    case "removeTag":
      return executeTag(supabase, node.data as TagNodeData, context);
    case "setCustomField":
      return executeSetField(supabase, node.data as SetFieldNodeData, context);
    case "httpRequest":
      return executeHttpRequest(node.data as HttpRequestNodeData, context);
    case "activeCampaign":
      return executeActiveCampaign(
        supabase,
        node.data as ActiveCampaignNodeData,
        context
      );
    case "goToFlow":
      return executeGoToFlow(supabase, node.data as GoToFlowNodeData, context, sessionId);
    case "humanTakeover":
      return executeHumanTakeover(supabase, context, sessionId);
    case "subscribe":
    case "unsubscribe":
      return executeSubscription(supabase, nodeType, context);
    case "commentReply":
      return executeCommentReply(supabase, node.data as CommentReplyNodeData, context);
    case "privateReply":
      return executePrivateReply(supabase, node.data as PrivateReplyNodeData, context);
    case "aiResponse":
      return executeAiResponse(supabase, node.data as AiResponseNodeData, context, sessionId);
    case "abSplit":
      return executeABSplit(node.data as ABSplitNodeData);
    case "smartDelay":
      return executeSmartDelay(
        supabase,
        node.data as SmartDelayNodeData,
        sessionId,
        node.id,
        context
      );
    case "enrollSequence":
      return executeEnrollSequence(supabase, node.data as EnrollSequenceNodeData, context);
    default:
      return;
  }
}

async function sendFirstMessageAsPrivateReply(
  supabase: SupabaseClient<Database>,
  messaging: MessagingProvider,
  data: SendMessageNodeData,
  context: FlowExecutionContext,
  lateAccountId: string
) {
  const first = data.messages[0];
  if (!first) return;

  const text = interpolateVariables(
    adaptMessage(first, context.platform ?? "instagram").text,
    context.variables || {}
  );

  try {
    await messaging.sendPrivateReply({
      accountId: lateAccountId,
      postId: String(context.variables!.post_id),
      commentId: String(context.variables!.comment_id),
      text,
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });

    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_sent",
    });
  } catch (error) {
    console.error("Failed to send comment-context message as private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
    return;
  }

  if (data.messages.length > 1) {
    console.warn(
      "Comment flow Send Message node had multiple messages; only the first was sent (one private reply per comment)."
    );
  }
}

async function executeSendMessage(
  supabase: SupabaseClient<Database>,
  data: SendMessageNodeData,
  context: FlowExecutionContext
) {
  // Get workspace for API key
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const messaging = createMessagingProvider(workspace.late_api_key_encrypted);

  // Resolve late_account_id from channel if not in context
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id, platform")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
    if (!context.platform) {
      context.platform = channel.platform as FlowExecutionContext["platform"];
    }
  }

  // Resolve late_conversation_id from conversation if not in context
  let lateConversationId = context.lateConversationId;
  if (!lateConversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (!conversation?.late_conversation_id) {
      // Comment-triggered flows have no DM conversation yet. Instagram allows
      // exactly one private reply per comment, so deliver the first message via
      // the private-reply endpoint instead of silently dropping the whole node
      // (users build comment flows with plain Send Message nodes, not Private Reply).
      if (context.variables?.comment_id && context.variables?.post_id && lateAccountId) {
        await sendFirstMessageAsPrivateReply(supabase, messaging, data, context, lateAccountId);
        return;
      }
      console.error("No late_conversation_id found for conversation:", context.conversationId);
      return;
    }
    lateConversationId = conversation.late_conversation_id;
  }

  for (const msg of data.messages) {
    const adapted = adaptMessage(msg, context.platform!);
    const text = interpolateVariables(adapted.text, context.variables || {});

    try {
      // Media (image/video/audio) is platform-agnostic, so read it from the raw
      // message. `mediaUrl` + `mediaType` supersede the legacy image-only `imageUrl`.
      const rawMsg = msg as { mediaUrl?: string; mediaType?: string; imageUrl?: string };
      const mediaUrl = rawMsg.mediaUrl || rawMsg.imageUrl;
      const mediaType = rawMsg.mediaType || (rawMsg.imageUrl ? "image" : undefined);

      const attachments = mediaUrl
        ? [{ type: mediaType || "image", url: mediaUrl }]
        : undefined;

      // Describe the message once; the provider maps it to its own wire format.
      // Media has to travel in the send itself: it used to be stored locally
      // only, so flow media never reached the contact.
      const outbound: OutboundMessage = {
        text,
        ...(mediaUrl
          ? { attachmentUrl: mediaUrl, attachmentType: mediaType || "image" }
          : {}),
        ...(adapted.buttons?.length ? { buttons: adapted.buttons } : {}),
        ...(adapted.quickReplies?.length
          ? { quickReplies: adapted.quickReplies }
          : {}),
        ...(adapted.template ? { template: adapted.template } : {}),
        ...(adapted.replyMarkup ? { replyMarkup: adapted.replyMarkup } : {}),
      };

      const response = await messaging.sendMessage({
        accountId: lateAccountId,
        conversationId: lateConversationId,
        message: outbound,
      });

      // Store outbound message
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        attachments: attachments || null,
        sent_by_flow_id: context.flowId,
        sent_by_node_id: null,
        platform_message_id: response.messageId,
        status: "sent",
      });

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_sent",
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        sent_by_flow_id: context.flowId,
        status: "failed",
      });

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_failed",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    // Small delay between messages
    if (data.messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function executeCondition(
  supabase: SupabaseClient<Database>,
  data: ConditionNodeData,
  context: FlowExecutionContext
): Promise<string> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("*, contact_tags(tag_id, tags(name)), contact_custom_fields(field_id, value, custom_field_definitions(slug))")
    .eq("id", context.contactId)
    .single();

  if (!contact) return "handle:false";

  const results = data.conditions.map((condition) => {
    let fieldValue: string | undefined;

    // Check built-in fields
    if (condition.field === "platform") {
      fieldValue = context.platform;
    } else if (condition.field === "is_subscribed") {
      fieldValue = String(contact.is_subscribed);
    } else if (condition.field.startsWith("tag:")) {
      const tagName = condition.field.replace("tag:", "");
      const hasTags = Array.isArray(contact.contact_tags);
      const hasTag = hasTags && (contact.contact_tags as Array<{ tags: { name: string } | null }>).some(
        (ct) => ct.tags?.name === tagName
      );
      fieldValue = String(hasTag);
    } else if (condition.field.startsWith("variable:")) {
      const varName = condition.field.replace("variable:", "");
      fieldValue = context.variables?.[varName];
    } else {
      // Check custom fields
      const customFields = contact.contact_custom_fields as Array<{
        value: string;
        custom_field_definitions: { slug: string } | null;
      }> | null;
      const field = customFields?.find(
        (f) => f.custom_field_definitions?.slug === condition.field
      );
      fieldValue = field?.value;
    }

    return evaluateCondition(fieldValue, condition.operator, condition.value);
  });

  const passed =
    data.logic === "and" ? results.every(Boolean) : results.some(Boolean);

  return passed ? "handle:true" : "handle:false";
}

function evaluateCondition(
  actual: string | undefined,
  operator: string,
  expected: string
): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual?.includes(expected) || false;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    default:
      return false;
  }
}

async function executeDelay(
  supabase: SupabaseClient<Database>,
  data: DelayNodeData,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext
) {
  const multipliers: Record<string, number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };

  const delayMs = data.duration * (multipliers[data.unit] || 1000);

  // Short pauses (a beat between two messages) run inline. The webhook has
  // already acked by the time flows execute, so waiting here costs nothing,
  // while scheduling a job would hand the resume to the cron — whose floor is
  // one minute, turning a three-second beat into a minute of silence.
  if (delayMs > 0 && delayMs <= INLINE_DELAY_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  const runAt = new Date(Date.now() + delayMs).toISOString();

  // Schedule a job to resume the flow
  await supabase.from("scheduled_jobs").insert({
    type: "resume_flow",
    payload: {
      sessionId,
      nodeId,
      flowId: context.flowId,
      channelId: context.channelId,
      contactId: context.contactId,
      conversationId: context.conversationId,
      workspaceId: context.workspaceId,
      lateConversationId: context.lateConversationId || null,
      lateAccountId: context.lateAccountId || null,
      variables: context.variables || {},
    },
    run_at: runAt,
  });

  // Update session to waiting
  await supabase
    .from("flow_sessions")
    .update({
      waiting_until: runAt,
      current_node_id: nodeId,
    })
    .eq("id", sessionId);

  return "pause";
}

async function executeTag(
  supabase: SupabaseClient<Database>,
  data: TagNodeData,
  context: FlowExecutionContext
) {
  // Find or create tag
  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      { workspace_id: context.workspaceId, name: data.tagName },
      { onConflict: "workspace_id,name" }
    )
    .select("id")
    .single();

  if (!tag) return;

  if (data.action === "add") {
    await supabase
      .from("contact_tags")
      .upsert({ contact_id: context.contactId, tag_id: tag.id })
      .select();
  } else {
    await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", context.contactId)
      .eq("tag_id", tag.id);
  }
}

async function executeSetField(
  supabase: SupabaseClient<Database>,
  data: SetFieldNodeData,
  context: FlowExecutionContext
) {
  if (!data.fieldSlug) return;

  // Find field definition, creating it when the flow references a slug the
  // workspace has not defined yet. Returning early instead made the node a
  // silent no-op: the flow looked right, captured nothing, and said nothing.
  let { data: fieldDef } = await supabase
    .from("custom_field_definitions")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("slug", data.fieldSlug)
    .maybeSingle();

  if (!fieldDef) {
    const { data: created, error: createError } = await supabase
      .from("custom_field_definitions")
      .insert({
        workspace_id: context.workspaceId,
        slug: data.fieldSlug,
        name: data.fieldSlug,
        type: "text",
      })
      .select("id")
      .single();

    if (created) {
      fieldDef = created;
    } else {
      // A concurrent run may have inserted it first (workspace_id+slug is
      // unique); re-read before giving up.
      const { data: existing } = await supabase
        .from("custom_field_definitions")
        .select("id")
        .eq("workspace_id", context.workspaceId)
        .eq("slug", data.fieldSlug)
        .maybeSingle();
      if (!existing) {
        console.error(
          `Could not create custom field "${data.fieldSlug}":`,
          createError
        );
        return;
      }
      fieldDef = existing;
    }
  }

  const value = interpolateVariables(data.value, context.variables || {});

  // Also expose the value as {{slug}} for the rest of the run. Without this a
  // flow can store an answer but never use it again: custom fields are only
  // readable from condition nodes, so "ask name, ask email, POST both" had no
  // way to reach the name it just captured.
  context.variables ??= {};
  context.variables[data.fieldSlug] = value;

  await supabase.from("contact_custom_fields").upsert(
    {
      contact_id: context.contactId,
      field_id: fieldDef.id,
      value,
    },
    { onConflict: "contact_id,field_id" }
  );
}

async function executeHttpRequest(
  data: HttpRequestNodeData,
  context: FlowExecutionContext
) {
  try {
    const url = interpolateVariables(data.url, context.variables || {});
    const body = data.body
      ? interpolateVariables(data.body, context.variables || {})
      : undefined;

    const response = await fetch(url, {
      method: data.method,
      headers: {
        "Content-Type": "application/json",
        ...data.headers,
      },
      body: data.method !== "GET" ? body : undefined,
    });

    const responseData = await response.text();

    // Store response in variable if configured
    if (data.responseVariable && context.variables) {
      try {
        context.variables[data.responseVariable] = JSON.parse(responseData);
      } catch {
        context.variables[data.responseVariable] = responseData;
      }
    }
  } catch (error) {
    console.error("HTTP request failed:", error);
  }
}

/**
 * Sends the contact to ActiveCampaign and subscribes them to a list.
 *
 * Failures are logged rather than thrown, matching every other side-effect
 * node here: a lead who reaches this point has already been messaged, and
 * aborting the run would leave them mid-conversation with no reply. The
 * contact's own email is the key, so a retry updates instead of duplicating.
 */
async function executeActiveCampaign(
  supabase: SupabaseClient<Database>,
  data: ActiveCampaignNodeData,
  context: FlowExecutionContext
) {
  const vars = context.variables || {};
  const fill = (value?: string) =>
    value ? interpolateVariables(value, vars).trim() : "";

  const email = fill(data.email);
  if (!email) {
    console.error(
      "[activeCampaign] no email resolved; check the node's email field and that the flow captured one."
    );
    return;
  }

  try {
    const credentials = await getWorkspaceCredentials(
      supabase,
      context.workspaceId
    );
    if (!credentials) {
      console.error(
        "[activeCampaign] workspace has no ActiveCampaign connection; connect it in Settings."
      );
      return;
    }

    // An empty value would blank a field the contact already had filled, so
    // only send the ones that actually resolved to something.
    const fieldValues = (data.fieldValues ?? [])
      .map((fv) => ({ field: fv.field, value: fill(fv.value) }))
      .filter((fv) => fv.field && fv.value);

    const contactId = await syncContact(credentials, {
      email,
      firstName: fill(data.firstName) || undefined,
      lastName: fill(data.lastName) || undefined,
      phone: fill(data.phone) || undefined,
      ...(fieldValues.length ? { fieldValues } : {}),
    });

    if (data.responseVariable) {
      context.variables = { ...vars, [data.responseVariable]: contactId };
    }

    if (data.listId) {
      // Separate try: the contact is already saved, and losing that because
      // the subscribe failed would be the worse outcome of the two.
      try {
        await addContactToList(credentials, {
          contactId,
          listId: data.listId,
        });
      } catch (error) {
        console.error(
          `[activeCampaign] contact ${contactId} saved but not added to list ${data.listId}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("[activeCampaign] failed to sync contact:", error);
  }
}

async function executeGoToFlow(
  supabase: SupabaseClient<Database>,
  data: GoToFlowNodeData,
  context: FlowExecutionContext,
  _sessionId: string
) {
  // Execute the target flow
  await executeFlow(supabase, {
    ...context,
    flowId: data.flowId,
  });
  // If returnAfter is true, the current flow will continue after the target flow completes
  // For now, we just stop the current traversal
  return "pause";
}

async function executeHumanTakeover(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext,
  sessionId: string
) {
  // Pause automation on the conversation
  await supabase
    .from("conversations")
    .update({ is_automation_paused: true })
    .eq("id", context.conversationId);

  // Mark session
  await supabase
    .from("flow_sessions")
    .update({
      human_takeover_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", sessionId);

  return "pause";
}

async function executeSubscription(
  supabase: SupabaseClient<Database>,
  action: string,
  context: FlowExecutionContext
) {
  await supabase
    .from("contacts")
    .update({ is_subscribed: action === "subscribe" })
    .eq("id", context.contactId);
}

/**
 * Park the session until the contact replies. When the node carries a timeout,
 * also schedule the give-up job so the "no reply" branch can run: without it a
 * contact who walks away is stuck forever with no follow-up.
 */
async function executeSmartDelay(
  supabase: SupabaseClient<Database>,
  data: SmartDelayNodeData,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext
): Promise<string> {
  const multipliers: Record<string, number> = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };
  const timeoutMs = data?.timeout
    ? data.timeout * (multipliers[data.timeoutUnit] || 60 * 1000)
    : 0;
  const waitingUntil =
    timeoutMs > 0 ? new Date(Date.now() + timeoutMs).toISOString() : null;

  await supabase
    .from("flow_sessions")
    .update({
      waiting_for_input: true,
      current_node_id: nodeId,
      waiting_until: waitingUntil,
    })
    .eq("id", sessionId);

  if (waitingUntil) {
    await supabase.from("scheduled_jobs").insert({
      type: "smart_delay_timeout",
      payload: {
        sessionId,
        nodeId,
        flowId: context.flowId,
        channelId: context.channelId,
        contactId: context.contactId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        lateConversationId: context.lateConversationId || null,
        lateAccountId: context.lateAccountId || null,
      },
      run_at: waitingUntil,
    });
  }

  return "pause";
}

/**
 * Run the "contact did not reply" branch of a Smart Delay. Called by the cron
 * once the node's timeout has passed and the contact is still parked on it.
 */
export async function timeoutSmartDelay(
  supabase: SupabaseClient<Database>,
  session: Database["public"]["Tables"]["flow_sessions"]["Row"],
  nodeId: string,
  context: FlowExecutionContext
) {
  // Someone replied in the meantime, or the flow already moved on.
  if (!session.waiting_for_input || session.current_node_id !== nodeId) return;

  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", session.flow_id)
    .single();

  if (!flow) {
    if (flowError && flowError.code !== "PGRST116") {
      throw new FlowLoadError(
        `flow ${session.flow_id} could not be loaded: ${flowError.message}`
      );
    }
    await cancelUnresumableSession(
      supabase,
      session.id,
      `flow ${session.flow_id} no longer exists`
    );
    return;
  }

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  const timeoutEdge = edges.find(
    (e) => e.source === nodeId && e.sourceHandle === "timeout"
  );

  // Nothing wired to the timeout output: the wait was meant to be open-ended,
  // so settle the session instead of leaving it active with no pending job.
  if (!timeoutEdge) {
    await completeSession(supabase, session.id);
    return;
  }

  const nextNode = nodes.find((n) => n.id === timeoutEdge.target);
  if (!nextNode) {
    await completeSession(supabase, session.id);
    return;
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  context.variables = (session.variables as Record<string, string>) || {};

  await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: false, waiting_until: null })
    .eq("id", session.id);

  await traverseNodes(supabase, session.id, nextNode, nodes, edges, context, 0);
}

function executeABSplit(data: ABSplitNodeData): string {
  const totalWeight = data.paths.reduce((sum, p) => sum + p.weight, 0);
  const random = Math.random() * totalWeight;

  // The builder gives each split output the handle id "split-<index>", so the
  // engine has to answer with the same id, not the path's display name.
  let cumulative = 0;
  for (let i = 0; i < data.paths.length; i++) {
    cumulative += data.paths[i].weight;
    if (random <= cumulative) {
      return `handle:split-${i}`;
    }
  }

  return `handle:split-0`;
}

/**
 * Post a public reply to the comment that triggered this flow.
 * Uses the comment_id and post_id variables set by the comment processor.
 */
async function executeCommentReply(
  supabase: SupabaseClient<Database>,
  data: CommentReplyNodeData,
  context: FlowExecutionContext
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const messaging = createMessagingProvider(workspace.late_api_key_encrypted);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for commentReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {});

  try {
    await messaging.replyToComment({
      accountId: lateAccountId,
      postId,
      commentId,
      text,
    });
  } catch (error) {
    console.error("Failed to post comment reply:", error);
  }
}

/**
 * Send a private DM to the commenter via the Zernio API's private reply endpoint.
 * This creates a DM conversation from a comment context.
 */
async function executePrivateReply(
  supabase: SupabaseClient<Database>,
  data: PrivateReplyNodeData,
  context: FlowExecutionContext
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted")
    .eq("id", context.workspaceId)
    .single();

  if (!workspace?.late_api_key_encrypted) return;

  const messaging = createMessagingProvider(workspace.late_api_key_encrypted);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for privateReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {});

  try {
    await messaging.sendPrivateReply({
      accountId: lateAccountId,
      postId,
      commentId,
      text,
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      attachments: data.imageUrl
        ? [{ type: "image", url: data.imageUrl }]
        : null,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });
  } catch (error) {
    console.error("Failed to send private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
  }
}

async function completeSession(
  supabase: SupabaseClient<Database>,
  sessionId: string
) {
  // Only an active session can complete: a concurrent cancel (e.g. the cron's
  // stranded-session settle) must not be overwritten to completed. Zero rows
  // matched also skips the flow_completed analytics event below.
  const { data: session } = await supabase
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active")
    .select("flow_id, contact_id, channel_id")
    .single();

  if (session) {
    const { data: flow } = await supabase
      .from("flows")
      .select("workspace_id")
      .eq("id", session.flow_id)
      .single();

    if (flow) {
      await supabase.from("analytics_events").insert({
        workspace_id: flow.workspace_id,
        flow_id: session.flow_id,
        contact_id: session.contact_id,
        event_type: "flow_completed",
      });
    }
  }
}

async function executeEnrollSequence(
  supabase: SupabaseClient<Database>,
  data: EnrollSequenceNodeData,
  context: FlowExecutionContext
) {
  if (!data.sequenceId) {
    console.error("enrollSequence node missing sequenceId");
    return;
  }

  // Verify sequence exists and is active
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", data.sequenceId)
    .single();

  if (!sequence || sequence.status !== "active") {
    console.error("Sequence not found or not active:", data.sequenceId);
    return;
  }

  const steps = (sequence.steps as Array<{ type: string; delayMinutes?: number }>) || [];
  if (steps.length === 0) return;

  // Calculate next_step_at based on first step
  let nextStepAt: string;
  const firstStep = steps[0];
  if (firstStep.type === "delay" && firstStep.delayMinutes) {
    nextStepAt = new Date(
      Date.now() + firstStep.delayMinutes * 60 * 1000
    ).toISOString();
  } else {
    nextStepAt = new Date().toISOString();
  }

  // Create enrollment (ignore duplicate errors)
  const { error } = await supabase
    .from("sequence_enrollments")
    .insert({
      sequence_id: data.sequenceId,
      contact_id: context.contactId,
      channel_id: context.channelId,
      next_step_at: nextStepAt,
    });

  if (error && error.code !== "23505") {
    console.error("Failed to enroll contact in sequence:", error);
  }
}

function resolveVariablePath(
  variables: Record<string, unknown>,
  path: string
): unknown {
  let value: unknown = variables;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function interpolateVariables(
  text: string,
  variables: Record<string, unknown>
): string {
  // Supports dot paths ({{myvar.data.name}}) into object variables (e.g. parsed
  // httpRequest JSON responses). Unresolved paths leave the token literal.
  let blankedOne = false;
  const replaced = text.replace(
    /\{\{(\w+(?:\.\w+)*)\}\}/g,
    (token, path: string) => {
      const value = resolveVariablePath(variables, path);
      if (value === null || value === undefined) return token;
      const asText =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      if (asText === "") blankedOne = true;
      return asText;
    }
  );

  // A variable that resolved to nothing leaves "Opa , vamos" or a double
  // space behind. Tidy only in that case, so ordinary copy is never touched.
  if (!blankedOne) return replaced;
  return replaced
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
