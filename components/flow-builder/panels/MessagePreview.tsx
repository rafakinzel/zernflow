"use client";

import { Fragment, useMemo } from "react";
import { Clock, ImageIcon, Music, Video } from "lucide-react";

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

export interface PreviewMessage {
  delaySeconds?: number;
  text?: string;
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio";
  quickReplies?: QuickReply[];
  buttons?: Button[];
  carousel?: { elements: CarouselElement[] };
}

/**
 * Splits text on {{variable}} so the preview can mark the placeholders.
 * A variable is left visible rather than filled with sample data: the point
 * is to show WHERE personalization lands, and a fake "Maria" would read as a
 * real word and hide the fact that the slot might arrive empty.
 */
function segments(text: string): Array<{ text: string; variable: boolean }> {
  const parts: Array<{ text: string; variable: boolean }> = [];
  const pattern = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), variable: false });
    }
    parts.push({ text: match[1].trim(), variable: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), variable: false });

  return parts;
}

function BubbleText({ text }: { text: string }) {
  const parts = useMemo(() => segments(text), [text]);

  return (
    <>
      {parts.map((part, i) =>
        part.variable ? (
          <span
            key={i}
            className="rounded bg-emerald-500/15 px-1 py-px font-medium text-emerald-600 dark:text-emerald-400"
          >
            {part.text}
          </span>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </>
  );
}

const mediaIcon = { image: ImageIcon, video: Video, audio: Music };

function MediaStub({ type, url }: { type: "image" | "video" | "audio"; url: string }) {
  const Icon = mediaIcon[type];

  if (type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="mb-1.5 max-h-40 w-full rounded-xl object-cover"
      />
    );
  }

  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{type === "video" ? "Video" : "Audio"}</span>
    </div>
  );
}

/**
 * Renders one node's messages the way the contact receives them.
 *
 * Deliberately not a phone mockup: this lives in a narrow sidebar, and a
 * drawn handset would spend most of the width on bezel. What matters is the
 * shape of the thread, so it is a plain conversation strip.
 */
export function MessagePreview({ messages }: { messages: PreviewMessage[] }) {
  const filled = messages.filter(
    (m) =>
      m.text?.trim() ||
      m.mediaUrl ||
      m.imageUrl ||
      m.buttons?.length ||
      m.quickReplies?.length ||
      m.carousel?.elements?.length
  );

  if (filled.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
        Write a message to see how it arrives.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
      {filled.map((message, i) => {
        const mediaUrl = message.mediaUrl || message.imageUrl;
        const mediaType =
          message.mediaType || (message.imageUrl ? "image" : undefined);
        const buttons = message.buttons?.filter((b) => b.title.trim()) ?? [];
        const quickReplies =
          message.quickReplies?.filter((q) => q.title.trim()) ?? [];
        const cards = message.carousel?.elements ?? [];

        const pause = message.delaySeconds;

        return (
          <div key={i} className="space-y-1.5">
            {/* The pause is part of how the thread arrives, so the preview
                shows the beat rather than collapsing the bubbles together. */}
            {typeof pause === "number" && pause > 0 && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {pause}s
              </p>
            )}
            <div className="max-w-[88%] space-y-1.5">
            {(message.text?.trim() || mediaUrl) && (
              <div className="rounded-2xl rounded-bl-md bg-card px-3 py-2 text-[13px] leading-snug text-foreground shadow-sm">
                {mediaUrl && mediaType && (
                  <MediaStub type={mediaType} url={mediaUrl} />
                )}
                {message.text?.trim() && (
                  <p className="whitespace-pre-wrap break-words">
                    <BubbleText text={message.text} />
                  </p>
                )}
              </div>
            )}

            {cards.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {cards.map((card, c) => (
                  <div
                    key={c}
                    className="w-36 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    {card.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.imageUrl}
                        alt=""
                        className="h-20 w-full object-cover"
                      />
                    )}
                    <div className="p-2">
                      <p className="truncate text-[12px] font-medium text-foreground">
                        {card.title || "Untitled"}
                      </p>
                      {card.subtitle && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {card.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {buttons.length > 0 && (
              <div className="space-y-1">
                {buttons.map((button, b) => (
                  <div
                    key={b}
                    className="rounded-xl border border-border bg-card px-3 py-2 text-center text-[13px] font-medium text-sky-600 dark:text-sky-400"
                  >
                    {button.title}
                  </div>
                ))}
              </div>
            )}

            {quickReplies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {quickReplies.map((reply, q) => (
                  <span
                    key={q}
                    className="rounded-full border border-sky-500/50 px-2.5 py-1 text-[12px] text-sky-600 dark:text-sky-400"
                  >
                    {reply.title}
                  </span>
                ))}
              </div>
            )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
