import { describe, it, expect } from "vitest";
import {
  extractTriggers,
  describeTrigger,
  completionRate,
  relativeTime,
  tallyEvents,
} from "./flow-insights";

describe("extractTriggers", () => {
  it("reads the keywords off a comment trigger", () => {
    const triggers = extractTriggers([
      {
        id: "fa_0",
        type: "trigger",
        data: {
          triggerType: "comment_keyword",
          alsoMatchInDms: true,
          keywords: [
            { value: "#rd", matchType: "contains" },
            { value: "rd", matchType: "exact" },
          ],
        },
      },
      { id: "fa_1", type: "sendMessage", data: {} },
    ]);

    expect(triggers).toHaveLength(1);
    expect(triggers[0].keywords).toEqual(["#rd", "rd"]);
    expect(triggers[0].alsoMatchInDms).toBe(true);
  });

  it("survives a flow with no nodes or a malformed one", () => {
    expect(extractTriggers(null)).toEqual([]);
    expect(extractTriggers("nope")).toEqual([]);
    expect(extractTriggers([{ type: "trigger" }])).toEqual([
      { nodeId: "", triggerType: "unknown", keywords: [], alsoMatchInDms: false },
    ]);
  });

  it("drops blank keywords rather than rendering empty chips", () => {
    const [trigger] = extractTriggers([
      {
        id: "t",
        type: "trigger",
        data: { triggerType: "comment_keyword", keywords: [{ value: "  " }, { value: "#fa" }] },
      },
    ]);

    expect(trigger.keywords).toEqual(["#fa"]);
  });
});

describe("describeTrigger", () => {
  it("says where a comment trigger listens, including DMs when it does", () => {
    expect(
      describeTrigger({ nodeId: "t", triggerType: "comment_keyword", keywords: ["#rd"], alsoMatchInDms: true })
    ).toBe("Comment, DM or story reply contains");

    expect(
      describeTrigger({ nodeId: "t", triggerType: "comment_keyword", keywords: ["#rd"], alsoMatchInDms: false })
    ).toBe("Comment contains");
  });

  it("spells out that a keywordless trigger catches everything", () => {
    expect(
      describeTrigger({ nodeId: "t", triggerType: "dm_keyword", keywords: [], alsoMatchInDms: false })
    ).toBe("DM contains any message");
  });
});

describe("completionRate", () => {
  // A flow published an hour ago has not failed; it has not been tried.
  it("is null when the flow has never run", () => {
    expect(completionRate(0, 0)).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(completionRate(3, 1)).toBe(33);
    expect(completionRate(20, 12)).toBe(60);
  });

  it("never reports more than everyone finishing", () => {
    // Completed can outrun started when a run began before this window.
    expect(completionRate(5, 9)).toBe(100);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-19T16:00:00Z");

  it("reads in the largest unit that fits", () => {
    expect(relativeTime("2026-10-05T16:00:00Z", now)).toBe("2 weeks ago");
    expect(relativeTime("2026-10-17T16:00:00Z", now)).toBe("2 days ago");
    expect(relativeTime("2026-10-19T13:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-19T15:45:00Z", now)).toBe("15 minutes ago");
  });

  it("uses the singular for one", () => {
    expect(relativeTime("2026-10-12T16:00:00Z", now)).toBe("1 week ago");
  });

  it("does not count backwards for a clock that is ahead", () => {
    expect(relativeTime("2026-10-19T16:05:00Z", now)).toBe("just now");
  });

  it("says so rather than printing NaN for a bad date", () => {
    expect(relativeTime("not a date", now)).toBe("unknown");
  });
});

describe("tallyEvents", () => {
  it("counts each kind per flow and ignores rows with no flow", () => {
    const counts = tallyEvents([
      { flow_id: "a", event_type: "flow_started" },
      { flow_id: "a", event_type: "flow_started" },
      { flow_id: "a", event_type: "flow_completed" },
      { flow_id: "a", event_type: "message_sent" },
      { flow_id: "b", event_type: "flow_started" },
      { flow_id: null, event_type: "flow_started" },
      { flow_id: "a", event_type: "contact_created" },
    ]);

    expect(counts.a).toEqual({ started: 2, completed: 1, messagesSent: 1 });
    expect(counts.b).toEqual({ started: 1, completed: 0, messagesSent: 0 });
    expect(Object.keys(counts).sort()).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty history", () => {
    expect(tallyEvents([])).toEqual({});
  });
});
