import type { SupabaseClient } from "@supabase/supabase-js";
import { Recusa } from "./dm";

/**
 * Leads from the link-in-bio quiz (thiagoborrelli.com/links-bio/), as the
 * Central's routine may see them. Read-only.
 *
 * The quiz asks five questions, recommends a product and asks for consent to
 * be told about new content or services. Nothing read this table, so Rafa
 * asked (22/11/2026) for Marina to sort the leads by how likely they are to
 * buy, so a later stage can contact the ones who said yes.
 *
 * What leaves: our own numeric id, when the lead came in, the first name, the
 * five answers in Portuguese, the recommended product and alternatives, the
 * consent (yes/no, when, the exact question) and where they came from
 * (utm_source/medium/campaign). What never leaves: surname, email, WhatsApp,
 * user agent, referrer, landing URL and the raw scores. Contact details stay
 * here until the stage that contacts people is built and approved.
 *
 * The tier is a fixed rule (`classificar`), not a judgement, so the same lead
 * is always in the same tier and changing the rule is a reviewed change here.
 */

export const DIAS_PADRAO = 7;
/** Enough for the first run to see every lead the quiz ever collected. */
export const DIAS_MAX = 1000;
export const LIMITE_PADRAO = 200;
export const LIMITE_MAX = 2000;
/** Older than this is flagged `antigo`. */
export const ANTIGO_DIAS = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

const PERGUNTAS = {
  p1: {
    chave: "momento",
    opcoes: {
      sem_controle: "Ainda não tenho controle do que entra e do que sai",
      nao_sobra: "Tenho controle, mas não consigo fazer sobrar",
      parado: "Sobra dinheiro e ele está parado na conta, sem render",
      sem_plano: "Já invisto alguma coisa, mas sem um plano que faça sentido pro meu objetivo",
      protecao: "O que me preocupa é o que aconteceria com a minha família se algo acontecesse comigo",
    },
  },
  p2: {
    chave: "situacao",
    opcoes: {
      so_eu: "Ninguém depende financeiramente de mim",
      so_eu_com_dependentes: "Sou solteiro(a), mas tenho pessoas que dependem de mim",
      casal: "Sou casado(a) ou moro com meu parceiro(a), sem filhos",
      casal_com_dependentes: "Sou casado(a) ou moro com meu parceiro(a), com filhos ou dependentes",
    },
  },
  p3: {
    chave: "ajuda",
    opcoes: {
      basico_ritmo: "Quero aprender o básico e ir avançando no meu ritmo",
      acesso_tudo: "Quero ter acesso a todos os seus cursos e montar minha própria trilha de estudos",
      thiago_olhando: "Quero você olhando o meu caso específico e me dizendo o que fazer",
    },
  },
  p4: {
    chave: "patrimonio",
    opcoes: {
      ate_5k: "Menos de $5,000",
      "5k_50k": "$5,000 a $50,000",
      "50k_150k": "$50,000 a $150,000",
      acima_150k: "Mais de $150,000",
    },
  },
  p5: {
    chave: "renda_lar_semana",
    opcoes: {
      ate_1k: "Até $1,000",
      "1k_2k": "$1,000 a $2,000",
      "2k_3_5k": "$2,000 a $3,500",
      acima_3_5k: "Mais de $3,500",
    },
  },
} as const;

export const PRODUTOS: Record<string, string> = {
  a_call: "Financial Adviser",
  b_mci: "Método Casal Imparável",
  c_seguro: "Seguros",
  d_rd: "Renda em Dólar",
  e_clube: "Clube dos Sharks",
  f_super: "SmartSuper",
};

export type Faixa = "quente" | "morno" | "sem_contato";

