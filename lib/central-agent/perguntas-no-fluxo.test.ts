import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the questions-typed-during-flows door", () => {
  const ROOT = join(__dirname, "..", "..");
  const files = ["app/api/v1/central/perguntas-no-fluxo/route.ts", "lib/central-agent/perguntas-no-fluxo.ts"].map(
    (f) => [f, readFileSync(join(ROOT, f), "utf8")] as const
  );

  it("reads only these tables", () => {
    for (const [where, src] of files) {
      for (const m of src.matchAll(/\.from\(["'](\w+)["']\)/g)) {
        expect(
          ["analytics_events", "flows", "messages", "central_dm_sends", "conversations"],
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
