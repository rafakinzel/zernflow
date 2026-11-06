import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  Recusa,
  automacoesDe,
  classificar,
  janelaDm,
  lerParametros,
  montarConversa,
  motivoParaNaoResponder,
  threadLocal,
  validarPedido,
  type LinhaLocal,
  type MensagemDaConversa,
} from "./dm";
import { listarConversas, responder } from "./dm-store";

const NOW = new Date("2026-11-06T12:00:00Z");
const CONV = "33333333-3333-3333-3333-333333333333";
const WS = "11111111-1111-1111-1111-111111111111";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function msg(direction: "inbound" | "outbound", text: string | null, at: string, extra: Partial<MensagemDaConversa> = {}): MensagemDaConversa {
  return { id: null, direction, text, attachments: null, platformMessageId: null, createdAt: at, ...extra };
}

// ---------------------------------------------------------------------------
// Query and body
// ---------------------------------------------------------------------------

describe("the query", () => {
  it("defaults to 2 days and 50 conversations", () => {
    expect(lerParametros(new URLSearchParams(""))).toEqual({ dias: 2, limite: 50 });
  });
  it("clamps to 60 days and 200 conversations", () => {
    expect(lerParametros(new URLSearchParams("dias=365&limite=1000"))).toEqual({ dias: 60, limite: 200 });
  });
  it("refuses what is not a positive whole number", () => {
    for (const q of ["dias=0", "dias=-1", "dias=1.5", "limite=abc"]) {
      expect(() => lerParametros(new URLSearchParams(q))).toThrow(Recusa);
    }
  });
});

