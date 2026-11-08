import { describe, it, expect } from "vitest";
import { privateReplyOptions } from "./private-reply-options";

describe("privateReplyOptions", () => {
  it("keeps the canvas button on the comment's private reply", () => {
    // The #rd and #fa openers: one button that used to be dropped.
    expect(
      privateReplyOptions({ buttons: [{ type: "postback", title: "SIM, manda!", payload: "SIM_MANDA" }] })
    ).toEqual({ buttons: [{ type: "postback", title: "SIM, manda!", payload: "SIM_MANDA" }] });
  });

  it("sends up to three quick replies as buttons, so non-followers see them", () => {
    expect(
      privateReplyOptions({
        quickReplies: [
          { title: "Sim", payload: "A" },
          { title: "Não", payload: "B" },
        ],
      })
    ).toEqual({
      buttons: [
        { type: "postback", title: "Sim", payload: "A" },
        { type: "postback", title: "Não", payload: "B" },
      ],
    });
  });

  it("keeps link buttons as links", () => {
    expect(
      privateReplyOptions({ buttons: [{ type: "url", title: "Ver a página", url: "https://x.com" }] })
    ).toEqual({ buttons: [{ type: "url", title: "Ver a página", url: "https://x.com" }] });
  });

  it("uses quick replies past three, since a button bubble holds only three", () => {
    const quickReplies = ["1", "2", "3", "4"].map((n) => ({ title: n, payload: n }));
    expect(privateReplyOptions({ quickReplies })).toEqual({ quickReplies });
  });

  it("trims titles to Meta's 20 characters and skips options with nothing to send", () => {
    expect(
      privateReplyOptions({
        buttons: [
          { type: "postback", title: "Um título comprido demais aqui", payload: "P" },
          { type: "postback", title: "  ", payload: "X" },
          { type: "url", title: "Sem link" },
        ],
      })
    ).toEqual({ buttons: [{ type: "postback", title: "Um título comprido d", payload: "P" }] });
  });

  it("sends plain text when there is nothing to tap", () => {
    expect(privateReplyOptions({})).toEqual({});
  });
});
