import type { PrivateReplyButton } from "@/lib/messaging/provider";

/**
 * The buttons a comment's private reply carries.
 *
 * The first message of a comment flow goes out as Instagram's private reply,
 * and it used to go out as bare text: the "SIM, manda!" drawn on the canvas
 * never reached the person, who had to guess what to type, and a reply the
 * matcher did not read as a yes went to a human (07/11 and 08/11/2026).
 * Zernio accepts up to 3 buttons on a private reply, or quick replies.
 *
 * Buttons are preferred. A commenter who does not follow the account gets the
 * DM in Message Requests, where quick replies are not shown at all, so up to
 * three quick replies are sent as postback buttons carrying the same payload:
 * the engine reads a postback and a quick reply the same way.
 */

const MAX_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;
const MAX_TITLE = 20;

interface Option {
  title?: string;
  type?: string;
  payload?: string;
  url?: string;
}

export function privateReplyOptions(message: {
  buttons?: Option[];
  quickReplies?: Option[];
}): {
  buttons?: PrivateReplyButton[];
  quickReplies?: Array<{ title: string; payload: string }>;
} {
  const title = (t?: string) => (t ?? "").trim().slice(0, MAX_TITLE);

  const fromButtons: PrivateReplyButton[] = [];
  for (const b of message.buttons ?? []) {
    if (!title(b.title)) continue;
    if (b.type === "url" && b.url) fromButtons.push({ type: "url", title: title(b.title), url: b.url });
    else if (b.payload) fromButtons.push({ type: "postback", title: title(b.title), payload: b.payload });
  }
  if (fromButtons.length > 0 && fromButtons.length <= MAX_BUTTONS) return { buttons: fromButtons };

  const quick = (message.quickReplies ?? [])
    .filter((q) => q.payload && title(q.title))
    .map((q) => ({ title: title(q.title), payload: q.payload! }));
  if (quick.length > 0 && quick.length <= MAX_BUTTONS) {
    return { buttons: quick.map((q) => ({ type: "postback" as const, ...q })) };
  }
  if (quick.length > 0) return { quickReplies: quick.slice(0, MAX_QUICK_REPLIES) };

  // More than three buttons cannot go on one private reply; send the text
  // rather than a cut-down choice the flow did not draw.
  return {};
}