describe("the reply body", () => {
  it("takes conversa, texto and an optional chave, trimmed", () => {
    expect(validarPedido({ conversa: CONV, texto: "  Oi!  ", chave: " a1 " })).toEqual({ conversa: CONV, texto: "Oi!", chave: "a1" });
    expect(validarPedido({ conversa: CONV, texto: "Oi" }).chave).toBeNull();
  });
  it("refuses empty or whitespace-only text", () => {
    for (const texto of ["", "   ", undefined, 3]) {
      expect(() => validarPedido({ conversa: CONV, texto })).toThrow(/vazio/);
    }
  });
  it("refuses more than 1000 characters, counting an emoji as one", () => {
    expect(validarPedido({ conversa: CONV, texto: "😀".repeat(1000) }).texto).toHaveLength(2000);
    expect(() => validarPedido({ conversa: CONV, texto: "a".repeat(1001) })).toThrow(/1001 caracteres/);
  });
  it("refuses a conversation that is not one of our ids", () => {
    for (const conversa of [undefined, "", "ig_123", "17841400000000000"]) {
      expect(() => validarPedido({ conversa, texto: "oi" })).toThrow(Recusa);
    }
  });
  it("refuses a bad chave", () => {
    expect(() => validarPedido({ conversa: CONV, texto: "oi", chave: "" })).toThrow(/chave/);
    expect(() => validarPedido({ conversa: CONV, texto: "oi", chave: "x".repeat(201) })).toThrow(/chave/);
    expect(() => validarPedido({ conversa: CONV, texto: "oi", chave: 5 })).toThrow(/chave/);
  });
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

describe("the 24-hour window, read strictly", () => {
  it("is open inside 24 hours and says when it closes", () => {
    expect(janelaDm(hoursAgo(2), NOW)).toEqual({ aberta: true, fechaEm: new Date(NOW.getTime() + 22 * 3600_000).toISOString() });
  });
  it("is shut after 24 hours and in the last ten minutes", () => {
    expect(janelaDm(hoursAgo(25), NOW).aberta).toBe(false);
    expect(janelaDm(new Date(NOW.getTime() - (24 * 60 - 5) * 60_000).toISOString(), NOW).aberta).toBe(false);
  });
  it("is shut with no record of the person writing (unlike the engine's guard)", () => {
    expect(janelaDm(null, NOW)).toEqual({ aberta: false, fechaEm: null });
    expect(janelaDm("not a date", NOW)).toEqual({ aberta: false, fechaEm: null });
  });
});

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

describe("who wrote each message", () => {
  it("inbound is the contact, a recorded automated send is automacao, anything else outbound is pessoa", () => {
    const thread = [
      msg("outbound", "Oi! Aqui está o guia: https://x", hoursAgo(5), { platformMessageId: "mid.1" }),
      msg("inbound", "Obrigada! E sobre super?", hoursAgo(4)),
      msg("outbound", "Oi Ana, te explico amanhã", hoursAgo(3)),
    ];
    const out = classificar(thread, [{ platformMessageId: "mid.1", text: "x", createdAt: hoursAgo(5) }], []);
    expect(out.map((m) => m.direcao)).toEqual(["automacao", "contato", "pessoa"]);
  });

  it("matches an automated send without an id by text and time (comment private replies carry none)", () => {
    const thread = [msg("outbound", "Te mandei o PDF  aqui", hoursAgo(1))];
    const auto = [{ platformMessageId: null, text: "te mandei o pdf aqui", createdAt: new Date(NOW.getTime() - 3600_000 + 60_000).toISOString() }];
    expect(classificar(thread, auto, [])[0].direcao).toBe("automacao");
  });

  it("does not match the same text far apart in time, nor one record twice", () => {
    const auto = [{ platformMessageId: null, text: "Oi!", createdAt: hoursAgo(1) }];
    expect(classificar([msg("outbound", "Oi!", hoursAgo(5))], auto, [])[0].direcao).toBe("pessoa");
    const two = classificar([msg("outbound", "Oi!", hoursAgo(1)), msg("outbound", "Oi!", hoursAgo(1))], auto, []);
    expect(two.map((m) => m.direcao).sort()).toEqual(["automacao", "pessoa"]);
  });

  it("marks the Central's own sends as pessoa with central: true", () => {
    const out = classificar(
      [msg("outbound", "Oi, aqui é o Thiago", hoursAgo(1), { platformMessageId: "mid.9" })],
      [],
      [{ platformMessageId: "mid.9", text: "Oi, aqui é o Thiago", createdAt: hoursAgo(1) }]
    );
    expect(out[0]).toMatchObject({ direcao: "pessoa", central: true });
  });

  it("sorts oldest first, drops undated messages, and returns attachment type but never its link", () => {
    const out = classificar(
      [
        msg("inbound", null, hoursAgo(1), { attachments: [{ type: "image", url: "https://cdn/secret.jpg" }] }),
        msg("inbound", "primeiro", hoursAgo(2)),
        msg("inbound", "sem data", null as any),
      ],
      [],
      []
    );
    expect(out.map((m) => m.texto)).toEqual(["primeiro", null]);
    expect(out[1].anexo).toBe("image");
    expect(JSON.stringify(out)).not.toContain("cdn/secret");
  });

  it("evidence is only successful sends; failed and backfilled rows prove nothing", () => {
    const rows: LinhaLocal[] = [
      { direction: "outbound", text: "a", attachments: null, platform_message_id: null, sent_by_flow_id: "f", status: "sent", created_at: hoursAgo(3) },
      { direction: "outbound", text: "b", attachments: null, platform_message_id: null, sent_by_flow_id: "f", status: "failed", created_at: hoursAgo(3) },
      { direction: "outbound", text: "c", attachments: null, platform_message_id: "z1", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(3) },
      { direction: "inbound", text: "d", attachments: null, platform_message_id: "z2", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(3) },
    ];
    expect(automacoesDe(rows).map((r) => r.text)).toEqual(["a"]);
  });

  it("the local thread drops failed sends and backfilled copies of automated ones", () => {
    const rows: LinhaLocal[] = [
      { direction: "inbound", text: "quero", attachments: null, platform_message_id: "z1", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(3) },
      { direction: "outbound", text: "Aqui o guia", attachments: null, platform_message_id: null, sent_by_flow_id: "f", status: "sent", created_at: hoursAgo(2.99) },
      { direction: "outbound", text: "Aqui o guia", attachments: null, platform_message_id: "z2", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(2.98) },
      { direction: "outbound", text: "falhou", attachments: null, platform_message_id: null, sent_by_flow_id: "f", status: "failed", created_at: hoursAgo(2.9) },
      { direction: "outbound", text: "respondi à mão", attachments: null, platform_message_id: "z3", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(2) },
    ];
    const out = classificar(threadLocal(rows), automacoesDe(rows), []);
    expect(out.map((m) => [m.direcao, m.texto])).toEqual([
      ["contato", "quero"],
      ["automacao", "Aqui o guia"],
      ["pessoa", "respondi à mão"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shape and refusals
// ---------------------------------------------------------------------------

describe("one conversation as the routine sees it", () => {
  it("carries only the opaque id and the derived facts", () => {
    const mensagens = classificar([msg("inbound", "oi", hoursAgo(1))], [], []);
    const c = montarConversa({ id: CONV, lastMessageAt: hoursAgo(1), pausada: false, tags: ["b", "a", "a"], fonte: "zernio", mensagens, ultimaInboundLocal: null, now: NOW });
    expect(Object.keys(c).sort()).toEqual(
      ["aguardando_resposta", "fonte", "id", "janela_aberta", "janela_fecha_em", "mensagens", "mensagens_omitidas", "pausada", "tags", "ultima_do_contato_em", "ultima_mensagem_em"].sort()
    );
    expect(c).toMatchObject({ id: CONV, janela_aberta: true, aguardando_resposta: true, tags: ["a", "b"], mensagens_omitidas: 0 });
  });

  it("keeps the newest 30 messages and counts the rest", () => {
    const thread = Array.from({ length: 35 }, (_, i) => msg("inbound", `m${i}`, hoursAgo(40 - i)));
    const c = montarConversa({ id: CONV, lastMessageAt: null, pausada: false, tags: [], fonte: "zernio", mensagens: classificar(thread, [], []), ultimaInboundLocal: null, now: NOW });
    expect(c.mensagens).toHaveLength(30);
    expect(c.mensagens_omitidas).toBe(5);
    expect(c.mensagens[29].texto).toBe("m34");
  });

  it("uses our own inbound record when Zernio's thread is behind", () => {
    const c = montarConversa({ id: CONV, lastMessageAt: null, pausada: false, tags: [], fonte: "zernio", mensagens: classificar([msg("inbound", "oi", hoursAgo(30))], [], []), ultimaInboundLocal: hoursAgo(1), now: NOW });
    expect(c.ultima_do_contato_em).toBe(hoursAgo(1));
    expect(c.janela_aberta).toBe(true);
  });
});

describe("when a reply is refused", () => {
  const base = { ultimaInboundLocal: null, enviosCentralDepois: 0, now: NOW };
  const motivo = (p: Partial<Parameters<typeof motivoParaNaoResponder>[0]> & { mensagens: any[] }) =>
    motivoParaNaoResponder({ ...base, pausada: false, ...p })?.motivo ?? null;

  it("paused wins over everything", () => {
    expect(motivo({ pausada: true, mensagens: classificar([msg("inbound", "oi", hoursAgo(1))], [], []) })).toBe("conversa_pausada");
  });
  it("outside the window, or with no inbound at all", () => {
    expect(motivo({ mensagens: classificar([msg("inbound", "oi", hoursAgo(30))], [], []) })).toBe("fora_da_janela");
    expect(motivo({ mensagens: [] })).toBe("fora_da_janela");
  });
  it("when a person or the Central already answered the last message", () => {
    const answered = classificar([msg("inbound", "oi", hoursAgo(2)), msg("outbound", "oi!", hoursAgo(1))], [], []);
    expect(motivo({ mensagens: answered })).toBe("ja_respondida");
    expect(motivo({ mensagens: classificar([msg("inbound", "oi", hoursAgo(2))], [], []), enviosCentralDepois: 1 })).toBe("ja_respondida_pela_central");
  });
  it("lets it through when only the bot answered, or the person wrote again", () => {
    const bot = classificar(
      [msg("inbound", "SS", hoursAgo(2)), msg("outbound", "Aqui o guia", hoursAgo(2), { platformMessageId: "m" })],
      [{ platformMessageId: "m", text: "Aqui o guia", createdAt: hoursAgo(2) }],
      []
    );
    expect(motivo({ mensagens: bot })).toBeNull();
    const again = classificar([msg("inbound", "oi", hoursAgo(3)), msg("outbound", "oi!", hoursAgo(2)), msg("inbound", "e aí?", hoursAgo(1))], [], []);
    expect(motivo({ mensagens: again })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The store, against a recording database and a fake Zernio
// ---------------------------------------------------------------------------

interface Op {
  table: string;
  op: string;
  payload?: any;
  filters: string[];
}

type Resolver = (op: Op) => { data: any; error: any };

function fakeDb(resolve: Resolver) {
  const ops: Op[] = [];
  function chain(table: string, op: string, payload?: unknown) {
    const rec: Op = { table, op, payload, filters: [] };
    ops.push(rec);
    const c: Record<string, any> = {
      then: (res: any, rej: any) => Promise.resolve(resolve(rec)).then(res, rej),
      single: () => Promise.resolve(resolve(rec)).then((r) => (Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r)),
      maybeSingle: () => Promise.resolve(resolve(rec)).then((r) => (Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r)),
    };
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      c[m] = (...args: unknown[]) => {
        rec.filters.push(`${m}:${JSON.stringify(args)}`);
        return c;
      };
    }
    return c;
  }
  const client = {
    from: (table: string) => ({
      select: (cols?: string) => chain(table, "select").select(cols),
      insert: (p: unknown) => chain(table, "insert", p),
      update: (p: unknown) => chain(table, "update", p),
      upsert: (p: unknown) => chain(table, "upsert", p),
      delete: () => chain(table, "delete"),
    }),
  };
  return { client: client as any, ops };
}

const igConversation = {
  id: CONV,
  contact_id: "c1",
  platform: "instagram",
  late_conversation_id: "zconv1",
  last_message_at: hoursAgo(1),
  is_automation_paused: false,
  channels: { late_account_id: "zacc1" },
};

function fakeProvider(thread: MensagemDaConversa[], opts: { sendFails?: boolean; readFails?: boolean } = {}) {
  const sent: any[] = [];
  const provider = {
    name: "zernio" as const,
    getConversationMessages: vi.fn(async () => {
      if (opts.readFails) throw new Error("Rate limit exceeded");
      // What Zernio really hands back carries the participant; none of it may leak.
      return thread.map((m) => ({ ...m, sender: { username: "ana.silva", name: "Ana Silva", id: "17841400000000001" } }));
    }),
    sendMessage: vi.fn(async (p: any) => {
      if (opts.sendFails) throw new Error("outside window");
      sent.push(p);
      return { messageId: "mid.new" };
    }),
  };
  return { provider, sent, factory: () => provider as any };
}

function resolverFor(overrides: {
  conversation?: any;
  conversations?: any[];
  messages?: any[];
  sends?: any[];
  insertError?: any;
  existingByKey?: any;
  claimed?: any[];
} = {}): Resolver {
  return (op) => {
    if (op.table === "workspaces") return { data: { late_api_key_encrypted: "plain-key" }, error: null };
    if (op.table === "conversations" && op.op === "select") {
      if (overrides.conversations) return { data: overrides.conversations, error: null };
      return { data: overrides.conversation === undefined ? igConversation : overrides.conversation, error: null };
    }
    if (op.table === "messages") return { data: overrides.messages ?? [], error: null };
    if (op.table === "contact_tags") return { data: [{ contact_id: "c1", tags: { name: "lead-ss" } }], error: null };
    if (op.table === "central_dm_sends") {
      if (op.op === "insert") return overrides.insertError ? { data: null, error: overrides.insertError } : { data: { id: "envio-1" }, error: null };
      if (op.op === "select" && op.filters.some((f) => f.startsWith('eq:["chave"'))) return { data: overrides.existingByKey ?? null, error: null };
      if (op.op === "select") return { data: overrides.sends ?? [], error: null };
      if (op.op === "update" && op.filters.some((f) => f.startsWith("select"))) return { data: overrides.claimed ?? [], error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
}

const pedido = { conversa: CONV, texto: "Oi! Te explico sim.", chave: "k1" };

describe("sending a reply", () => {
  it("sends through Zernio as plain text and records only what the inbox records", async () => {
    const db = fakeDb(resolverFor());
    const z = fakeProvider([msg("inbound", "Como funciona o super?", hoursAgo(1))]);
    const out = await responder(db.client, WS, pedido, { now: NOW, provider: z.factory });

    expect(out).toMatchObject({ enviado: true, conversa: CONV, envio: "envio-1", chave: "k1" });
    expect(z.sent).toEqual([{ accountId: "zacc1", conversationId: "zconv1", message: { text: "Oi! Te explico sim." } }]);

    const writes = db.ops.filter((o) => o.op !== "select");
    expect(writes.map((o) => `${o.table}:${o.op}`)).toEqual([
      "central_dm_sends:insert",
      "central_dm_sends:update",
      "conversations:update",
    ]);
    expect(writes[0].payload).toMatchObject({ workspace_id: WS, conversation_id: CONV, chave: "k1", status: "enviando" });
    expect(writes[1].payload).toMatchObject({ status: "enviado", platform_message_id: "mid.new" });
    expect(Object.keys(writes[2].payload).sort()).toEqual(["last_message_at", "last_message_preview"]);
  });

  it("refuses a conversation outside the workspace, and one that is not Instagram", async () => {
    const z = fakeProvider([]);
    await expect(responder(fakeDb(resolverFor({ conversation: null })).client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 404 });
    await expect(
      responder(fakeDb(resolverFor({ conversation: { ...igConversation, platform: "whatsapp" } })).client, WS, pedido, { now: NOW, provider: z.factory })
    ).rejects.toMatchObject({ status: 400, motivo: "nao_e_instagram" });
    expect(z.provider.getConversationMessages).not.toHaveBeenCalled();
  });

  it("refuses a paused conversation without even reading Zernio", async () => {
    const db = fakeDb(resolverFor({ conversation: { ...igConversation, is_automation_paused: true } }));
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(1))]);
    await expect(responder(db.client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 409, motivo: "conversa_pausada" });
    expect(z.provider.getConversationMessages).not.toHaveBeenCalled();
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("refuses outside the 24-hour window and writes nothing", async () => {
    const db = fakeDb(resolverFor());
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(26))]);
    await expect(responder(db.client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 409, motivo: "fora_da_janela" });
    expect(z.sent).toEqual([]);
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("refuses when someone already answered by hand", async () => {
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(2)), msg("outbound", "Oi! Já te respondo", hoursAgo(1))]);
    await expect(responder(fakeDb(resolverFor()).client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ motivo: "ja_respondida" });
    expect(z.sent).toEqual([]);
  });

  it("refuses when Zernio cannot be read, rather than send blind", async () => {
    const z = fakeProvider([], { readFails: true });
    await expect(responder(fakeDb(resolverFor()).client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 502 });
    expect(z.sent).toEqual([]);
  });

  it("refuses the same chave inside 24 hours", async () => {
    const db = fakeDb(
      resolverFor({ insertError: { code: "23505", message: "duplicate" }, existingByKey: { id: "e0", status: "enviado", created_at: hoursAgo(3) } })
    );
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(1))]);
    await expect(responder(db.client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 409, motivo: "chave_repetida" });
    expect(z.sent).toEqual([]);
  });

  it("lets a chave be reused after 24 hours or after a failed send, claiming the row conditionally", async () => {
    for (const existing of [
      { id: "e0", status: "enviado", created_at: hoursAgo(30) },
      { id: "e0", status: "falhou", created_at: hoursAgo(1) },
    ]) {
      const db = fakeDb(resolverFor({ insertError: { code: "23505" }, existingByKey: existing, claimed: [{ id: "e0" }] }));
      const z = fakeProvider([msg("inbound", "oi", hoursAgo(1))]);
      const out = await responder(db.client, WS, pedido, { now: NOW, provider: z.factory });
      expect(out.envio).toBe("e0");
      const claim = db.ops.find((o) => o.op === "update" && o.payload.status === "enviando")!;
      expect(claim.filters).toContain(`eq:["status","${existing.status}"]`);
      expect(z.sent).toHaveLength(1);
    }
  });

  it("asks for the migration when the table is missing, before sending anything", async () => {
    const db = fakeDb(resolverFor({ insertError: { code: "42P01", message: 'relation "central_dm_sends" does not exist' } }));
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(1))]);
    await expect(responder(db.client, WS, { ...pedido, chave: null }, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 503, motivo: "migracao_pendente" });
    expect(z.sent).toEqual([]);
  });

  it("marks the send failed when Zernio refuses it, so the chave can be retried", async () => {
    const db = fakeDb(resolverFor());
    const z = fakeProvider([msg("inbound", "oi", hoursAgo(1))], { sendFails: true });
    await expect(responder(db.client, WS, pedido, { now: NOW, provider: z.factory })).rejects.toMatchObject({ status: 502, motivo: "envio_falhou" });
    const writes = db.ops.filter((o) => o.op !== "select");
    expect(writes.map((o) => `${o.table}:${o.op}:${o.payload.status ?? ""}`)).toEqual(["central_dm_sends:insert:enviando", "central_dm_sends:update:falhou"]);
  });
});

describe("listing conversations", () => {
  it("returns no identifying field, only the opaque id, and labels the messages", async () => {
    const db = fakeDb(
      resolverFor({
        conversations: [igConversation],
        messages: [
          { direction: "outbound", text: "Aqui o guia", attachments: null, platform_message_id: "mid.1", sent_by_flow_id: "f", status: "sent", created_at: hoursAgo(3) },
          { direction: "inbound", text: "SS", attachments: null, platform_message_id: "z0", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(3.01) },
        ],
      })
    );
    const z = fakeProvider([
      msg("inbound", "SS", hoursAgo(3.01)),
      msg("outbound", "Aqui o guia", hoursAgo(3), { platformMessageId: "mid.1", id: "zmsg1" }),
      msg("outbound", "Oi! Sou eu, o Thiago", hoursAgo(2), { id: "zmsg2" }),
      msg("inbound", "Que legal!", hoursAgo(1)),
    ]);
    const out = await listarConversas(db.client, WS, { dias: 2, limite: 50, now: NOW, provider: z.factory });

    expect(out.conversas).toHaveLength(1);
    const c = out.conversas[0];
    expect(c).toMatchObject({ id: CONV, fonte: "zernio", janela_aberta: true, pausada: false, aguardando_resposta: true, tags: ["lead-ss"] });
    expect(c.mensagens.map((m) => m.direcao)).toEqual(["contato", "automacao", "pessoa", "contato"]);

    const json = JSON.stringify(out);
    for (const leak of ["ana.silva", "Ana Silva", "17841400000000001", "zconv1", "zacc1", "c1", "zmsg1", "mid.1"]) {
      expect(json).not.toContain(leak);
    }
    // Only Instagram, newest first, within the days asked.
    const q = db.ops.find((o) => o.table === "conversations")!;
    expect(q.filters).toContain('eq:["platform","instagram"]');
    expect(q.filters).toContain(`gte:["last_message_at","${hoursAgo(48)}"]`);
    expect(q.filters).toContain('order:["last_message_at",{"ascending":false}]');
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
  });

  it("falls back to our own table when Zernio rate-limits, and says so", async () => {
    const db = fakeDb(
      resolverFor({
        conversations: [igConversation],
        messages: [{ direction: "inbound", text: "oi", attachments: null, platform_message_id: "z0", sent_by_flow_id: null, status: "delivered", created_at: hoursAgo(1) }],
      })
    );
    const z = fakeProvider([], { readFails: true });
    const out = await listarConversas(db.client, WS, { dias: 2, limite: 50, now: NOW, provider: z.factory });
    expect(out.conversas[0]).toMatchObject({ fonte: "local", janela_aberta: true });
    expect(out.conversas[0].mensagens.map((m) => m.texto)).toEqual(["oi"]);
    expect(out.avisos.join(" ")).toMatch(/limitou/);
  });
});

// ---------------------------------------------------------------------------
// The DM door's reach, held in its own source
// ---------------------------------------------------------------------------

describe("the DM door", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = [
    "app/api/v1/central/conversas/route.ts",
    "app/api/v1/central/responder/route.ts",
    "lib/central-agent/dm.ts",
    "lib/central-agent/dm-store.ts",
  ].map((f) => [f, readFileSync(join(ROOT, f), "utf8")] as const);

  it("reads only these tables", () => {
    for (const [where, src] of files) {
      const tables = [...src.matchAll(/\.from\(["'](\w+)["']\)/g)].map((m) => m[1]);
      for (const t of tables) {
        expect(["conversations", "messages", "contact_tags", "workspaces", "central_dm_sends"], `${where}: ${t}`).toContain(t);
      }
    }
  });

  it("writes only its own table and the conversation's last-message fields", () => {
    for (const [where, src] of files) {
      expect(src, where).not.toMatch(/\.upsert\(|\.delete\(|\.rpc\(/);
      for (const m of src.matchAll(/\.from\(["'](\w+)["']\)\s*\.(insert|update)\(/g)) {
        expect(["central_dm_sends", "conversations"], `${where}: ${m[1]}.${m[2]}`).toContain(m[1]);
        if (m[1] === "conversations") expect(m[2], where).toBe("update");
      }
      const convUpdates = [...src.matchAll(/\.from\(["']conversations["']\)\s*\.update\(\{([^}]*)\}/g)];
      for (const u of convUpdates) {
        const keys = [...u[1].matchAll(/(\w+):/g)].map((k) => k[1]).sort();
        expect(keys, where).toEqual(["last_message_at", "last_message_preview"]);
      }
    }
  });

  it("never runs a flow, changes the pause, or sends with the human-agent tag", () => {
    for (const [where, src] of files) {
      expect(src, where).not.toMatch(/executeFlow|humanAgent|is_automation_paused:\s*(true|false)|sendPrivateReply|replyToComment/);
      expect(src, where).not.toMatch(/\.from\(["'](flows|triggers|contacts|flow_sessions|scheduled_jobs|tags)["']\)/);
    }
  });
});
