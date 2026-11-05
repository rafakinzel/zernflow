import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAgentKeyValid, presentedKey } from "./auth";
import {
  CENTRAL_CREATED_VIA,
  CENTRAL_DESCRIPTION,
  InputError,
  buildCommentToDmFlow,
} from "./flow-template";
import {
  ConflictError,
  createDraftFlow,
  getAgentFlowState,
  iscaPath,
  listKeywords,
  uploadIsca,
} from "./store";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { matchCommentTrigger } from "@/lib/comment-processor";

const KEY = "k".repeat(48);
const WS = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// A small recording database. It answers selects from fixtures per table,
// hands out ids on insert, and records every operation so a test can say
// exactly what the door wrote, and that it wrote nothing else.
// ---------------------------------------------------------------------------

interface Op {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: string[];
}

function fakeDb(fixtures: Record<string, unknown[]> = {}, failInsertOn?: string) {
  const ops: Op[] = [];
  const storageOps: Array<{ op: string; bucket: string; path: string; options?: unknown }> = [];
  let seq = 0;

  function chain(table: string, op: Op["op"], payload?: unknown) {
    const rec: Op = { table, op, payload, filters: [] };
    ops.push(rec);
    const result = () => {
      if (op === "insert") {
        if (failInsertOn === table) return { data: null, error: { message: "boom" } };
        seq += 1;
        return { data: { id: `00000000-0000-0000-0000-00000000000${seq}` }, error: null };
      }
      if (op === "select") return { data: fixtures[table] ?? [], error: null };
      return { data: null, error: null };
    };
    const c: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(res, rej),
      single: () => Promise.resolve(result()),
      maybeSingle: () => {
        const r = result();
        return Promise.resolve(
          Array.isArray(r.data) ? { data: r.data[0] ?? null, error: null } : r
        );
      },
    };
    for (const m of ["select", "eq", "in", "is", "limit", "order"]) {
      c[m] = (...args: unknown[]) => {
        rec.filters.push(`${m}:${JSON.stringify(args)}`);
        return c;
      };
    }
    return c;
  }

  const client = {
    from: (table: string) => ({
      select: (cols?: string) => (chain(table, "select") as any).select(cols),
      insert: (p: unknown) => chain(table, "insert", p),
      update: (p: unknown) => chain(table, "update", p),
      upsert: (p: unknown) => chain(table, "upsert", p),
      delete: () => chain(table, "delete"),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _b: unknown, options: unknown) => {
          storageOps.push({ op: "upload", bucket, path, options });
          return { data: { path }, error: null };
        },
        createSignedUploadUrl: async (path: string) => {
          storageOps.push({ op: "signed", bucket, path });
          return { data: { signedUrl: `https://s/${path}?token=t` }, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  };

  return { client: client as any, ops, storageOps };
}

const validInput = {
  keyword: "SS",
  message: "Oi! Aqui está o seu guia: {{link}}",
  pdfUrl: "https://x.supabase.co/storage/v1/object/public/iscas/2026-11/1-ss.pdf",
};

// ---------------------------------------------------------------------------

describe("the agent key", () => {
  it("lets the right key in", () => {
    expect(isAgentKeyValid(KEY, KEY)).toBe(true);
  });

  it("refuses a wrong key, an empty one, and one of another length", () => {
    expect(isAgentKeyValid("x".repeat(48), KEY)).toBe(false);
    expect(isAgentKeyValid("", KEY)).toBe(false);
    expect(isAgentKeyValid(null, KEY)).toBe(false);
    expect(isAgentKeyValid(KEY + "x", KEY)).toBe(false);
  });

  it("refuses everyone when the variable is unset or too short to be real", () => {
    expect(isAgentKeyValid(KEY, undefined)).toBe(false);
    expect(isAgentKeyValid("", "")).toBe(false);
    expect(isAgentKeyValid("short", "short")).toBe(false);
  });

  it("reads a bearer token or the dedicated header", () => {
    expect(presentedKey(new Headers({ authorization: `Bearer ${KEY}` }))).toBe(KEY);
    expect(presentedKey(new Headers({ "x-central-agent-key": KEY }))).toBe(KEY);
    expect(presentedKey(new Headers())).toBeNull();
  });
});

describe("the comment-to-DM graph", () => {
  it("is a comment_keyword trigger wired to one Send Message bubble", () => {
    const flow = buildCommentToDmFlow(validInput);
    const [trigger, message] = flow.nodes as any[];

    expect(trigger.type).toBe("trigger");
    expect(trigger.data.triggerType).toBe("comment_keyword");
    expect(trigger.data.keywords).toEqual([
      { value: "SS", matchType: "exact" },
      { value: "#SS", matchType: "contains" },
    ]);
    expect(message.type).toBe("sendMessage");
    expect(message.data.messages).toHaveLength(1);
    expect(message.data.messages[0].text).toBe(`Oi! Aqui está o seu guia: ${validInput.pdfUrl}`);
    expect(flow.edges).toEqual([
      expect.objectContaining({ source: trigger.id, target: message.id }),
    ]);
  });

  it("holds together: no edge to a missing node, nothing unreachable", () => {
    const { nodes, edges } = buildCommentToDmFlow(validInput);
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges as any[]) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    const reached = new Set(edges.map((e: any) => e.target));
    for (const n of nodes as any[]) {
      if (n.type !== "trigger") expect(reached.has(n.id)).toBe(true);
    }
    // The bubble does not wait for a reply, so it needs no exits of its own.
    expect((nodes[1] as any).data.waitForReply).toBeUndefined();
  });

  it("publishes into the same trigger row the builder would make", () => {
    const flow = buildCommentToDmFlow({ ...validInput, commentReplies: ["Te mandei no direct!"] });
    const rows = buildDesiredTriggers(flow.nodes, "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("comment_keyword");
    expect(rows[0].config).toEqual(flow.triggerConfig);
  });

  it("fires on the word alone or with its hashtag, and not on a stray pair of letters", () => {
    // Run through the real comment matcher, on the row publishing would write.
    const flow = buildCommentToDmFlow(validInput);
    const [row] = buildDesiredTriggers(flow.nodes, "flow-1");
    const trigger = { ...row, id: "t" } as any;
    const fires = (text: string) => matchCommentTrigger([trigger], { postId: "p", text }) !== null;

    for (const text of ["SS", "ss", " Ss ", "#SS", "#ss", "quero o #SS!", "#SS por favor"]) {
      expect(fires(text), text).toBe(true);
    }
    for (const text of ["assim", "isso mesmo", "quero SS", "SS por favor", "passei aqui", "s s"]) {
      expect(fires(text), text).toBe(false);
    }
  });

  it("does not let the routine loosen the match", () => {
    const flow = buildCommentToDmFlow({ ...validInput, matchType: "contains" } as any);
    expect(flow.keywords.find((k) => k.value === "SS")?.matchType).toBe("exact");
  });

  it("appends the link when the message does not place it", () => {
    const flow = buildCommentToDmFlow({ ...validInput, message: "Seu guia chegou." });
    expect(flow.dmText).toBe(`Seu guia chegou.\n\n${validInput.pdfUrl}`);
  });

  it("strips a leading # from the keyword", () => {
    expect(buildCommentToDmFlow({ ...validInput, keyword: " #casal " }).keyword).toBe("casal");
  });

  it("refuses what it cannot send", () => {
    expect(() => buildCommentToDmFlow({ ...validInput, keyword: "" })).toThrow(InputError);
    expect(() => buildCommentToDmFlow({ ...validInput, message: " " })).toThrow(InputError);
    expect(() => buildCommentToDmFlow({ ...validInput, pdfUrl: "http://x/a.pdf" })).toThrow(InputError);
    expect(() => buildCommentToDmFlow({ ...validInput, message: "a".repeat(1000) })).toThrow(InputError);
  });
});

describe("creating a draft", () => {
  it("inserts a draft flow and a switched-off trigger, and nothing else", async () => {
    const db = fakeDb();
    const created = await createDraftFlow(db.client, WS, validInput);

    expect(created.status).toBe("draft");
    expect(created.triggerActive).toBe(false);

    const writes = db.ops.filter((o) => o.op !== "select");
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(["insert:flows", "insert:triggers"]);

    const flow = writes[0].payload as any;
    expect(flow.status).toBe("draft");
    expect(flow.workspace_id).toBe(WS);
    expect(flow.description).toBe(CENTRAL_DESCRIPTION);
    expect(flow.created_via).toBe(CENTRAL_CREATED_VIA);
    expect(flow.published_at).toBeUndefined();

    const trigger = writes[1].payload as any;
    expect(trigger.is_active).toBe(false);
    expect(trigger.type).toBe("comment_keyword");
    expect(trigger.flow_id).toBe(created.flowId);
  });

  it("ignores a request to make it live", async () => {
    const db = fakeDb();
    await createDraftFlow(db.client, WS, {
      ...validInput,
      status: "published",
      is_active: true,
      isActive: true,
    } as any);
    const [flow, trigger] = db.ops.filter((o) => o.op === "insert").map((o) => o.payload as any);
    expect(flow.status).toBe("draft");
    expect(trigger.is_active).toBe(false);
  });

  it("refuses a keyword that already has a trigger, ignoring case and #", async () => {
    const db = fakeDb({
      flows: [{ id: "f1", name: "Guia SS", status: "published", nodes: [], created_via: null }],
      triggers: [
        {
          id: "t1",
          flow_id: "f1",
          type: "comment_keyword",
          config: { keywords: [{ value: "ss", matchType: "exact" }] },
          is_active: true,
        },
      ],
    });
    await expect(createDraftFlow(db.client, WS, { ...validInput, keyword: "#SS" })).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("refuses a keyword that lives only in a draft's node", async () => {
    const db = fakeDb({
      flows: [
        {
          id: "f2",
          name: "Rascunho casal",
          status: "draft",
          created_via: null,
          nodes: [{ id: "n", type: "trigger", data: { triggerType: "comment_keyword", keywords: [{ value: "Casal" }] } }],
        },
      ],
      triggers: [],
    });
    await expect(createDraftFlow(db.client, WS, { ...validInput, keyword: "casal" })).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("undoes only its own insert when the trigger cannot be written", async () => {
    const db = fakeDb({}, "triggers");
    await expect(createDraftFlow(db.client, WS, validInput)).rejects.toThrow("boom");
    const del = db.ops.filter((o) => o.op === "delete");
    expect(del).toHaveLength(1);
    expect(del[0].table).toBe("flows");
    expect(del[0].filters.join(" ")).toContain('"00000000-0000-0000-0000-000000000001"');
    expect(del[0].filters.join(" ")).toContain(`"created_via","${CENTRAL_CREATED_VIA}"`);
    expect(del[0].filters.join(" ")).toContain('"status","draft"');
  });
});

describe("listing keywords", () => {
  it("says which flow answers each keyword and whether it is live", async () => {
    const db = fakeDb({
      flows: [
        { id: "f1", name: "FA", status: "published", nodes: [], created_via: null },
        { id: "f2", name: "Central TB · SS", status: "draft", nodes: [], created_via: CENTRAL_CREATED_VIA },
      ],
      triggers: [
        { id: "t1", flow_id: "f1", type: "comment_keyword", config: { keywords: [{ value: "FA" }] }, is_active: true },
        { id: "t2", flow_id: "f2", type: "comment_keyword", config: { keywords: [{ value: "SS" }] }, is_active: false },
        { id: "t3", flow_id: "f1", type: "keyword", config: { keywords: ["fa"] }, is_active: true },
      ],
    });
    const list = await listKeywords(db.client, WS);
    expect(list.find((k) => k.keyword === "FA" && k.type === "comment_keyword")).toMatchObject({
      flowName: "FA",
      live: true,
      createdByCentral: false,
    });
    expect(list.find((k) => k.keyword === "SS")).toMatchObject({ live: false, createdByCentral: true });
    expect(list.filter((k) => k.keyword === "FA" && k.type === "comment_keyword")).toHaveLength(1);
    expect(db.ops.every((o) => o.op === "select")).toBe(true);
  });
});

describe("the list warns about loose matches", () => {
  const listWith = (keywords: unknown[]) =>
    listKeywords(
      fakeDb({
        flows: [{ id: "f1", name: "x", status: "published", nodes: [], created_via: null }],
        triggers: [{ id: "t1", flow_id: "f1", type: "comment_keyword", config: { keywords }, is_active: true }],
      }).client,
      WS
    );

  it("gathers SS and #SS into one keyword with both rules", async () => {
    const [entry] = await listWith([
      { value: "SS", matchType: "exact" },
      { value: "#SS", matchType: "contains" },
    ]);
    expect(entry.keyword).toBe("SS");
    expect(entry.matches).toEqual([
      { value: "SS", matchType: "exact" },
      { value: "#SS", matchType: "contains" },
    ]);
    expect(entry.warning).toBeUndefined();
  });

  it("flags a short bare word matched anywhere in the comment", async () => {
    const [entry] = await listWith([{ value: "fa", matchType: "contains" }]);
    expect(entry.warning).toContain("fa");
  });

  it("treats a keyword with no rule as contains, as the matcher does", async () => {
    const [entry] = await listWith([{ value: "rd" }]);
    expect(entry.matches).toEqual([{ value: "rd", matchType: "contains" }]);
    expect(entry.warning).toBeDefined();
  });

  it("does not flag a long word or a hashtag", async () => {
    expect((await listWith([{ value: "casal", matchType: "contains" }]))[0].warning).toBeUndefined();
    expect((await listWith([{ value: "#fa", matchType: "contains" }]))[0].warning).toBeUndefined();
  });
});

describe("flow state", () => {
  it("reads only flows the door made, and says when Rafa has switched one on", async () => {
    const flowId = "22222222-2222-2222-2222-222222222222";
    const db = fakeDb({
      flows: [{ id: flowId, name: "x", status: "published", version: 2, published_at: "t", updated_at: "t", created_via: CENTRAL_CREATED_VIA }],
      triggers: [{ id: "t", type: "comment_keyword", config: { keywords: [{ value: "SS" }] }, is_active: true }],
    });
    const state = await getAgentFlowState(db.client, WS, flowId);
    expect(state.state).toBe("ativo");
    expect(state.live).toBe(true);
    expect(db.ops[0].filters.join(" ")).toContain(`"created_via","${CENTRAL_CREATED_VIA}"`);
    expect(db.ops.every((o) => o.op === "select")).toBe(true);
  });

  it("says a draft is waiting", async () => {
    const flowId = "22222222-2222-2222-2222-222222222222";
    const db = fakeDb({
      flows: [{ id: flowId, name: "x", status: "draft", created_via: CENTRAL_CREATED_VIA }],
      triggers: [{ id: "t", type: "comment_keyword", config: {}, is_active: false }],
    });
    expect((await getAgentFlowState(db.client, WS, flowId)).state).toBe("esperando_rafa");
  });
});

describe("uploading a PDF", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 hello");

  it("stores it under a fresh name in the iscas bucket and returns the public link", async () => {
    const db = fakeDb();
    const out = await uploadIsca(db.client, { name: "Guia Super Saver.pdf", bytes: pdf });
    expect(db.storageOps[0]).toMatchObject({ op: "upload", bucket: "iscas" });
    expect((db.storageOps[0].options as any).upsert).toBe(false);
    expect(out.publicUrl).toContain("/public/iscas/");
    expect(out.path).toMatch(/^\d{4}-\d{2}\/\d+-guia-super-saver\.pdf$/);
  });

  it("refuses what is not a PDF", async () => {
    const db = fakeDb();
    await expect(
      uploadIsca(db.client, { name: "a.pdf", bytes: new TextEncoder().encode("<html>") })
    ).rejects.toBeInstanceOf(InputError);
    expect(db.storageOps).toEqual([]);
  });

  it("names files readably", () => {
    expect(iscaPath("Casal à Prova!.PDF", new Date("2026-11-05T00:00:00Z"))).toBe(
      `2026-11/${new Date("2026-11-05T00:00:00Z").getTime()}-casal-a-prova.pdf`
    );
  });
});

// ---------------------------------------------------------------------------
// The routes themselves: no key, no entry, and the service client is never
// even created.
// ---------------------------------------------------------------------------

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
  createClient: () => {
    throw new Error("the door never uses a person's session");
  },
}));

describe("the routes", () => {
  const original = process.env.CENTRAL_AGENT_KEY;
  beforeEach(() => {
    process.env.CENTRAL_AGENT_KEY = KEY;
    createServiceClient.mockReset();
  });
  afterEach(() => {
    process.env.CENTRAL_AGENT_KEY = original;
  });

  const cases = async () => {
    const keywords = await import("@/app/api/v1/central/keywords/route");
    const flows = await import("@/app/api/v1/central/flows/route");
    const flow = await import("@/app/api/v1/central/flows/[flowId]/route");
    const iscas = await import("@/app/api/v1/central/iscas/route");
    const params = { params: Promise.resolve({ flowId: "22222222-2222-2222-2222-222222222222" }) };
    return [
      (h: HeadersInit) => keywords.GET(new Request("https://b/api/v1/central/keywords", { headers: h }) as any),
      (h: HeadersInit) =>
        flows.POST(new Request("https://b/api/v1/central/flows", { method: "POST", headers: h, body: "{}" }) as any),
      (h: HeadersInit) => flow.GET(new Request("https://b/api/v1/central/flows/x", { headers: h }) as any, params),
      (h: HeadersInit) =>
        iscas.POST(new Request("https://b/api/v1/central/iscas", { method: "POST", headers: h, body: "{}" }) as any),
    ];
  };

  it("answer 401 without the key, with a wrong key, and when the key is unset", async () => {
    for (const call of await cases()) {
      expect((await call({})).status).toBe(401);
      expect((await call({ authorization: `Bearer ${"z".repeat(48)}` })).status).toBe(401);
    }
    delete process.env.CENTRAL_AGENT_KEY;
    for (const call of await cases()) {
      expect((await call({ authorization: "Bearer " })).status).toBe(401);
    }
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("never write the key to the log", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    createServiceClient.mockRejectedValue(new Error("db down"));
    for (const call of await cases()) {
      await call({ authorization: `Bearer ${KEY}` });
      await call({ authorization: `Bearer ${"y".repeat(48)}` });
    }
    for (const spy of spies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toContain("y".repeat(48));
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// The rule that matters most, held in the source itself: this door has no
// way to switch anything on, publish, or change or remove what exists.
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("what the door can never do", () => {
  const routeDir = join(ROOT, "app", "api", "v1", "central");
  const sources = [...filesUnder(routeDir), ...filesUnder(join(ROOT, "lib", "central-agent"))].filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
  );

  it("has exactly these routes and methods", () => {
    const routes = filesUnder(routeDir)
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => {
        const src = readFileSync(f, "utf8");
        const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
        return `${relative(routeDir, f)} ${methods.join(",")}`;
      })
      .sort();
    expect(routes).toEqual([
      "flows/[flowId]/route.ts GET",
      "flows/route.ts POST",
      "iscas/route.ts POST",
      "keywords/route.ts GET",
    ]);
  });

  it("never updates, upserts, publishes, or switches a trigger on", () => {
    for (const file of sources) {
      // Hashing the key is the one `.update(` that is not a row update.
      const src = readFileSync(file, "utf8").replace(/createHash\([^)]*\)\s*\.update\(/g, "");
      const where = relative(ROOT, file);
      expect(src, where).not.toMatch(/\.update\(/);
      expect(src, where).not.toMatch(/\.upsert\(/);
      expect(src, where).not.toMatch(/\.rpc\(/);
      expect(src, where).not.toMatch(/is_active:\s*true/);
      expect(src, where).not.toMatch(/status:\s*["']published["']/);
      expect(src, where).not.toMatch(/published_at:/);
      expect(src, where).not.toMatch(/\.from\(["'](contacts|conversations|messages|flow_sessions|scheduled_jobs|contact_channels|broadcasts)["']\)/);
      expect(src, where).not.toMatch(/createMessagingProvider|executeFlow/);
    }
  });

  it("deletes in one place only: undoing its own fresh draft", () => {
    const hits = sources.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\.delete\(\)/g)].map(() => relative(ROOT, file))
    );
    expect(hits).toEqual(["lib/central-agent/store.ts"]);
    const store = readFileSync(join(ROOT, "lib", "central-agent", "store.ts"), "utf8");
    const at = store.indexOf(".delete()");
    const guard = store.slice(at, at + 200);
    expect(guard).toContain('.eq("created_via", CENTRAL_CREATED_VIA)');
    expect(guard).toContain('.eq("status", "draft")');
  });
});
