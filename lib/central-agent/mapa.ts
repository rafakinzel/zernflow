import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CENTRAL_CREATED_VIA, cleanKeyword, keywordKey, keywordMatches } from "./flow-template";
import { listKeywords, type KeywordEntry, type KeywordMatch } from "./store";

/**
 * What the Central TB's routines read before they touch the BorrelliChat.
 *
 * Rafa's rule: whoever prepares a flow has to see what already runs every
 * day, so a new keyword never steals comments from an existing flow and a new
 * flow points at the one that already does the job instead of duplicating it.
 * Everything here is read-only.
 */

type Db = SupabaseClient<Database>;
type Node = { id?: string; type?: string; data?: Record<string, any> };
type Edge = { source?: string; target?: string; sourceHandle?: string | null };

export interface MapaPasso {
  tipo: string;
  resumo: string;
}

export interface MapaFlow {
  id: string;
  nome: string;
  descricao: string | null;
  status: string;
  /** Answers today: published and with at least one active trigger. */
  noAr: boolean;
  criadoPelaCentral: boolean;
  atualizado: string | null;
  gatilhos: Array<{ tipo: string; ativo: boolean | null; palavras: KeywordMatch[]; detalhe?: string }>;
  /** Every node, in reading order from the trigger, in plain words. */
  passos: MapaPasso[];
  /** Flows this one hands the person to (Go to flow nodes). */
  levaPara: Array<{ id: string; nome: string }>;
  /** Keywords of other flows that this flow's messages invite the person to send. */
  convidaPara: Array<{ palavra: string; flowId: string; nome: string }>;
  links: string[];
}

export interface Mapa {
  geradoEm: string;
  flows: MapaFlow[];
  ligacoes: Array<{ de: string; para: string; como: "vai_para_flow" | "convite_no_texto"; palavra?: string }>;
  palavras: KeywordEntry[];
}

