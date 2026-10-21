"use client";

import { useCallback, useRef } from "react";
import { Plus, X, GripVertical, Image, Type, MousePointer, MessageCircle, LayoutGrid, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

import { MessagePreview } from "./MessagePreview";
import { ActiveCampaignPanel } from "./ActiveCampaignPanel";

interface QuickReply {
  title: string;
  payload: string;
}

interface Button {
  title: string;
  type: "postback" | "url";
  payload?: string;
  url?: string;
}

interface CarouselElement {
  imageUrl?: string;
  title: string;
  subtitle?: string;
  buttons?: Button[];
}

interface Carousel {
  elements: CarouselElement[];
}

interface Message {
  text?: string;
  imageUrl?: string;
  // Media attachment. mediaType + mediaUrl supersede the legacy image-only imageUrl
  // and let a message send an image, video, or audio file.
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio";
  quickReplies?: QuickReply[];
  buttons?: Button[];
  carousel?: Carousel;
  /** Seconds to wait before this bubble goes out. */
  delaySeconds?: number;
}

type PostActionType =
  | "setCustomField"
  | "addTag"
  | "removeTag"
  | "activeCampaign";

interface PostAction {
  actionType: PostActionType;
  [key: string]: unknown;
}

interface SendMessagePanelData {
  messages?: Message[];
  postActions?: PostAction[];
  waitForReply?: boolean;
  timeout?: number;
  timeoutUnit?: string;
  isFunnelStep?: boolean;
  funnelLabel?: string;
  [key: string]: unknown;
}

/** Longest pause the engine will honour inside one bubble. */
const MAX_PAUSE_SECONDS = 30;

/**
 * Meta accepts a free-form message for 24 hours after the person's last
 * action, so a wait set to 24 fires its no-reply branch exactly on the
 * boundary and the message is refused. Twenty leaves room for the queue.
 */
const SAFE_WAIT_HOURS = 20;

const POST_ACTION_LABELS: Record<PostActionType, string> = {
  setCustomField: "Save a field",
  addTag: "Add a tag",
  removeTag: "Remove a tag",
  activeCampaign: "ActiveCampaign",
};

interface SendMessagePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  availableVariables?: string[];
}

