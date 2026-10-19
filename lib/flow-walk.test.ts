import { describe, it, expect } from "vitest";
import { buildThread } from "./flow-walk";

const trigger = { id: "t", type: "trigger", data: {} };

function msg(id: string, text: string, extra: Record<string, unknown> = {}) {
  return { id, type: "sendMessage", data: { messages: [{ text, ...extra }] } };
}

function edge(id: string, source: string, target: string, sourceHandle?: string) {
  return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

describe("buildThread", () => {
  it("returns nothing useful for a flow with no trigger", () => {
    const thread = buildThread([msg("a", "hi")], []);
    expect(thread.steps).toEqual([]);
    expect(thread.ending).toBe("end");
  });

  it("follows a straight chain and ends", () => {
    const thread = buildThread(
      [trigger, msg("a", "first"), msg("b", "second")],
      [edge("e1", "t", "a"), edge("e2", "a", "b")]
    );

    expect(thread.steps.map((s) => s.kind)).toEqual(["message", "message"]);
    expect(thread.ending).toBe("end");
    expect(thread.pending).toBeNull();
  });

  it("reports every bubble of a multi-message node in order", () => {
    const node = {
      id: "a",
      type: "sendMessage",
      data: {
        messages: [{ text: "one" }, { text: "two", delaySeconds: 5 }],
      },
    };
    const thread = buildThread([trigger, node], [edge("e1", "t", "a")]);

    expect(thread.steps[0]).toMatchObject({ kind: "message", nodeId: "a" });
    if (thread.steps[0].kind === "message") {
      expect(thread.steps[0].bubbles).toHaveLength(2);
      expect(thread.steps[0].bubbles[1].delaySeconds).toBe(5);
    }
  });

  it("stops at a branch and offers the options", () => {
    const condition = {
      id: "c",
      type: "condition",
      data: { conditions: [{ field: "variable:payload", operator: "equals", value: "P" }] },
    };
    const thread = buildThread(
      [trigger, condition, msg("yes", "sim"), msg("no", "nao")],
      [edge("e1", "t", "c"), edge("e2", "c", "yes", "yes"), edge("e3", "c", "no", "no")]
    );

    expect(thread.ending).toBe("branch");
    expect(thread.pending).toHaveLength(2);
    expect(thread.pending?.map((b) => b.edgeId)).toEqual(["e2", "e3"]);
  });

  // The point of the panel is reading the conversation, so a branch should
  // say what the person tapped, not which handle the edge came out of.
  it("names a payload branch after the button that carries it", () => {
    const question = {
      id: "q",
      type: "sendMessage",
      data: {
        messages: [
          {
            text: "É isso?",
            buttons: [{ title: "Sim, é isso mesmo!", type: "postback", payload: "FA_SIM" }],
          },
        ],
      },
    };
    const condition = {
      id: "c",
      type: "condition",
      data: { conditions: [{ field: "variable:payload", operator: "equals", value: "FA_SIM" }] },
    };

    const thread = buildThread(
      [trigger, question, condition, msg("yes", "ok"), msg("no", "outro")],
      [
        edge("e1", "t", "q"),
        edge("e2", "q", "c"),
        edge("e3", "c", "yes", "yes"),
        edge("e4", "c", "no", "no"),
      ]
    );

    expect(thread.pending?.[0].label).toBe("Sim, é isso mesmo!");
    expect(thread.pending?.[1].label).toBe('Anything other than "Sim, é isso mesmo!"');
  });

  it("falls back to the handle name when no button matches", () => {
    const condition = { id: "c", type: "condition", data: { conditions: [] } };
    const thread = buildThread(
      [trigger, condition, msg("a", "a"), msg("b", "b")],
      [edge("e1", "t", "c"), edge("e2", "c", "a", "yes"), edge("e3", "c", "b", "no")]
    );

    expect(thread.pending?.map((b) => b.label)).toEqual(["Yes", "No"]);
  });

  it("takes the chosen branch and carries on past it", () => {
    const condition = { id: "c", type: "condition", data: {} };
    const thread = buildThread(
      [trigger, condition, msg("a", "left"), msg("b", "right")],
      [edge("e1", "t", "c"), edge("e2", "c", "a", "yes"), edge("e3", "c", "b", "no")],
      ["e3"]
    );

    expect(thread.ending).toBe("end");
    if (thread.steps[0].kind === "message") {
      expect(thread.steps[0].bubbles[0].text).toBe("right");
    }
  });

  it("describes waits in words instead of skipping them", () => {
    const delay = { id: "d", type: "delay", data: { duration: 18, unit: "hours" } };
    const smart = {
      id: "s",
      type: "action",
      data: { actionType: "smartDelay", timeout: 1, timeoutUnit: "hours" },
    };
    const thread = buildThread(
      [trigger, delay, smart],
      [edge("e1", "t", "d"), edge("e2", "d", "s")]
    );

    expect(thread.steps[0]).toMatchObject({ kind: "wait", label: "Waits 18 hours" });
    expect(thread.steps[1]).toMatchObject({
      kind: "reply",
      label: "Waits for a reply, up to 1 hour",
    });
  });

  it("reports side effects even though nothing is sent", () => {
    const field = {
      id: "f",
      type: "action",
      data: { actionType: "setCustomField", fieldSlug: "objetivo_financeiro" },
    };
    const thread = buildThread([trigger, field], [edge("e1", "t", "f")]);

    expect(thread.steps[0]).toMatchObject({
      kind: "action",
      label: "Saves objetivo_financeiro",
    });
  });

  // A re-ask loop is a legitimate shape; the walk must not hang on one.
  it("gives up on a cycle instead of running forever", () => {
    const thread = buildThread(
      [trigger, msg("a", "again?")],
      [edge("e1", "t", "a"), edge("e2", "a", "a")]
    );

    expect(thread.ending).toBe("loop");
    expect(thread.steps.length).toBeLessThanOrEqual(200);
  });

  it("stops cleanly when an edge points at a node that is gone", () => {
    const thread = buildThread(
      [trigger, msg("a", "hi")],
      [edge("e1", "t", "a"), edge("e2", "a", "deleted")]
    );

    expect(thread.ending).toBe("end");
    expect(thread.steps).toHaveLength(1);
  });
});