const cut = (t: unknown, n = 160): string => {
  const s = typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const URL_RE = /https?:\/\/[^\s)"'<>]+/g;
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

/** One line per node, in Portuguese, for someone who never opened the builder. */
export function resumirPasso(node: Node, nomes: Map<string, string>): MapaPasso {
  const d = node.data ?? {};
  const tipo = node.type ?? "desconhecido";
  switch (tipo) {
    case "trigger": {
      const kws = Array.isArray(d.keywords) ? d.keywords.map((k: any) => (typeof k === "string" ? k : `${k?.value} (${k?.matchType ?? "contains"})`)).join(", ") : "";
      const qual: Record<string, string> = { comment_keyword: "comentário", keyword: "mensagem no direct", welcome: "primeira mensagem", default: "qualquer mensagem sem outro gatilho", postback: "botão", quick_reply: "resposta rápida" };
      return { tipo, resumo: `Começa com ${qual[d.triggerType] ?? d.triggerType ?? "gatilho"}${kws ? `: ${kws}` : ""}` };
    }
    case "sendMessage": {
      const msgs = Array.isArray(d.messages) ? d.messages : [];
      const partes = msgs.map((m: any) => {
        const bits: string[] = [];
        if (m?.text) bits.push(`"${cut(m.text)}"`);
        if (m?.imageUrl) bits.push("[imagem]");
        if (Array.isArray(m?.buttons) && m.buttons.length) bits.push(`botões: ${m.buttons.map((b: any) => (b?.type === "url" ? `${b?.title} → ${b?.url}` : b?.title)).join(" | ")}`);
        if (Array.isArray(m?.quickReplies) && m.quickReplies.length) bits.push(`respostas rápidas: ${m.quickReplies.map((q: any) => q?.title).join(" | ")}`);
        if (m?.carousel?.elements?.length) bits.push(`carrossel com ${m.carousel.elements.length} cards`);
        return bits.join(" ");
      });
      const espera = d.waitForReply ? ` Espera a resposta${d.timeout ? ` por até ${d.timeout} ${d.timeoutUnit ?? ""}`.trimEnd() : ""}.` : "";
      return { tipo, resumo: `Manda ${msgs.length === 1 ? "a mensagem" : `${msgs.length} mensagens`}: ${partes.join(" / ")}.${espera}` };
    }
    case "condition":
      return { tipo, resumo: `Confere: ${(Array.isArray(d.conditions) ? d.conditions : []).map((c: any) => `${c?.field} ${c?.operator} ${c?.value ?? ""}`.trim()).join(d.logic === "or" ? " ou " : " e ")}` };
    case "delay":
      return { tipo, resumo: `Espera ${d.duration ?? "?"} ${d.unit ?? ""}`.trim() };
    case "smartDelay":
      return { tipo, resumo: `Espera a pessoa responder, até ${d.timeout ?? "?"} ${d.timeoutUnit ?? ""}`.trim() };
    case "addTag":
    case "removeTag":
      return { tipo, resumo: `${tipo === "addTag" || d.action === "add" ? "Põe" : "Tira"} a tag "${d.tagName ?? "?"}"` };
    case "setCustomField":
      return { tipo, resumo: `Grava o campo ${d.fieldSlug ?? "?"} = ${cut(d.value, 60)}` };
    case "httpRequest": {
      let host = "";
      try { host = new URL(String(d.url)).host; } catch { host = cut(d.url, 60); }
      return { tipo, resumo: `Chama um sistema externo (${d.method ?? "GET"} ${host})` };
    }
    case "activeCampaign":
      return { tipo, resumo: `Manda o contato para o ActiveCampaign${d.listId ? ` (lista ${d.listId})` : ""}` };
    case "goToFlow":
      return { tipo, resumo: `Leva para o flow "${nomes.get(d.flowId) ?? d.flowId ?? "?"}"` };
    case "humanTakeover":
      return { tipo, resumo: "Pausa a automação e passa a conversa para atendimento humano" };
    case "subscribe":
    case "unsubscribe":
      return { tipo, resumo: tipo === "subscribe" ? "Inscreve o contato" : "Descadastra o contato" };
    case "commentReply":
      return { tipo, resumo: `Responde o comentário em público: "${cut(d.text)}"` };
    case "privateReply":
      return { tipo, resumo: `Responde no direct: "${cut(d.text)}"` };
    case "aiResponse":
      return { tipo, resumo: "Responde com IA" };
    case "abSplit":
      return { tipo, resumo: `Divide em teste A/B: ${(Array.isArray(d.paths) ? d.paths : []).map((p: any) => `${p?.name} ${p?.weight}%`).join(", ")}` };
    case "enrollSequence":
      return { tipo, resumo: `Coloca numa sequência de mensagens (${d.sequenceId ?? "?"})` };
    default:
      return { tipo, resumo: `Passo do tipo ${tipo}` };
  }
}

/** Nodes in reading order: from each trigger along the edges, then anything left over. */
function emOrdem(nodes: Node[], edges: Edge[]): Node[] {
  const byId = new Map(nodes.filter((n) => n?.id).map((n) => [n.id as string, n]));
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (!e?.source || !e?.target) continue;
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const seen = new Set<string>();
  const out: Node[] = [];
  const fila = nodes.filter((n) => n?.type === "trigger").map((n) => n.id as string);
  while (fila.length) {
    const id = fila.shift() as string;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n) out.push(n);
    fila.push(...(next.get(id) ?? []));
  }
  for (const n of nodes) if (n?.id && !seen.has(n.id)) out.push(n);
  return out;
}

