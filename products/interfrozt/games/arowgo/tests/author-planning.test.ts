import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { beforePlanningLevels } from "../src/domain/campaignBeforePlanning";
import { planDeadlines } from "../src/domain/planning";
import { solve, validateLevel } from "../src/domain/rules";
it("authors measured planning candidates without promotion", () => {
  if (process.env.AROWGO_PLANNING !== "1") return;
  mkdirSync("content/candidates/planning", { recursive: true });
  const report = [];
  for (let n = 10; n <= 40; n++) {
    const { level, analysis, targetWinRate } = planDeadlines(
      beforePlanningLevels[n - 1],
      n,
    );
    level.solution = solve(level)!;
    validateLevel(level);
    writeFileSync(
      `content/candidates/planning/level-${n}.json`,
      JSON.stringify(
        {
          ...level,
          generation: { planningVersion: 1, analysis, targetWinRate },
        },
        null,
        2,
      ) + "\n",
    );
    report.push({ number: n, ...analysis, targetWinRate });
    console.log(n, analysis.randomLegalWinRate, analysis.deadlines);
  }
  writeFileSync(
    "content/candidates/planning/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 600000);