export interface LinhaLead {
  id: number | string;
  created_at: string | null;
  nome: string | null;
  p1: string | null;
  p2: string | null;
  p3: string | null;
  p4: string | null;
  p5: string | null;
  servico_recomendado: string | null;
  servicos_alternativos: unknown;
  aceita_contato: boolean | null;
  consentimento_em: string | null;
  consentimento_texto: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

/** The columns read. Contact details are not among them. */
export const COLUNAS =
  "id, created_at, nome, p1, p2, p3, p4, p5, servico_recomendado, servicos_alternativos, aceita_contato, consentimento_em, consentimento_texto, utm_source, utm_medium, utm_campaign";

export interface Lead {
  id: string;
  criado_em: string | null;
  primeiro_nome: string | null;
  respostas: Record<string, string | null>;
  produto_recomendado: string | null;
  alternativas: string[];
  aceita_contato: boolean;
  consentimento_em: string | null;
  consentimento_texto: string | null;
  origem: { source: string | null; medium: string | null; campaign: string | null };
  faixa: Faixa;
  motivos: string[];
  antigo: boolean;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function inteiro(raw: string | null, padrao: number, max: number, nome: string): number {
  if (raw === null || raw.trim() === "") return padrao;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Recusa(400, "parametro_invalido", `${nome} precisa ser um número inteiro de 1 a ${max}.`);
  }
  return Math.min(n, max);
}

/** `?dias=N&limite=M`, defaulted and capped. Above the cap is clamped, not refused. */
export function lerParametrosLeads(params: URLSearchParams): { dias: number; limite: number } {
  return {
    dias: inteiro(params.get("dias"), DIAS_PADRAO, DIAS_MAX, "dias"),
    limite: inteiro(params.get("limite"), LIMITE_PADRAO, LIMITE_MAX, "limite"),
  };
}

// ---------------------------------------------------------------------------
// The tier (Rafa, 22/11/2026)
// ---------------------------------------------------------------------------

/**
 * quente: said yes to contact and shows at least one buying signal: wants
 *   Thiago looking at their own case, has $50k+ saved or invested, or the
 *   household earns $2,000+ a week.
 * morno: said yes, no signal.
 * sem_contato: did not say yes (or never answered). Counted, never contacted.
 */
export function classificar(l: Pick<LinhaLead, "aceita_contato" | "p3" | "p4" | "p5">): {
  faixa: Faixa;
  motivos: string[];
} {
  const motivos: string[] = [];
  if (l.p3 === "thiago_olhando") motivos.push("quer o Thiago olhando o caso dele");
  if (l.p4 === "50k_150k" || l.p4 === "acima_150k") motivos.push("tem $50 mil ou mais guardados ou investidos");
  if (l.p5 === "2k_3_5k" || l.p5 === "acima_3_5k") motivos.push("renda do lar de $2.000 ou mais por semana");

  if (l.aceita_contato !== true) return { faixa: "sem_contato", motivos };
  return { faixa: motivos.length > 0 ? "quente" : "morno", motivos };
}

function primeiroNome(nome: string | null): string | null {
  const first = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  return Array.from(first).slice(0, 30).join("");
}

function resposta(p: keyof typeof PERGUNTAS, valor: string | null): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const opcoes = PERGUNTAS[p].opcoes as Record<string, string>;
  return opcoes[valor] ?? valor;
}

function produto(chave: unknown): string | null {
  if (typeof chave !== "string" || !chave) return null;
  return PRODUTOS[chave] ?? chave;
}

export function montarLead(l: LinhaLead, agora: Date): Lead {
  const respostas: Record<string, string | null> = {};
  for (const p of Object.keys(PERGUNTAS) as Array<keyof typeof PERGUNTAS>) {
    respostas[PERGUNTAS[p].chave] = resposta(p, l[p]);
  }
  const alternativas = Array.isArray(l.servicos_alternativos)
    ? l.servicos_alternativos.map(produto).filter((x): x is string => x !== null)
    : [];
  const criado = l.created_at ? Date.parse(l.created_at) : NaN;
  const { faixa, motivos } = classificar(l);
  return {
    id: String(l.id),
    criado_em: l.created_at,
    primeiro_nome: primeiroNome(l.nome),
    respostas,
    produto_recomendado: produto(l.servico_recomendado),
    alternativas,
    aceita_contato: l.aceita_contato === true,
    consentimento_em: l.consentimento_em,
    consentimento_texto: l.consentimento_texto,
    origem: { source: l.utm_source, medium: l.utm_medium, campaign: l.utm_campaign },
    faixa,
    motivos,
    antigo: Number.isFinite(criado) ? agora.getTime() - criado > ANTIGO_DIAS * DIA_MS : false,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listarLeads(
  db: SupabaseClient,
  { dias, limite }: { dias: number; limite: number },
  agora: Date = new Date()
) {
  const desde = new Date(agora.getTime() - dias * DIA_MS).toISOString();
  const { data, error } = await db
    .from("link_bio_leads")
    .select(COLUNAS)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);

  const leads = ((data ?? []) as unknown as LinhaLead[]).map((l) => montarLead(l, agora));
  const contagem = { quente: 0, morno: 0, sem_contato: 0 };
  for (const l of leads) contagem[l.faixa] += 1;
  return { desde, total: leads.length, cortado: leads.length >= limite, contagem, leads };
}
