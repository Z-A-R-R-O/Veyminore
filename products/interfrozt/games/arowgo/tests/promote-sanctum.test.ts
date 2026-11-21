import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { validateLevel, solve } from "../src/domain/rules";
import { evaluatePlanning } from "../src/domain/planning";

it("promotes Sanctum only after all twenty candidates pass", () => {
  if (process.env.AROWGO_PROMOTE_SANCTUM !== "1") return;
  const candidates = Array.from({ length: 20 }, (_, i) =>
    JSON.parse(
      readFileSync(`content/candidates/sanctum/level-${81 + i}.json`, "utf8"),
    ),
  );
  let previous = evaluatePlanning(
    validateLevel(
      JSON.parse(readFileSync("content/levels/amber/level-80.json", "utf8")),
    ),
  ).randomLegalWinRate;
  for (const [i, raw] of candidates.entries()) {
    const l = validateLevel(raw);
    expect(l.levelId).toBe(`sanctum-${81 + i}`);
    expect(solve(l)).not.toBeNull();
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(previous);
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    previous = p.randomLegalWinRate;
  }
  mkdirSync("content/levels/sanctum", { recursive: true });
  for (const [i, raw] of candidates.entries())
    writeFileSync(
      `content/levels/sanctum/level-${81 + i}.json`,
      JSON.stringify(raw, null, 2) + "\n",
    );
}, 120000);