function VariablePicker({
  variables,
  onInsert,
}: {
  variables: string[];
  onInsert: (variable: string) => void;
}) {
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-muted-foreground/60">
        Click to insert a variable. Dot paths like {"{{myvar.data.name}}"} read
        fields from JSON responses.
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => onInsert(variable)}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-500 hover:bg-blue-50"
          >
            {`{{${variable}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SendMessagePanel({ data: rawData, onChange, availableVariables }: SendMessagePanelProps) {
  const data = rawData as SendMessagePanelData;
  const messages = data.messages || [];

  const updateMessage = useCallback(
    (index: number, updated: Message) => {
      const msgs = [...messages];
      msgs[index] = updated;
      onChange({ ...data, messages: msgs });
    },
    [data, messages, onChange]
  );

  const addMessage = useCallback(() => {
    onChange({ ...data, messages: [...messages, { text: "" }] });
  }, [data, messages, onChange]);

  const removeMessage = useCallback(
    (index: number) => {
      onChange({ ...data, messages: messages.filter((_, i) => i !== index) });
    },
    [data, messages, onChange]
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          How it arrives
        </p>
        <MessagePreview messages={messages} />
      </div>

      <WaitControl
        waitForReply={Boolean(data.waitForReply)}
        timeout={data.timeout}
        timeoutUnit={data.timeoutUnit}
        onChange={(next) => onChange({ ...data, ...next })}
      />

      {messages.map((message, msgIndex) => (
        <div key={msgIndex} className="space-y-2">
          <PauseControl
            seconds={message.delaySeconds}
            onChange={(seconds) =>
              updateMessage(msgIndex, { ...message, delaySeconds: seconds })
            }
          />
          <MessageEditor
            index={msgIndex}
            message={message}
            onChange={(updated) => updateMessage(msgIndex, updated)}
            onRemove={() => removeMessage(msgIndex)}
            canRemove={messages.length > 1}
            availableVariables={availableVariables}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addMessage}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-blue-400 hover:text-blue-500"
      >
        <Plus className="h-4 w-4" />
        Add Message
      </button>

      {messages.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Add at least one message to send.
        </p>
      )}

      <FunnelStepControl
        marked={Boolean(data.isFunnelStep)}
        label={data.funnelLabel}
        onChange={(next) => onChange({ ...data, ...next })}
      />

      <PostActionsEditor
        actions={data.postActions ?? []}
        onChange={(postActions) => onChange({ ...data, postActions })}
      />

      {/* Platform hints */}
      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="text-xs font-medium text-muted-foreground">Platform notes</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
          <li>Facebook/Instagram/WhatsApp: Max 3 buttons per message</li>
          <li>Telegram: Buttons appear as inline keyboards</li>
          <li>Quick replies disappear after user responds</li>
          <li>Carousels: Native on Facebook/Instagram, text fallback elsewhere</li>
          <li>
            WhatsApp: Meta only accepts free-form messages within 24h of the
            contact&apos;s last message
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * The pause before one bubble, shown as a divider between them.
 *
 * It sits here rather than on a node of its own because pacing a sequence
 * used to mean a Delay node between every message, which turned a four-part
 * explanation into seven cards on the canvas. Longer waits still belong in a
 * Delay node: this one runs inside the request, so the field caps itself.
 */
function PauseControl({
  seconds,
  onChange,
}: {
  seconds?: number;
  onChange: (seconds: number | undefined) => void;
}) {
  const active = typeof seconds === "number" && seconds > 0;

  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-border" />
      {active ? (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <input
            type="number"
            min={0}
            max={MAX_PAUSE_SECONDS}
            value={seconds}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next) || next <= 0) return onChange(undefined);
              onChange(Math.min(next, MAX_PAUSE_SECONDS));
            }}
            className="w-10 bg-transparent text-right tabular-nums outline-none"
          />
          <span>s pause</span>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-0.5 text-muted-foreground hover:text-red-500"
            title="Remove pause"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onChange(3)}
          className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-blue-400 hover:text-blue-500"
        >
          <Clock className="h-3 w-3" />
          Add pause
        </button>
      )}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Side effects this node runs once its messages are out.
 *
 * Saving a field or applying a tag used to cost a card of its own, so a flow
 * that tracked where people dropped off drew twice as wide as the
 * conversation it described. Only side effects belong here: anything that
 * branches or waits stays a node, so control flow is never hidden inside a
 * card that looks like a single step.
 */
function PostActionsEditor({
  actions,
  onChange,
}: {
  actions: PostAction[];
  onChange: (actions: PostAction[]) => void;
}) {
  const update = useCallback(
    (index: number, next: PostAction) => {
      onChange(actions.map((a, i) => (i === index ? next : a)));
    },
    [actions, onChange]
  );

  const remove = useCallback(
    (index: number) => onChange(actions.filter((_, i) => i !== index)),
    [actions, onChange]
  );

  const add = useCallback(
    (actionType: PostActionType) => {
      const blank: PostAction =
        actionType === "setCustomField"
          ? { actionType, fieldSlug: "", value: "" }
          : actionType === "activeCampaign"
            ? { actionType, email: "{{email}}" }
            : { actionType, action: actionType === "addTag" ? "add" : "remove", tagName: "" };
      onChange([...actions, blank]);
    },
    [actions, onChange]
  );

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium">Then also</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Runs after the messages are sent, without adding a step to the canvas.
      </p>

      {actions.length > 0 && (
        <div className="mt-3 space-y-2">
          {actions.map((action, index) => (
            <div
              key={index}
              className="rounded-lg border border-border bg-muted/40 p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">
                  {POST_ACTION_LABELS[action.actionType]}
                </span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-muted-foreground hover:text-red-500"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {action.actionType === "setCustomField" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    value={String(action.fieldSlug ?? "")}
                    onChange={(e) =>
                      update(index, { ...action, fieldSlug: e.target.value })
                    }
                    placeholder="field name"
                    className="rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                  />
                  <input
                    value={String(action.value ?? "")}
                    onChange={(e) =>
                      update(index, { ...action, value: e.target.value })
                    }
                    placeholder="value or {{variable}}"
                    className="rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                  />
                </div>
              )}

              {(action.actionType === "addTag" ||
                action.actionType === "removeTag") && (
                <input
                  value={String(action.tagName ?? "")}
                  onChange={(e) =>
                    update(index, { ...action, tagName: e.target.value })
                  }
                  placeholder="tag name"
                  className="mt-2 w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                />
              )}

              {action.actionType === "activeCampaign" && (
                <div className="mt-2">
                  <ActiveCampaignPanel
                    data={action as Record<string, unknown>}
                    onChange={(next) =>
                      update(index, {
                        ...(next as PostAction),
                        actionType: "activeCampaign",
                      })
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(Object.keys(POST_ACTION_LABELS) as PostActionType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => add(type)}
            className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-blue-400 hover:text-blue-500"
          >
            <Plus className="h-3 w-3" />
            {POST_ACTION_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageEditor({
  index,
  message,
  onChange,
  onRemove,
  canRemove,
  availableVariables,
}: {
  index: number;
  message: Message;
  onChange: (m: Message) => void;
  onRemove: () => void;
  canRemove: boolean;
  availableVariables?: string[];
}) {
  const isCarouselMode = !!message.carousel;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertVariable = useCallback(
    (variable: string) => {
      const token = `{{${variable}}}`;
      const textarea = textareaRef.current;
      const text = message.text || "";
      const caret = textarea?.selectionStart ?? text.length;
      onChange({
        ...message,
        text: text.slice(0, caret) + token + text.slice(caret),
      });
      // Restore focus and place the caret after the inserted token
      requestAnimationFrame(() => {
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(caret + token.length, caret + token.length);
      });
    },
    [message, onChange]
  );

  const toggleMode = useCallback(() => {
    if (isCarouselMode) {
      // Switch to text mode: remove carousel
      const { carousel: _, ...rest } = message;
      onChange({ ...rest, text: rest.text || "" });
    } else {
      // Switch to carousel mode: remove text-mode fields, add empty carousel
      onChange({
        carousel: {
          elements: [{ title: "", subtitle: "", imageUrl: "" }],
        },
      });
    }
  }, [isCarouselMode, message, onChange]);

  // Quick replies
  const addQuickReply = useCallback(() => {
    const replies = message.quickReplies || [];
    onChange({ ...message, quickReplies: [...replies, { title: "", payload: "" }] });
  }, [message, onChange]);

  const updateQuickReply = useCallback(
    (i: number, updated: QuickReply) => {
      const replies = [...(message.quickReplies || [])];
      replies[i] = updated;
      onChange({ ...message, quickReplies: replies });
    },
    [message, onChange]
  );

  const removeQuickReply = useCallback(
    (i: number) => {
      const replies = (message.quickReplies || []).filter((_, idx) => idx !== i);
      onChange({ ...message, quickReplies: replies.length > 0 ? replies : undefined });
    },
    [message, onChange]
  );

  // Buttons
  const addButton = useCallback(() => {
    const buttons = message.buttons || [];
    onChange({ ...message, buttons: [...buttons, { title: "", type: "postback", payload: "" }] });
  }, [message, onChange]);

  const updateButton = useCallback(
    (i: number, updated: Button) => {
      const buttons = [...(message.buttons || [])];
      buttons[i] = updated;
      onChange({ ...message, buttons });
    },
    [message, onChange]
  );

  const removeButton = useCallback(
    (i: number) => {
      const buttons = (message.buttons || []).filter((_, idx) => idx !== i);
      onChange({ ...message, buttons: buttons.length > 0 ? buttons : undefined });
    },
    [message, onChange]
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Message header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-semibold text-muted-foreground">
            Message {index + 1}
          </span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => isCarouselMode && toggleMode()}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
            !isCarouselMode
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          <Type className="h-3 w-3" />
          Text
        </button>
        <button
          type="button"
          onClick={() => !isCarouselMode && toggleMode()}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors",
            isCarouselMode
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
        >
          <LayoutGrid className="h-3 w-3" />
          Carousel
        </button>
      </div>

      <div className="space-y-4 p-3">
        {isCarouselMode ? (
          <CarouselEditor
            carousel={message.carousel!}
            onChange={(carousel) => onChange({ ...message, carousel })}
          />
        ) : (
          <>
            {/* Text */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Type className="h-3 w-3 text-muted-foreground/60" />
                <label className="text-xs font-medium text-muted-foreground">Text</label>
              </div>
              <textarea
                ref={textareaRef}
                value={message.text || ""}
                onChange={(e) => onChange({ ...message, text: e.target.value })}
                placeholder="Type your message... Insert variables below"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {availableVariables && availableVariables.length > 0 ? (
                <VariablePicker
                  variables={availableVariables}
                  onInsert={insertVariable}
                />
              ) : (
                <p className="text-[11px] text-muted-foreground/60">
                  Use {"{{variable}}"} for dynamic content
                </p>
              )}
            </div>

            {/* Media (image / video / audio) */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Image className="h-3 w-3 text-muted-foreground/60" />
                <label className="text-xs font-medium text-muted-foreground">Media URL</label>
              </div>
              <div className="flex gap-2">
                <select
                  value={message.mediaType || "image"}
                  onChange={(e) =>
                    onChange({
                      ...message,
                      mediaType: e.target.value as "image" | "video" | "audio",
                    })
                  }
                  className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                </select>
                <input
                  type="url"
                  value={message.mediaUrl ?? message.imageUrl ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...message,
                      mediaUrl: e.target.value || undefined,
                      mediaType: message.mediaType || "image",
                      // Clear the legacy image-only field so the two don't diverge.
                      imageUrl: undefined,
                    })
                  }
                  placeholder="https://example.com/file.mp4"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Sends an image, video, or audio file with this message.
              </p>
            </div>

            {/* Quick Replies */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="h-3 w-3 text-muted-foreground/60" />
                  <label className="text-xs font-medium text-muted-foreground">
                    Quick Replies
                  </label>
                </div>
                <button
                  type="button"
                  onClick={addQuickReply}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
              {(message.quickReplies || []).map((qr, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={qr.title}
                    onChange={(e) => updateQuickReply(i, { ...qr, title: e.target.value })}
                    placeholder="Label"
                    className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={qr.payload}
                    onChange={(e) => updateQuickReply(i, { ...qr, payload: e.target.value })}
                    placeholder="Payload"
                    className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeQuickReply(i)}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Buttons */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MousePointer className="h-3 w-3 text-muted-foreground/60" />
                  <label className="text-xs font-medium text-muted-foreground">
                    Buttons
                  </label>
                </div>
                <button
                  type="button"
                  onClick={addButton}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
              {(message.buttons || []).map((btn, i) => (
                <div
                  key={i}
                  className="mb-2 rounded-lg border border-border bg-muted p-2.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={btn.title}
                      onChange={(e) => updateButton(i, { ...btn, title: e.target.value })}
                      placeholder="Button label"
                      className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeButton(i)}
                      className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={btn.type}
                      onChange={(e) => {
                        const type = e.target.value as "postback" | "url";
                        updateButton(i, {
                          ...btn,
                          type,
                          payload: type === "postback" ? btn.payload || "" : undefined,
                          url: type === "url" ? btn.url || "" : undefined,
                        });
                      }}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="postback">Postback</option>
                      <option value="url">URL</option>
                    </select>
                    {btn.type === "postback" ? (
                      <input
                        type="text"
                        value={btn.payload || ""}
                        onChange={(e) => updateButton(i, { ...btn, payload: e.target.value })}
                        placeholder="Payload value"
                        className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type="url"
                        value={btn.url || ""}
                        onChange={(e) => updateButton(i, { ...btn, url: e.target.value })}
                        placeholder="https://..."
                        className="flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CarouselEditor({
  carousel,
  onChange,
}: {
  carousel: Carousel;
  onChange: (c: Carousel) => void;
}) {
  const elements = carousel.elements || [];

  const addCard = useCallback(() => {
    onChange({
      elements: [...elements, { title: "", subtitle: "", imageUrl: "" }],
    });
  }, [elements, onChange]);

  const updateCard = useCallback(
    (i: number, updated: CarouselElement) => {
      const els = [...elements];
      els[i] = updated;
      onChange({ elements: els });
    },
    [elements, onChange]
  );

  const removeCard = useCallback(
    (i: number) => {
      onChange({ elements: elements.filter((_, idx) => idx !== i) });
    },
    [elements, onChange]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="h-3 w-3 text-muted-foreground/60" />
          <label className="text-xs font-medium text-muted-foreground">
            Cards ({elements.length})
          </label>
        </div>
        <button
          type="button"
          onClick={addCard}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-500 hover:bg-blue-50"
        >
          <Plus className="h-3 w-3" />
          Add Card
        </button>
      </div>

      {elements.map((el, i) => (
        <CarouselCardEditor
          key={i}
          index={i}
          element={el}
          onChange={(updated) => updateCard(i, updated)}
          onRemove={() => removeCard(i)}
          canRemove={elements.length > 1}
        />
      ))}

      {elements.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Add at least one card to the carousel.
        </p>
      )}
    </div>
  );
}

function CarouselCardEditor({
  index,
  element,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  element: CarouselElement;
  onChange: (el: CarouselElement) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const buttons = element.buttons || [];

  const addButton = useCallback(() => {
    if (buttons.length >= 3) return;
    onChange({
      ...element,
      buttons: [...buttons, { title: "", type: "postback", payload: "" }],
    });
  }, [element, buttons, onChange]);

  const updateButton = useCallback(
    (i: number, updated: Button) => {
      const btns = [...buttons];
      btns[i] = updated;
      onChange({ ...element, buttons: btns });
    },
    [element, buttons, onChange]
  );

  const removeButton = useCallback(
    (i: number) => {
      const btns = buttons.filter((_, idx) => idx !== i);
      onChange({ ...element, buttons: btns.length > 0 ? btns : undefined });
    },
    [element, buttons, onChange]
  );

  return (
    <div className="rounded-lg border border-border bg-muted p-2.5">
      {/* Card header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Card {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* Image URL */}
        <div>
          <div className="mb-1 flex items-center gap-1">
            <Image className="h-2.5 w-2.5 text-muted-foreground/60" />
            <label className="text-[11px] font-medium text-muted-foreground">Image URL</label>
          </div>
          <input
            type="url"
            value={element.imageUrl || ""}
            onChange={(e) =>
              onChange({ ...element, imageUrl: e.target.value || undefined })
            }
            placeholder="https://example.com/image.png"
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Title */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Title
          </label>
          <input
            type="text"
            value={element.title}
            onChange={(e) => onChange({ ...element, title: e.target.value })}
            placeholder="Card title (max 80 chars)"
            maxLength={80}
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Subtitle */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Subtitle
          </label>
          <input
            type="text"
            value={element.subtitle || ""}
            onChange={(e) =>
              onChange({ ...element, subtitle: e.target.value || undefined })
            }
            placeholder="Card subtitle"
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Buttons */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <MousePointer className="h-2.5 w-2.5 text-muted-foreground/60" />
              <label className="text-[11px] font-medium text-muted-foreground">
                Buttons ({buttons.length}/3)
              </label>
            </div>
            {buttons.length < 3 && (
              <button
                type="button"
                onClick={addButton}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-blue-500 hover:bg-blue-50"
              >
                <Plus className="h-2.5 w-2.5" />
                Add
              </button>
            )}
          </div>
          {buttons.map((btn, i) => (
            <div
              key={i}
              className="mb-1.5 rounded border border-border bg-card p-2"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={btn.title}
                  onChange={(e) =>
                    updateButton(i, { ...btn, title: e.target.value })
                  }
                  placeholder="Button label"
                  className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeButton(i)}
                  className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={btn.type}
                  onChange={(e) => {
                    const type = e.target.value as "postback" | "url";
                    updateButton(i, {
                      ...btn,
                      type,
                      payload:
                        type === "postback" ? btn.payload || "" : undefined,
                      url: type === "url" ? btn.url || "" : undefined,
                    });
                  }}
                  className="rounded border border-border bg-card px-1.5 py-1 text-[11px] text-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="postback">Postback</option>
                  <option value="url">URL</option>
                </select>
                {btn.type === "postback" ? (
                  <input
                    type="text"
                    value={btn.payload || ""}
                    onChange={(e) =>
                      updateButton(i, { ...btn, payload: e.target.value })
                    }
                    placeholder="Payload value"
                    className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <input
                    type="url"
                    value={btn.url || ""}
                    onChange={(e) =>
                      updateButton(i, { ...btn, url: e.target.value })
                    }
                    placeholder="https://..."
                    className="flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Whether this step waits for an answer, and for how long.
 *
 * It lives on the message because the buttons do: the wait is what gives
 * each of them an exit. Turning it off leaves the step with one way out,
 * the way any message without a question has.
 */
function WaitControl({
  waitForReply,
  timeout,
  timeoutUnit,
  onChange,
}: {
  waitForReply: boolean;
  timeout?: number;
  timeoutUnit?: string;
  onChange: (next: {
    waitForReply: boolean;
    timeout?: number;
    timeoutUnit?: string;
  }) => void;
}) {
  const unit = timeoutUnit || "hours";
  const overWindow = unit === "hours" && (timeout ?? 0) > SAFE_WAIT_HOURS;

  return (
    <div className="rounded-lg border border-border p-3">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={waitForReply}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { waitForReply: true, timeout: timeout ?? SAFE_WAIT_HOURS, timeoutUnit: unit }
                : { waitForReply: false, timeout: undefined, timeoutUnit: undefined }
            )
          }
          className="mt-0.5 h-3.5 w-3.5 accent-primary"
        />
        <span>
          <span className="block text-xs font-medium">Wait for an answer</span>
          <span className="block text-[11px] text-muted-foreground">
            Each button gets its own exit, and a separate one for anything
            else they might type.
          </span>
        </span>
      </label>

      {waitForReply && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            Give up after
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={timeout ?? ""}
              onChange={(e) =>
                onChange({
                  waitForReply: true,
                  timeout: e.target.value ? Number(e.target.value) : undefined,
                  timeoutUnit: unit,
                })
              }
              className="h-8 w-20 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/25"
            />
            <select
              value={unit}
              onChange={(e) =>
                onChange({ waitForReply: true, timeout, timeoutUnit: e.target.value })
              }
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>

          {overWindow ? (
            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-500">
              Instagram stops accepting messages {SAFE_WAIT_HOURS + 4} hours
              after the person last wrote, so a &quot;no reply&quot; message sent
              at {timeout}h is likely to be refused. {SAFE_WAIT_HOURS} is the
              longest that still arrives.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Nothing wired to &quot;No reply&quot; means the conversation simply
              ends when the time runs out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Marks this message as a step worth counting in the flow's funnel.
 *
 * Which moments matter is a question about the business, so the flow
 * answers it rather than the report guessing. Marking a handful is the
 * point: a funnel with a row per node is a list of nodes, not a funnel.
 */
function FunnelStepControl({
  marked,
  label,
  onChange,
}: {
  marked: boolean;
  label?: string;
  onChange: (next: { isFunnelStep: boolean; funnelLabel?: string }) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={marked}
          onChange={(e) =>
            onChange({ isFunnelStep: e.target.checked, funnelLabel: label })
          }
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          <span className="text-sm font-medium">Count as a funnel step</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Analytics shows how many people reached this message, and how many
            stopped before it.
          </span>
        </span>
      </label>

      {marked && (
        <div className="mt-3">
          <label
            htmlFor="funnel-label"
            className="mb-1 block text-xs text-muted-foreground"
          >
            Name for the report
          </label>
          <input
            id="funnel-label"
            type="text"
            value={label ?? ""}
            onChange={(e) =>
              onChange({ isFunnelStep: true, funnelLabel: e.target.value })
            }
            placeholder="Saw the offer"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Left empty, the report uses the first words of the message.
          </p>
        </div>
      )}
    </div>
  );
}