export async function buildMapa(db: Db, workspaceId: string): Promise<Mapa> {
  const { data: flows, error } = await db
    .from("flows")
    .select("id, name, description, status, nodes, edges, created_via, updated_at")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  const ids = (flows ?? []).map((f) => f.id);
  const { data: triggers, error: tErr } = ids.length
    ? await db.from("triggers").select("id, flow_id, type, config, is_active").in("flow_id", ids)
    : { data: [], error: null };
  if (tErr) throw new Error(tErr.message);

  const palavras = await listKeywords(db, workspaceId);
  const nomes = new Map((flows ?? []).map((f) => [f.id, f.name]));
  // DM keywords that answer today: the only way a comment flow can hand someone on
  const dmNoAr = new Map(
    palavras.filter((p) => p.type === "keyword" && p.live).map((p) => [keywordKey(p.keyword), p])
  );

  const ligacoes: Mapa["ligacoes"] = [];
  const out: MapaFlow[] = (flows ?? []).map((f) => {
    const nodes = (Array.isArray(f.nodes) ? f.nodes : []) as Node[];
    const edges = (Array.isArray(f.edges) ? f.edges : []) as Edge[];
    const ts = (triggers ?? []).filter((t) => t.flow_id === f.id);
    const ordem = emOrdem(nodes, edges);
    const passos = ordem.map((n) => resumirPasso(n, nomes));

    const levaPara = ordem
      .filter((n) => n.type === "goToFlow" && n.data?.flowId)
      .map((n) => ({ id: String(n.data!.flowId), nome: nomes.get(String(n.data!.flowId)) ?? String(n.data!.flowId) }));
    for (const l of levaPara) ligacoes.push({ de: f.id, para: l.id, como: "vai_para_flow" });

    const textos = ordem.flatMap((n) => {
      const d = n.data ?? {};
      if (n.type === "sendMessage") return (Array.isArray(d.messages) ? d.messages : []).flatMap((m: any) => [m?.text ?? "", ...(Array.isArray(m?.buttons) ? m.buttons.map((b: any) => b?.url ?? "") : [])]);
      if (n.type === "privateReply" || n.type === "commentReply") return [d.text ?? ""];
      return [];
    }).join("\n");

    const convidaPara: MapaFlow["convidaPara"] = [];
    for (const m of textos.matchAll(HASHTAG_RE)) {
      const alvo = dmNoAr.get(keywordKey(m[1]));
      if (alvo && alvo.flowId !== f.id && !convidaPara.some((c) => c.flowId === alvo.flowId)) {
        convidaPara.push({ palavra: `#${cleanKeyword(alvo.keyword)}`, flowId: alvo.flowId, nome: alvo.flowName });
        ligacoes.push({ de: f.id, para: alvo.flowId, como: "convite_no_texto", palavra: `#${cleanKeyword(alvo.keyword)}` });
      }
    }

    return {
      id: f.id,
      nome: f.name,
      descricao: f.description ?? null,
      status: f.status,
      noAr: f.status === "published" && ts.some((t) => t.is_active),
      criadoPelaCentral: f.created_via === CENTRAL_CREATED_VIA,
      atualizado: f.updated_at ?? null,
      gatilhos: ts.map((t) => {
        const cfg = (t.config ?? {}) as Record<string, any>;
        const lista = Array.isArray(cfg.keywords) ? cfg.keywords : [];
        return {
          tipo: t.type,
          ativo: t.is_active,
          palavras: lista
            .map((k: any) => (typeof k === "string" ? { value: k, matchType: cfg.matchType ?? "contains" } : { value: String(k?.value ?? ""), matchType: String(k?.matchType ?? cfg.matchType ?? "contains") }))
            .filter((k: KeywordMatch) => k.value),
          ...(cfg.payload ? { detalhe: `payload ${cfg.payload}` } : {}),
          ...(Array.isArray(cfg.postIds) && cfg.postIds.length ? { detalhe: `só nos posts ${cfg.postIds.join(", ")}` } : {}),
        };
      }),
      passos,
      levaPara,
      convidaPara,
      links: [...new Set(textos.match(URL_RE) ?? [])],
    };
  });

  out.sort((a, b) => Number(b.noAr) - Number(a.noAr) || a.nome.localeCompare(b.nome));
  return { geradoEm: new Date().toISOString(), flows: out, ligacoes, palavras };
}

// ---------------------------------------------------------------------------
// Keyword collisions
// ---------------------------------------------------------------------------

/** The comment matcher's own rule (lib/comment-processor.ts), on one keyword. */
export function dispara(m: KeywordMatch, comentario: string): boolean {
  const text = comentario.toLowerCase().trim();
  const kw = m.value.toLowerCase();
  if (!text || !kw) return false;
  const tipo = m.matchType || "contains";
  if (tipo === "exact") return text === kw;
  if (tipo === "startsWith") return text.startsWith(kw);
  return text.includes(kw);
}

