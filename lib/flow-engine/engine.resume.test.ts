import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext } from "./types";

// The engine sends through a provider and paces itself with timers; neither
// is what these tests are about.
vi.mock("@/lib/messaging", () => ({
  createMessagingProvider: async () => ({
    sendMessage: async () => ({ messageId: "m1" }),
  }),
}));

const { resumeSession } = await import("./engine");

/** A waiting message node with two buttons, each with its own exit. */
const nodes = [
  {
    id: "ask",
    type: "sendMessage",
    data: {
      waitForReply: true,
      timeout: 20,
      timeoutUnit: "hours",
      messages: [
        {
          text: "Qual deles?",
          buttons: [
            { payload: "SIM", title: "Sim, quero", type: "postback" },
            { payload: "NAO", title: "Não consigo agora", type: "postback" },
          ],
        },
      ],
    },
  },
  { id: "yes", type: "sendMessage", data: { messages: [{ text: "link" }] } },
  { id: "no", type: "sendMessage", data: { messages: [{ text: "curso" }] } },
];

const edges = [
  { id: "e1", source: "ask", target: "yes", sourceHandle: "SIM" },
  { id: "e2", source: "ask", target: "no", sourceHandle: "NAO" },
];

const session = {
  id: "sess-1",
  flow_id: "flow-1",
  contact_id: "contact-1",
  channel_id: "channel-1",
  current_node_id: "ask",
  status: "active",
  waiting_for_input: true,
  waiting_until: "2026-10-21T00:00:00Z",
  variables: {},
  human_takeover_at: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
} as unknown as Database["public"]["Tables"]["flow_sessions"]["Row"];

function context(): FlowExecutionContext {
  return {
    workspaceId: "ws-1",
    flowId: "flow-1",
    channelId: "channel-1",
    contactId: "contact-1",
    conversationId: "conv-1",
    incomingMessage: { postbackPayload: "SIM" },
    variables: {},
  } as unknown as FlowExecutionContext;
}

function fixture(extra: Record<string, unknown[]> = {}) {
  return createFakeSupabase({
    rows: {
      flows: [{ id: "flow-1", nodes, edges, status: "published" }],
      channels: [{ platform: "instagram", late_account_id: "acct-1" }],
      conversations: [{ late_conversation_id: "lc-1" }],
      contacts: [{ last_interaction_at: new Date().toISOString() }],
      // A key has to be present or executeSendMessage returns before the
      // window is ever checked. The provider is mocked, so it is never read.
      workspaces: [{ late_api_key_encrypted: "enc:v1:fake" }],
      analytics_events: [],
      ...extra,
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("resumeSession: a repeat press of the same button", () => {
  it("leaves the run exactly as it was, rather than stranding it", async () => {
    // The press being handled has an earlier twin inside the window.
    const fake = fixture({
      analytics_events: [{ id: "evt-earlier" }],
    });

    await resumeSession(
      fake.client as unknown as SupabaseClient<Database>,
      session,
      context()
    );

    // The bug: the wait was cleared and the give-up job deleted before the
    // repeat was noticed, leaving the run active, not waiting and with no
    // job. No later reply could resume it and no rescue could fire.
    expect(fake.on("flow_sessions", "update")).toHaveLength(0);
    expect(fake.on("scheduled_jobs", "delete")).toHaveLength(0);
    expect(fake.on("analytics_events", "insert")).toHaveLength(0);
  });

  it("tells a repeat from a fresh run of the same flow", async () => {
    // The guard has to ask for this run, not merely this contact and flow:
    // someone who restarts with a keyword and presses the same button again
    // has answered, and swallowing that press strands the new run.
    const fake = fixture({ analytics_events: [{ id: "evt-earlier" }] });

    await resumeSession(
      fake.client as unknown as SupabaseClient<Database>,
      session,
      context()
    );

    expect(fake.asked("analytics_events", "sessionId")).toBe(true);
  });
});

describe("resumeSession: a first press", () => {
  it("records the tap, clears the wait and drops the give-up job", async () => {
    const fake = fixture();

    await resumeSession(
      fake.client as unknown as SupabaseClient<Database>,
      session,
      context()
    );

    const tap = fake.on("analytics_events", "insert")[0];
    expect((tap?.payload as { event_type?: string })?.event_type).toBe(
      "button_tapped"
    );
    expect((tap?.payload as { metadata?: { sessionId?: string } })?.metadata?.sessionId)
      .toBe("sess-1");

    expect(fake.on("scheduled_jobs", "delete")).toHaveLength(1);
    expect(
      fake.on("flow_sessions", "update").some(
        (c) => (c.payload as { waiting_for_input?: boolean })?.waiting_for_input === false
      )
    ).toBe(true);
  });
});

describe("resumeSession: the messaging window", () => {
  it("measures it from the contact's own last action, not our sent messages", async () => {
    // It used to read the local `messages` table for the newest inbound row.
    // Nothing writes one, so the window always read as open and the guard
    // passed every time while looking like it worked.
    const fake = fixture();

    await resumeSession(
      fake.client as unknown as SupabaseClient<Database>,
      session,
      context()
    );

    expect(fake.asked("contacts", "last_interaction_at")).toBe(true);
    expect(fake.asked("messages", "inbound")).toBe(false);
  });
});
