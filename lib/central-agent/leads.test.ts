import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUNAS, classificar, lerParametrosLeads, listarLeads, montarLead, type LinhaLead } from "./leads";

const NOW = new Date("2026-11-22T00:00:00Z");

function linha(extra: Partial<LinhaLead> = {}): LinhaLead {
  return {
    id: 1000001,
    created_at: "2026-11-20T10:00:00Z",
    nome: "  Ana Maria Souza ",
    p1: "parado",
    p2: "casal",
    p3: "basico_ritmo",
    p4: "ate_5k",
    p5: "ate_1k",
    servico_recomendado: "d_rd",
    servicos_alternativos: ["e_clube", "b_mci"],
    aceita_contato: true,
    consentimento_em: "2026-11-20T10:01:00Z",
    consentimento_texto: "posso te avisar?",
    utm_source: "instagram",
    utm_medium: "bio",
    utm_campaign: null,
    ...extra,
  };
}

describe("the query", () => {
  it("defaults to 7 days and 200 leads", () => {
    expect(lerParametrosLeads(new URLSearchParams())).toEqual({ dias: 7, limite: 200 });
  });
  it("clamps to 1000 days and 2000 leads", () => {
    expect(lerParametrosLeads(new URLSearchParams("dias=5000&limite=9999"))).toEqual({ dias: 1000, limite: 2000 });
  });
  it("refuses what is not a positive whole number", () => {
    expect(() => lerParametrosLeads(new URLSearchParams("dias=0"))).toThrow();
    expect(() => lerParametrosLeads(new URLSearchParams("limite=abc"))).toThrow();
  });
});

describe("the tier", () => {
  it("no consent is sem_contato, whatever the signals", () => {
    expect(classificar({ aceita_contato: false, p3: "thiago_olhando", p4: "acima_150k", p5: "acima_3_5k" }).faixa).toBe(
      "sem_contato"
    );
    expect(classificar({ aceita_contato: null, p3: null, p4: null, p5: null }).faixa).toBe("sem_contato");
  });
  it("consent and no signal is morno", () => {
    expect(classificar({ aceita_contato: true, p3: "basico_ritmo", p4: "5k_50k", p5: "1k_2k" })).toEqual({
      faixa: "morno",
      motivos: [],
    });
  });
  it("consent and any one signal is quente, with the reason", () => {
    expect(classificar({ aceita_contato: true, p3: "thiago_olhando", p4: "ate_5k", p5: "ate_1k" }).faixa).toBe("quente");
    expect(classificar({ aceita_contato: true, p3: "acesso_tudo", p4: "50k_150k", p5: "ate_1k" }).faixa).toBe("quente");
    expect(classificar({ aceita_contato: true, p3: "acesso_tudo", p4: "ate_5k", p5: "2k_3_5k" }).faixa).toBe("quente");
    expect(classificar({ aceita_contato: true, p3: "thiago_olhando", p4: "acima_150k", p5: "acima_3_5k" }).motivos).toHaveLength(3);
  });
});

describe("one lead as the routine sees it", () => {
  it("carries the first name, answers in Portuguese and product names", () => {
    const l = montarLead(linha(), NOW);
    expect(l.id).toBe("1000001");
    expect(l.primeiro_nome).toBe("Ana");
    expect(l.respostas.momento).toBe("Sobra dinheiro e ele está parado na conta, sem render");
    expect(l.respostas.renda_lar_semana).toBe("Até $1,000");
    expect(l.produto_recomendado).toBe("Renda em Dólar");
    expect(l.alternativas).toEqual(["Clube dos Sharks", "Método Casal Imparável"]);
    expect(l.faixa).toBe("morno");
    expect(l.antigo).toBe(false);
  });
  it("flags leads older than 90 days and survives empty fields", () => {
    const l = montarLead(linha({ created_at: "2026-01-01T00:00:00Z", nome: null, p1: null, servicos_alternativos: null }), NOW);
    expect(l.antigo).toBe(true);
    expect(l.primeiro_nome).toBeNull();
    expect(l.respostas.momento).toBeNull();
    expect(l.alternativas).toEqual([]);
  });
  it("never carries the surname, email or WhatsApp", () => {
    const row = { ...linha(), email: "ana@example.com", whatsapp: "+61400000000" } as LinhaLead;
    const out = JSON.stringify(montarLead(row, NOW));
    expect(out).not.toContain("Souza");
    expect(out).not.toContain("ana@example.com");
    expect(out).not.toContain("+61400000000");
  });
});

describe("listarLeads", () => {
  it("reads the window newest first and counts each tier", async () => {
    const calls: string[] = [];
    const rows = [linha(), linha({ id: 2, aceita_contato: false }), linha({ id: 3, p3: "thiago_olhando" })];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "gte", "order", "limit"]) {
      q[m] = (...args: unknown[]) => {
        calls.push(`${m}:${JSON.stringify(args)}`);
        return q;
      };
    }
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
    const db = { from: (t: string) => (calls.push(`from:${t}`), q) } as any;

    const out = await listarLeads(db, { dias: 7, limite: 200 }, NOW);
    expect(calls[0]).toBe("from:link_bio_leads");
    expect(calls).toContain(`select:${JSON.stringify([COLUNAS])}`);
    expect(calls).toContain(`gte:["created_at","2026-11-15T00:00:00.000Z"]`);
    expect(out.contagem).toEqual({ quente: 1, morno: 1, sem_contato: 1 });
    expect(out.cortado).toBe(false);
  });
});

describe("the leads door", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = ["app/api/v1/central/leads/route.ts", "lib/central-agent/leads.ts"].map(
    (f) => [f, readFileSync(join(ROOT, f), "utf8")] as const
  );

  it("reads only link_bio_leads", () => {
    for (const [where, src] of files) {
      for (const m of src.matchAll(/\.from\(["'](\w+)["']\)/g)) {
        expect(m[1], where).toBe("link_bio_leads");
      }
    }
  });

  it("writes nothing", () => {
    for (const [where, src] of files) {
      expect(src, where).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
  });

  it("never selects contact details", () => {
    for (const col of ["email", "whatsapp", "user_agent", "referrer", "landing_url", "scores"]) {
      expect(COLUNAS.split(/,\s*/)).not.toContain(col);
    }
    for (const [where, src] of files) {
      expect(src, where).not.toMatch(/select\(\s*["']\*["']/);
    }
  });
});
