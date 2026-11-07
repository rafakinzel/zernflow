import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avaliarRetomada, textoDoPasso } from "./fluxos-parados";

const base = { pausada: true, alguemRespondeu: false, retomado: false, janelaAberta: true, temBotoes: true };

describe("avaliarRetomada", () => {
  it("accepts a paused stop nobody answered, inside the window", () => {
    expect(avaliarRetomada(base)).toEqual({ retomavel: true, motivo: null });
  });

  it("never talks over a person who already answered", () => {
    expect(avaliarRetomada({ ...base, alguemRespondeu: true }).motivo).toBe("alguem_respondeu");
  });

  it("refuses what already moved on, has no button, or is out of the window", () => {
    expect(avaliarRetomada({ ...base, retomado: true }).motivo).toBe("ja_retomado");
    expect(avaliarRetomada({ ...base, pausada: false }).motivo).toBe("nao_esta_pausada");
    expect(avaliarRetomada({ ...base, temBotoes: false }).motivo).toBe("passo_sem_botao");
    expect(avaliarRetomada({ ...base, janelaAberta: false }).motivo).toBe("fora_da_janela");
  });
});

describe("textoDoPasso", () => {
  it("joins the bubbles of the step the person was looking at", () => {
    expect(
      textoDoPasso({ id: "n", data: { messages: [{ text: "Olá!" }, { text: "Bora?" }] } })
    ).toBe("Olá!\n\nBora?");
    expect(textoDoPasso(undefined)).toBe("");
  });
});

describe("the stopped-flows door", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = ["app/api/v1/central/fluxos-parados/route.ts", "lib/central-agent/fluxos-parados.ts"].map(
    (f) => [f, readFileSync(join(ROOT, f), "utf8")] as const
  );

  it("reads only these tables", () => {
    for (const [where, src] of files) {
      for (const m of src.matchAll(/\.from\(["'](\w+)["']\)/g)) {
        expect(
          ["flow_sessions", "conversations", "analytics_events", "messages", "central_dm_sends"],
          `${where}: ${m[1]}`
        ).toContain(m[1]);
      }
    }
  });

  it("writes nothing, runs nothing and never touches the pause", () => {
    for (const [where, src] of files) {
      expect(src, where).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src, where).not.toMatch(/executeFlow|resumeSession|createMessagingProvider|is_automation_paused:\s*(true|false)/);
    }
  });
});
