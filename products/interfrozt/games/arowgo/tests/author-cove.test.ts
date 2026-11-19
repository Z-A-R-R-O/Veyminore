import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePuzzle, evaluateDifficulty } from "../src/domain/generator";
import {
  solve,
  validateLevel,
  dependencies,
  type Level,
} from "../src/domain/rules";
it("authors twenty staged cove puzzles", () => {
  if (process.env.AROWGO_COVE !== "1") return;
  mkdirSync("content/candidates/cove", { recursive: true });
  const outputs = [];
  for (let i = 0; i < 20; i++) {
    const number = i + 21,
      teaching = [24, 31].includes(number),
      target = teaching ? 85 : 104 + i * 2;
    let selected: ReturnType<typeof generatePuzzle> | undefined;
    for (let retry = 0; retry < 18; retry++) {
      try {
        selected = generatePuzzle(
          261115 + i * 977 + retry * 131,
          teaching ? 12 : 14 + Math.floor(i / 5),
          target,
          `cove-${String(number).padStart(2, "0")}`,
          {
            connectedPlacement: true,
            openingMoves: [2, 5],
            scoreRange: [target - 7, target + 7],
            ...(number >= 22 && !teaching ? { keyLockPairs: 1 as const } : {}),
          },
        );
        break;
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith("Generation budget"))
          throw e;
      }
    }
    if (!selected) throw Error(`No candidate for ${number}`);
    const level: Level = {
      ...selected,
      contentVersion: 7,
      arrows: selected.arrows.map((a) => ({ ...a })),
    };
    if (number >= 24) {
      const order = solve(level)!;
      const graph = dependencies(level);
      // Source precedes every attached arrow, and at least one new dependency is added.
      const source = order.find(
        (id, index) =>
          order
            .slice(index + 1)
            .filter(
              (other) =>
                !level.arrows.find((a) => a.id === other)!.requires &&
                !graph.get(other)!.has(id),
            ).length >= 2,
      )!;
      const targets = order
        .slice(order.indexOf(source) + 1)
        .filter(
          (id) =>
            !level.arrows.find((a) => a.id === id)!.requires &&
            !graph.get(id)!.has(source),
        )
        .slice(0, number === 24 ? 1 : 2);
      for (const id of targets)
        level.arrows.find((a) => a.id === id)!.anchorRequires = source;
    }
    level.solution = solve(level)!;
    if (number >= 31) {
      const k =
        number === 31 ? 2 : Math.min(5, 3 + Math.floor((number - 32) / 3));
      level.arrows.find((a) => a.id === level.solution[k])!.deadline =
        k + (number < 35 ? 3 : 2);
      if (number >= 37)
        level.arrows.find((a) => a.id === level.solution[k + 3])!.deadline =
          k + 5;
      level.solution = solve(level)!;
    }
    validateLevel(level);
    const output = {
      ...level,
      generation: {
        ...selected.generation,
        coveAuthorVersion: 1,
        difficulty: evaluateDifficulty(level),
        teaching,
      },
    };
    outputs.push(output);
  }
  // Preserve teaching beats; order each practice block by measured geometry.
  for (const [start, end] of [
    [4, 10],
    [11, 16],
    [16, 20],
  ]) {
    const sorted = outputs
      .slice(start, end)
      .sort(
        (a, b) => a.generation.difficulty.score - b.generation.difficulty.score,
      );
    outputs.splice(start, end - start, ...sorted);
  }
  const report = outputs.map((output, i) => {
    output.levelId = "cove-" + (i + 21);
    const keySources = new Set(
      output.arrows.map((a) => a.requires).filter(Boolean),
    );
    // Keep one readable attachment per arrow tail.
    for (const arrow of output.arrows.filter(
      (a) => a.anchorRequires && keySources.has(a.id),
    )) {
      const source = arrow.anchorRequires!;
      const target = output.solution
        .slice(output.solution.indexOf(source) + 1)
        .map((id) => output.arrows.find((a) => a.id === id)!)
        .find(
          (a) =>
            !a.requires &&
            !a.anchorRequires &&
            !a.deadline &&
            !keySources.has(a.id) &&
            !output.arrows.some((other) => other.anchorRequires === a.id),
        );
      if (!target) throw Error("No clean anchor target");
      delete arrow.anchorRequires;
      target.anchorRequires = source;
    }
    output.solution = solve(output)!;
    validateLevel(output);
    output.generation.difficulty = evaluateDifficulty(output);
    writeFileSync(
      "content/candidates/cove/level-" + (i + 21) + ".json",
      JSON.stringify(output, null, 2) + "\n",
    );
    return {
      number: i + 21,
      teaching: output.generation.teaching,
      ...output.generation.difficulty,
      arrows: output.arrows.length,
      anchors: output.arrows.filter((a) => a.anchorRequires).length,
      kegs: output.arrows.filter((a) => a.deadline).length,
    };
  });
  writeFileSync(
    "content/candidates/cove/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 240000);
