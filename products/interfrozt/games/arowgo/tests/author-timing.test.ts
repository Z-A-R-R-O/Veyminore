import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { beforeTimingLevels } from "../src/domain/campaignBeforeTiming";
import { evaluatePlanning } from "../src/domain/planning";
import { solve, validateLevel, type Level } from "../src/domain/rules";
it("authors harder Frostfall timing puzzles", () => {
  if (process.env.AROWGO_TIMING !== "1") return;
  const report = [];
  for (const [i, old] of beforeTimingLevels.entries()) {
    let best: Level | undefined,
      bestScore = Infinity;
    const target = 0.035 * Math.pow(0.004 / 0.035, i / 19);
    for (let t = 0; t < 160; t++) {
      const l: Level = structuredClone(old);
      l.contentVersion = 10;
      const sources = new Set(
        l.arrows.flatMap((a) => [a.requires, a.anchorRequires]).filter(Boolean),
      );
      const pool = l.arrows.filter(
        (a) =>
          !sources.has(a.id) &&
          !a.requires &&
          !a.anchorRequires &&
          a.deadline === undefined &&
          old.solution.indexOf(a.id) >= 2,
      );
      let seed = 41000 + i * 997 + t * 41;
      const rand = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      pool.sort(() => 0);
      for (let j = pool.length - 1; j > 0; j--) {
        const k = Math.floor(rand() * (j + 1));
        [pool[j], pool[k]] = [pool[k], pool[j]];
      }
      const freeze = i === 0 ? 1 : 2,
        gates = i < 5 ? 0 : i < 10 ? 1 : i < 15 ? 2 : 3;
      if (pool.length < freeze + gates) continue;
      for (const a of pool.slice(0, freeze))
        a.thawAfter = Math.min(
          old.solution.indexOf(a.id),
          2 + Math.floor(rand() * 6),
        );
      for (const a of pool.slice(freeze, freeze + gates))
        a.phase = (old.solution.indexOf(a.id) % 2) as 0 | 1;
      // Tighten one existing deadline when the original solution still allows it.
      if (i > 1 && t % 2 === 0) {
        const d = l.arrows.find(
          (a) =>
            a.deadline !== undefined &&
            a.deadline! > old.solution.indexOf(a.id) + 1,
        );
        if (d) d.deadline!--;
      }
      const solution = solve(l);
      if (!solution) continue;
      l.solution = solution;
      const p = evaluatePlanning(l);
      if (!p.decisionStates || p.randomLegalWinRate <= 0) continue;
      const score = Math.abs(Math.log(p.randomLegalWinRate / target));
      if (score < bestScore) {
        bestScore = score;
        best = l;
      }
      if (score < 0.07) break;
    }
    expect(best).toBeTruthy();
    validateLevel(best);
    const planning = evaluatePlanning(best!);
    const out = {
      ...best,
      generation: { timingAuthorVersion: 1, planning, targetWinRate: target },
    };
    writeFileSync(
      `content/levels/frost/level-${41 + i}.json`,
      JSON.stringify(out, null, 2) + "\n",
    );
    report.push({ level: 41 + i, ...out.generation });
    console.log(41 + i, planning.randomLegalWinRate);
  }
  writeFileSync(
    "content/candidates/frost/timing-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 600000);
