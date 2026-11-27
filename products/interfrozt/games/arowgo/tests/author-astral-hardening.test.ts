import { fillUnusedCells } from "../src/domain/generator";
import { it, expect } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import originals from "../content/levels/astral-before-hardening.json";
import calibration from "../content/difficulty-calibration-v1.json";
import {
  validateLevel,
  solve,
  dependencies,
  type Level,
} from "../src/domain/rules";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import { evaluatePlanning } from "../src/domain/planning";
it("authors a stronger globally ordered Astral curve", () => {
  if (process.env.AROWGO_HARDEN_ASTRAL !== "1") return;
  mkdirSync("tmp/astral-hardening", { recursive: true });
  for (let i = 0; i < 40; i++) {
    const file = `tmp/astral-hardening/${141 + i}.json`;
    if (existsSync(file)) continue;
    const original = validateLevel(originals[i]);
    const base = fillUnusedCells(original, 100);
    const prior = measureDifficulty(original);
    const priorScore = rateDifficulty(prior, calibration).score;
    const floor = Math.max(860, priorScore);
    let best:
      | {
          level: Level;
          score: number;
          measurement: ReturnType<typeof measureDifficulty>;
        }
      | undefined;
    if (priorScore >= floor && prior.failureHorizon >= 12)
      best = { level: original, score: priorScore, measurement: prior };
    let seed = 271127 + i * 7919;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    let frontier = 0;
    for (let trial = 0; trial < 8000 && !best; trial++) {
      const l = structuredClone(base);
      const preserve = trial % 2 === 0;
      let order = original.solution;
      for (const a of l.arrows) {
        delete a.deadline;
        if (!preserve) {
          delete a.phase;
          delete a.pulse;
        }
        delete a.window;
        if (!preserve) delete a.thawAfter;
      }
      const sources = new Set(
        l.arrows.flatMap((a) => [a.requires, a.anchorRequires]),
      );
      const free = l.arrows.filter(
        (a) =>
          a.phase === undefined &&
          a.pulse === undefined &&
          a.thawAfter === undefined &&
          !a.requires &&
          !a.anchorRequires &&
          !sources.has(a.id) &&
          order.indexOf(a.id) > 1,
      );
      for (let j = free.length - 1; j > 0; j--) {
        const k = rnd(j + 1);
        [free[j], free[k]] = [free[k], free[j]];
      }
      const graph = dependencies(l);
      const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
        for (const p of graph.get(id)!)
          if (!seen.has(p)) {
            seen.add(p);
            ancestors(p, seen);
          }
        return seen;
      };
      let k = 0;
      for (let j = 0; j < 3 + (trial % 3); j++) {
        const a = free[k++];
        a.deadline = Math.min(
          28,
          trial % 4 >= 2
            ? order.indexOf(a.id) + 1 + rnd(2)
            : ancestors(a.id).size + 1 + rnd(4),
        );
      }
      const scheduled = solve(l);
      if (!scheduled) continue;
      order = scheduled;
      if (!preserve) {
        for (let j = 0; j < 2; j++) {
          const a = free[k++];
          a.thawAfter = Math.max(1, order.indexOf(a.id) - rnd(3));
        }
        for (let j = 0; j < 3; j++) {
          const a = free[k++];
          a.phase = (order.indexOf(a.id) % 2) as 0 | 1;
        }
        for (let j = 0; j < 5; j++) {
          const a = free[k++];
          a.pulse = (order.indexOf(a.id) % 3) as 0 | 1 | 2;
        }
      }
      for (let j = 0; j < 4; j++) {
        const a = free[k++];
        if (!a) break;
        const pos = order.indexOf(a.id),
          slack = trial % 3 === 0 ? 1 : 0;
        a.window = [Math.max(0, pos - slack), Math.min(27, pos + slack)];
      }
      try {
        const solution = solve(l);
        if (!solution) continue;
        l.solution = solution;
        const m = measureDifficulty(l),
          score = rateDifficulty(m, calibration).score;
        if (
          score > frontier &&
          m.randomLegalWinRate <= prior.randomLegalWinRate
        ) {
          frontier = score;
          writeFileSync(
            `tmp/astral-hardening/frontier.txt`,
            JSON.stringify({
              level: 141 + i,
              trial,
              score,
              horizon: m.failureHorizon,
            }),
          );
        }
        if (
          score < floor ||
          m.failureHorizon < 12 ||
          m.randomLegalWinRate > prior.randomLegalWinRate
        )
          continue;
        if (!evaluatePlanning(l).blockedTargetDecisions) continue;
        best = { level: l, score, measurement: m };
      } catch (e) {
        if (!String(e).includes("budget exhausted")) throw e;
      }
    }
    expect(best, `Astral ${141 + i} target ${floor}`).toBeTruthy();
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...best!.level,
          contentVersion: 14,
          generation: {
            hardeningVersion: 1,
            sourceLevelId: original.levelId,
            previousScore: priorScore,
            rating: best!.score,
            measurement: best!.measurement,
          },
        },
        null,
        2,
      ) + "\n",
    );
    console.log("accepted", 141 + i, priorScore, best!.score);
  }
}, 3600000);
