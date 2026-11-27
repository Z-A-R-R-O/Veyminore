import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { validateLevel } from "../src/domain/rules";
import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import { evaluatePlanning } from "../src/domain/planning";
import calibration from "../content/difficulty-calibration-v1.json";
it("normalizes clockwork attachments and refreshes measured order", () => {
  if (process.env.AROWGO_REPAIR_CLOCKWORK !== "1") return;
  const records = Array.from({ length: 40 }, (_, i) =>
    JSON.parse(
      readFileSync(`content/levels/clockwork/level-${101 + i}.json`, "utf8"),
    ),
  );
  for (const [i, l] of records.entries()) {
    const sources = new Set(
      l.arrows
        .flatMap((a: any) => [a.requires, a.anchorRequires])
        .filter(Boolean),
    );
    for (const a of l.arrows) {
      if (
        !sources.has(a.id) ||
        (a.pulse === undefined && a.window === undefined)
      )
        continue;
      const b = l.arrows.find(
        (b: any) =>
          !sources.has(b.id) &&
          !b.requires &&
          !b.anchorRequires &&
          b.phase === undefined &&
          b.thawAfter === undefined &&
          b.deadline === undefined &&
          b.pulse === undefined &&
          b.window === undefined,
      );
      if (!b) throw Error("No spare attachment");
      const pos = l.solution.indexOf(b.id);
      if (a.pulse !== undefined) {
        b.pulse = pos % 3;
        delete a.pulse;
      }
      if (a.window) {
        const slack =
          Math.floor(i / 10) === 1 ? 2 : Math.floor(i / 10) === 2 ? 1 : 0;
        b.window = [Math.max(0, pos - slack), Math.min(27, pos + slack)];
        delete a.window;
      }
    }
    validateLevel(l);
    if (evaluatePlanning(l).randomLegalWinRate >= 0.00001) {
      for (const a of l.arrows)
        if (a.deadline !== undefined)
          a.deadline = Math.min(a.deadline, l.solution.indexOf(a.id) + 1);
    }
    l.generation.planning = evaluatePlanning(l);
    l.generation.metrics.rate = l.generation.planning.randomLegalWinRate;
    l.generation.rating = rateDifficulty(measureDifficulty(l), calibration);
  }
  records.sort(
    (a, b) =>
      Math.floor((a.generation.metrics.level - 101) / 10) -
        Math.floor((b.generation.metrics.level - 101) / 10) ||
      a.generation.rating.score - b.generation.rating.score,
  );
  records.forEach((l, i) => {
    l.levelId = `clockwork-${101 + i}`;
    l.generation.metrics.level = 101 + i;
    writeFileSync(
      `content/levels/clockwork/level-${101 + i}.json`,
      JSON.stringify(l, null, 2) + "\n",
    );
  });
  writeFileSync(
    "content/levels/clockwork/report.json",
    JSON.stringify(
      records.map((l) => ({
        ...l.generation.metrics,
        rate: l.generation.planning.randomLegalWinRate,
        rating: l.generation.rating.score,
      })),
      null,
      2,
    ) + "\n",
  );
}, 120000);
