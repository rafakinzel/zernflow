import { describe, it, expect } from "vitest";
import {
  messageDelayMs,
  readPostActions,
  hasStatefulPostAction,
  DEFAULT_MESSAGE_GAP_MS,
  MAX_MESSAGE_DELAY_MS,
} from "./pacing";

const BUDGET = 60_000;

describe("messageDelayMs", () => {
  it("does not pause before the first bubble when none was configured", () => {
    expect(messageDelayMs(undefined, 0, BUDGET)).toBe(0);
  });

  it("keeps the old fixed gap for later bubbles of a legacy node", () => {
    expect(messageDelayMs(undefined, 1, BUDGET)).toBe(DEFAULT_MESSAGE_GAP_MS);
    expect(messageDelayMs(undefined, 4, BUDGET)).toBe(DEFAULT_MESSAGE_GAP_MS);
  });

  it("honours a configured pause, including on the first bubble", () => {
    expect(messageDelayMs(5, 0, BUDGET)).toBe(5_000);
    expect(messageDelayMs(7, 2, BUDGET)).toBe(7_000);
  });

  // A flow author typing seconds where they meant something else must not be
  // able to hold the webhook open; clamping beats sending nothing at all.
  it("clamps a single pause to the per-bubble ceiling", () => {
    expect(messageDelayMs(600, 1, BUDGET)).toBe(MAX_MESSAGE_DELAY_MS);
  });

  it("never exceeds what is left of the node's budget", () => {
    expect(messageDelayMs(10, 1, 4_000)).toBe(4_000);
    expect(messageDelayMs(10, 1, 0)).toBe(0);
  });

  it("treats a spent or negative budget as no pause", () => {
    expect(messageDelayMs(5, 1, -1_000)).toBe(0);
  });

  it("ignores a negative configured pause rather than waiting backwards", () => {
    // Falls through to the legacy gap, because a negative pause is not a
    // request for zero: index 1 still wants the default rhythm.
    expect(messageDelayMs(-5, 1, BUDGET)).toBe(DEFAULT_MESSAGE_GAP_MS);
    expect(messageDelayMs(-5, 0, BUDGET)).toBe(0);
  });

  it("drains the budget across a long paced sequence", () => {
    const pauses = [0, 30, 30, 30];
    let budget = BUDGET;
    const waited = pauses.map((p, i) => {
      const ms = messageDelayMs(p, i, budget);
      budget -= ms;
      return ms;
    });

    expect(waited).toEqual([0, 30_000, 30_000, 0]);
    expect(budget).toBe(0);
  });
});

describe("readPostActions", () => {
  it("returns nothing for a node that carries none", () => {
    expect(readPostActions({ messages: [] })).toEqual([]);
    expect(readPostActions(undefined)).toEqual([]);
    expect(readPostActions(null)).toEqual([]);
  });

  it("ignores a postActions value that is not a list", () => {
    expect(readPostActions({ postActions: "setCustomField" })).toEqual([]);
    expect(readPostActions({ postActions: {} })).toEqual([]);
  });

  it("drops entries with no actionType instead of running them blindly", () => {
    const actions = readPostActions({
      postActions: [
        null,
        { fieldSlug: "status_bot", value: "x" },
        { actionType: "setCustomField", fieldSlug: "status_bot", value: "x" },
      ],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("setCustomField");
  });
});

describe("hasStatefulPostAction", () => {
  it("is true when an action writes a variable the session must keep", () => {
    expect(
      hasStatefulPostAction({
        postActions: [
          { actionType: "setCustomField", fieldSlug: "status_bot", value: "x" },
        ],
      })
    ).toBe(true);

    expect(
      hasStatefulPostAction({
        postActions: [{ actionType: "activeCampaign", email: "{{email}}" }],
      })
    ).toBe(true);
  });

  it("is false for actions that only touch the contact's tags", () => {
    expect(
      hasStatefulPostAction({
        postActions: [{ actionType: "addTag", action: "add", tagName: "lead" }],
      })
    ).toBe(false);
  });

  it("is false when there are no actions at all", () => {
    expect(hasStatefulPostAction({ messages: [] })).toBe(false);
  });
});
