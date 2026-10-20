import { describe, it, expect } from "vitest";
import {
  MESSAGING_WINDOW_MS,
  WINDOW_SAFETY_MS,
  hoursSince,
  messagingWindow,
} from "./messaging-window";

const now = new Date("2026-10-20T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const HOUR = 60 * 60 * 1000;

describe("messagingWindow", () => {
  it("is open well inside 24 hours", () => {
    expect(messagingWindow(ago(2 * HOUR), now)).toMatchObject({
      open: true,
      reason: "open",
    });
  });

  it("is closed past 24 hours", () => {
    expect(messagingWindow(ago(25 * HOUR), now)).toMatchObject({
      open: false,
      reason: "closed",
    });
  });

  it("closes a little early rather than racing the clock", () => {
    // The platform measures from its own record and a queued job can sit for
    // minutes, so the last stretch is treated as already gone.
    const state = messagingWindow(
      ago(MESSAGING_WINDOW_MS - WINDOW_SAFETY_MS / 2),
      now
    );
    expect(state).toMatchObject({ open: false, reason: "closing" });
    expect(state.remainingMs).toBeGreaterThan(0);
  });

  it("is still open just before the safety margin begins", () => {
    expect(
      messagingWindow(ago(MESSAGING_WINDOW_MS - WINDOW_SAFETY_MS - 60_000), now)
    ).toMatchObject({ open: true, reason: "open" });
  });

  it("is exactly the case a 24-hour Smart Delay produces", () => {
    // The timeout branch of a delay set to 24 hours fires here, which is why
    // those rescues were the ones never arriving.
    expect(messagingWindow(ago(24 * HOUR), now).open).toBe(false);
    // Twenty hours is the same message, four hours earlier, and it sends.
    expect(messagingWindow(ago(20 * HOUR), now).open).toBe(true);
  });

  it("allows the send when there is no record of an inbound", () => {
    // Our own history can be incomplete. Refusing on missing data would
    // invent a failure the platform never had.
    for (const value of [null, undefined, "", "not a date"]) {
      expect(messagingWindow(value as string | null, now)).toMatchObject({
        open: true,
        reason: "no_record",
        remainingMs: null,
      });
    }
  });

  it("treats a timestamp in the future as open, not closed", () => {
    const future = new Date(now.getTime() + HOUR);
    expect(messagingWindow(future, now).open).toBe(true);
  });

  it("accepts a Date as readily as a string", () => {
    expect(messagingWindow(new Date(now.getTime() - 3 * HOUR), now).open).toBe(
      true
    );
  });
});

describe("hoursSince", () => {
  it("rounds to whole hours for a line a person reads", () => {
    expect(hoursSince(ago(25 * HOUR), now)).toBe(25);
    expect(hoursSince(ago(90 * 60 * 1000), now)).toBe(2);
  });
});
