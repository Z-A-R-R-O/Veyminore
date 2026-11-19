import { it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  fillUnusedCells,
  evaluateLayout,
  evaluateDifficulty,
} from "../src/domain/generator";
import { evaluatePlanning } from "../src/domain/planning";
it("fills and promotes verified candidates", () => {
  if (process.env.AROWGO_PROMOTE_DENSE !== "1") return;
  const report = [];
  for (let n = 30; n <= 80; n++)
    expect(existsSync(`content/candidates/dense/level-${n}.json`)).toBe(true);
  for (let n = 30; n <= 80; n++) {
    const path = `content/candidates/dense/level-${n}.json`,
      raw = JSON.parse(readFileSync(path, "utf8"));
    const l = fillUnusedCells(raw, 70 + Math.floor((n - 30) * 0.3));
    const analysis = evaluatePlanning(l);
    expect(analysis.randomLegalWinRate).toBe(
      raw.generation.planning.randomLegalWinRate,
    );
    expect(evaluateLayout(l).occupiedCells).toBeGreaterThanOrEqual(
      65 + Math.floor((n - 30) * 0.25),
    );
    const output = {
      ...l,
      generation: {
        densityAuthorVersion: 1,
        metrics: {
          ...raw.generation.metrics,
          ...evaluateLayout(l),
          ...evaluateDifficulty(l),
        },
        planning: analysis,
      },
    };
    writeFileSync(path, JSON.stringify(output, null, 2) + "\n");
    writeFileSync(
      `content/levels/${n <= 40 ? "cove" : n <= 60 ? "frost" : "amber"}/level-${n}.json`,
      JSON.stringify(output, null, 2) + "\n",
    );
    report.push(output.generation.metrics);
  }
  writeFileSync(
    "content/candidates/dense/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 120000);
