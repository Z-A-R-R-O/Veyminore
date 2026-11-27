import { it } from "vitest";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { levels } from "../src/domain/campaign";
import {
  measureDifficulty,
  rateDifficulty,
  weights,
  type Components,
} from "../src/domain/difficultyRating";
it("exports versioned offline difficulty ratings", () => {
  if (process.env.AROWGO_RATE !== "1") return;
  const candidates = Array.from(
    { length: 5 },
    (_, i) => `content/candidates/chapter6/level-${101 + i}.json`,
  )
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, "utf8")));
  const catalog = [...levels, ...candidates];
  const measured = catalog.map((l) => measureDifficulty(l));
  const path = "content/difficulty-calibration-v1.json";
  const calibration: Components = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : Object.fromEntries(
        Object.keys(weights).map((k) => {
          const key = k as keyof Components;
          const ordered = measured
            .slice(0, 100)
            .map((m) => m.components[key])
            .sort((a, b) => a - b);
          return [
            key,
            Math.max(
              0.01,
              ordered[Math.floor((ordered.length - 1) * 0.95)] * 1.25,
            ),
          ];
        }),
      );
  writeFileSync(path, JSON.stringify(calibration, null, 2) + "\n");
  writeFileSync(
    "content/chapter6-preview.json",
    JSON.stringify(candidates, null, 2) + "\n",
  );
  writeFileSync(
    "content/difficulty-ratings.json",
    JSON.stringify(
      catalog.map((l, i) => ({
        levelId: l.levelId,
        contentVersion: l.contentVersion,
        ...rateDifficulty(measured[i], calibration),
      })),
      null,
      2,
    ) + "\n",
  );
}, 300000);