/** Comments someone would plausibly write to ask for a keyword. */
function comentariosDe(palavra: string): string[] {
  const p = cleanKeyword(palavra);
  // Short on purpose: extra words would carry letters of their own ("por favor" holds "fa").
  return [p, `#${p}`, `#${p} 🙏`];
}

export interface Conflito {
  palavra: string;
  flowId: string;
  flowNome: string;
  noAr: boolean;
  motivo: string;
  exemplo: string;
}

export interface Checagem {
  palavra: string;
  podeCriar: boolean;
  conflitos: Conflito[];
  avisos: string[];
  levaPara?: { palavra: string; flowId: string; flowNome: string } | { erro: string };
}

/**
 * Would a new comment keyword step on an existing one, either way round?
 *
 * Same word, or one that sets the other off: a new `FAMILIA` while `#FA` is
 * matched with `contains` means "#familia" fires both, and the person gets
 * the wrong DM. Tested with the comment matcher's own rule on comments people
 * actually write, not by comparing strings.
 */
export function checarPalavra(palavra: string, existentes: KeywordEntry[], levaPara?: string): Checagem {
  const nova = cleanKeyword(palavra ?? "");
  const minhas = keywordMatches(nova);
  const conflitos: Conflito[] = [];
  const avisos: string[] = [];

  for (const e of existentes) {
    if (e.type === "keyword") {
      if (keywordKey(e.keyword) === keywordKey(nova)) {
        avisos.push(`"${e.keyword}" já é palavra de direct no flow "${e.flowName}". No comentário não conflita, mas quem mandar "${e.keyword}" no direct cai naquele flow.`);
      }
      continue;
    }
    if (e.type !== "comment_keyword") continue;

    if (keywordKey(e.keyword) === keywordKey(nova)) {
      conflitos.push({ palavra: e.keyword, flowId: e.flowId, flowNome: e.flowName, noAr: e.live, motivo: "mesma palavra", exemplo: nova });
      continue;
    }
    // comments asking for the new keyword that the existing one would catch
    const roubaDaNova = comentariosDe(nova).find((c) => e.matches.some((m) => dispara(m, c)));
    if (roubaDaNova) {
      conflitos.push({ palavra: e.keyword, flowId: e.flowId, flowNome: e.flowName, noAr: e.live, motivo: `o comentário "${roubaDaNova}" também dispararia o flow "${e.flowName}"`, exemplo: roubaDaNova });
      continue;
    }
    // comments asking for the existing keyword that the new one would catch
    const roubaDaExistente = comentariosDe(e.keyword).find((c) => minhas.some((m) => dispara(m, c)));
    if (roubaDaExistente) {
      conflitos.push({ palavra: e.keyword, flowId: e.flowId, flowNome: e.flowName, noAr: e.live, motivo: `quem comentar "${roubaDaExistente}" para o flow "${e.flowName}" receberia também o novo`, exemplo: roubaDaExistente });
    }
  }

  let destino: Checagem["levaPara"];
  if (levaPara !== undefined && levaPara !== null && String(levaPara).trim()) {
    const alvo = cleanKeyword(String(levaPara));
    const dm = existentes.find((e) => e.type === "keyword" && keywordKey(e.keyword) === keywordKey(alvo));
    if (!dm) destino = { erro: `Nenhum flow responde a "${alvo}" no direct. Para levar a pessoa a um flow, a palavra precisa ser palavra de direct de um flow publicado.` };
    else if (!dm.live) destino = { erro: `O flow "${dm.flowName}" responde a "${alvo}" no direct, mas não está no ar. Peça à Rafa para publicar antes.` };
    else destino = { palavra: `#${cleanKeyword(dm.keyword)}`, flowId: dm.flowId, flowNome: dm.flowName };
  }

  return {
    palavra: nova,
    podeCriar: Boolean(nova) && conflitos.length === 0 && !(destino && "erro" in destino),
    conflitos,
    avisos,
    ...(destino ? { levaPara: destino } : {}),
  };
}
