import { it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  generatePuzzle,
  fillUnusedCells,
  evaluateLayout,
  evaluateDifficulty,
} from "../src/domain/generator";
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
import calibration from "../content/difficulty-calibration-v1.json";
import { switchTraps } from "./foundry-helpers";

it("authors forty Eclipse Foundry puzzles with verified switch traps", () => {
  if (process.env.AROWGO_FOUNDRY !== "1") return;
  mkdirSync("content/levels/foundry", { recursive: true });
  const floors = [700, 790, 850, 900],
    ceilings = [789, 849, 899, 1000];
  for (let number = 181; number <= 220; number++) {
    const file = `content/levels/foundry/level-${number}.json`;
    if (existsSync(file)) continue;
    const band = Math.floor((number - 181) / 10),
      groups = band === 0 ? 1 : 2,
      gateCount = band < 2 ? 2 : 3;
    let accepted: any;
    for (
      let attempt = 0;
      attempt < (band === 3 ? 720 : 120) && !accepted;
      attempt++
    ) {
      let base: Level;
      try {
        base = generatePuzzle(
          281127 + number * 2399 + attempt * 97,
          28,
          300,
          `foundry-${number}`,
          {
            connectedPlacement: true,
            openingMoves: [2, 12],
            depthRange: [9, 28],
            keyLockPairs: 1,
            minimumOccupiedCells: 68,
          },
        );
      } catch (e) {
        if (String(e).includes("Generation budget")) continue;
        throw e;
      }
      base = fillUnusedCells(base, 93 + band);
      base.contentVersion = 15;
      if (evaluateLayout(base).occupiedCells < 89) continue;
      const baseOrder = solve(base)!;
      const reserved = new Set(
        base.arrows.flatMap((a) => (a.requires ? [a.id, a.requires] : [])),
      );
      const source = baseOrder.find((id) => !reserved.has(id))!;
      reserved.add(source);
      for (const id of baseOrder
        .slice(baseOrder.indexOf(source) + 2)
        .filter((id) => !reserved.has(id))
        .slice(0, 2)) {
        base.arrows.find((a) => a.id === id)!.anchorRequires = source;
        reserved.add(id);
      }
      const graph = dependencies(base),
        ancestors = (id: string, seen = new Set<string>()): Set<string> => {
          for (const p of graph.get(id)!)
            if (!seen.has(p)) {
              seen.add(p);
              ancestors(p, seen);
            }
          return seen;
        };
      for (let trial = 0; trial < 120 && !accepted; trial++) {
        const l = structuredClone(base);
        let seed = number * 1399 + attempt * 331 + trial * 71;
        const rnd = (n: number) => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return Math.floor((seed / 4294967296) * n);
        };
        const shuffled = <T>(a: T[]) => {
          for (let j = a.length - 1; j > 0; j--) {
            const k = rnd(j + 1);
            [a[j], a[k]] = [a[k], a[j]];
          }
          return a;
        };
        const free = shuffled(
          baseOrder.filter(
            (id) => !reserved.has(id) && ancestors(id).size >= 2,
          ),
        );
        const kegCount = band === 0 ? 2 : band === 3 ? 4 : 3;
        const timed = new Set(free.slice(0, kegCount));
        for (const id of timed)
          l.arrows.find((a) => a.id === id)!.deadline = Math.min(
            28,
            trial % 2
              ? baseOrder.indexOf(id) + 1 + rnd(3)
              : ancestors(id).size + 1 + rnd(4),
          );
        try {
          let order = solve(l);
          if (!order) continue;
          let pool = shuffled(
            order.filter((id) => !reserved.has(id) && !timed.has(id)),
          );
          for (let g = 1; g <= groups; g++) {
            const role = pool
              .splice(0, gateCount + 2)
              .sort((a, b) => order!.indexOf(a) - order!.indexOf(b));
            const s1 = role[gateCount === 3 ? 1 : 0],
              s2 = role[gateCount === 3 ? 3 : 2];
            l.arrows.find((a) => a.id === s1)!.switchGroup = g as 1 | 2;
            l.arrows.find((a) => a.id === s2)!.switchGroup = g as 1 | 2;
            for (const id of role.filter((id) => id !== s1 && id !== s2)) {
              const parity =
                Number(order.indexOf(s1) < order.indexOf(id)) +
                Number(order.indexOf(s2) < order.indexOf(id));
              l.arrows.find((a) => a.id === id)!.gate = {
                group: g as 1 | 2,
                initiallyOpen: parity % 2 === 0,
              };
            }
          }
          for (const id of pool.splice(0, band === 0 ? 1 : 2)) {
            const pos = order.indexOf(id);
            if (pos > 0)
              l.arrows.find((a) => a.id === id)!.thawAfter = Math.max(
                1,
                pos - 2,
              );
          }
          if (band >= 1) {
            const id = pool.shift()!;
            l.arrows.find((a) => a.id === id)!.phase = (order.indexOf(id) %
              2) as 0 | 1;
          }
          if (band >= 2)
            for (const id of pool.splice(0, band === 3 ? 2 : 1)) {
              const pos = order.indexOf(id);
              l.arrows.find((a) => a.id === id)!.window = [
                Math.max(0, pos - (band === 3 ? 0 : 1)),
                Math.min(27, pos + 1),
              ];
            }
          if (band === 3 && pool.length) {
            const id = pool.shift()!;
            l.arrows.find((a) => a.id === id)!.pulse = (order.indexOf(id) %
              3) as 0 | 1 | 2;
          }
          order = solve(l);
          if (!order) continue;
          l.solution = order;
          const traps = switchTraps(l);
          if (traps.length !== groups) continue;
          const m = measureDifficulty(l),
            rating = rateDifficulty(m, calibration);
          if (
            rating.score < floors[band] ||
            rating.score > ceilings[band] ||
            m.failureHorizon < (band === 0 ? 5 : 10)
          )
            continue;
          validateLevel(l);
          accepted = {
            ...l,
            generation: {
              foundryAuthorVersion: 1,
              seed: 281127 + number * 2399 + attempt * 97,
              trial,
              band,
              groups,
              gateCount,
              rating: rating.score,
              measurement: m,
              traps,
            },
          };
        } catch (e) {
          if (!String(e).includes("budget exhausted")) throw e;
        }
      }
    }
    expect(accepted, `Foundry ${number}`).toBeTruthy();
    writeFileSync(file, JSON.stringify(accepted, null, 2) + "\n");
    console.log("accepted", number, accepted.generation.rating);
  }
  const ordered = Array.from({ length: 40 }, (_, i) =>
    JSON.parse(
      readFileSync(`content/levels/foundry/level-${181 + i}.json`, "utf8"),
    ),
  ).sort((a, b) => a.generation.rating - b.generation.rating);
  const report = ordered.map((l, i) => {
    l.generation.sourceLevelId ??= l.levelId;
    l.levelId = `foundry-${181 + i}`;
    writeFileSync(
      `content/levels/foundry/level-${181 + i}.json`,
      JSON.stringify(l, null, 2) + "\n",
    );
    return {
      level: 181 + i,
      rating: l.generation.rating,
      ...evaluateLayout(l),
      ...evaluateDifficulty(l),
      planning: evaluatePlanning(l),
    };
  });
  writeFileSync(
    "content/levels/foundry/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 3600000);
