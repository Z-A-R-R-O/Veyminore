import { it, expect } from "vitest";
import { clampDock, reportText, safeRoute } from "../src/dev/report";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
import { newSession } from "../src/application/session";
import { levels } from "../src/domain/campaign";
it("keeps the draggable button in view including corrupt stored coordinates", () => {
  expect(clampDock({ x: 999, y: -99 }, 320, 568)).toEqual({ x: 256, y: 8 });
  expect(clampDock({ x: NaN, y: Infinity }, 320, 568)).toEqual({ x: 8, y: 8 });
});
it("reports only explicit safe context and strips unrecognized routes", () => {
  expect(safeRoute("#play/60")).toBe("play/60");
  expect(safeRoute("#account?token=SECRET")).toBe("unrecognized");
  const report = reportText({
    summary: " Bug ",
    details: "Steps",
    severity: "major",
    route: "#account?token=SECRET",
    width: 390,
    height: 844,
    scale: 2,
    reducedMotion: true,
    errors: 2,
    sandboxLevel: null,
  });
  expect(report).not.toContain("SECRET");
  expect(JSON.parse(report).summary).toBe("Bug");
});
it("sandbox practice never awards currency or writes campaign storage", () => {
  const level = levels[0],
    data = new Map([
      ["sandbox", JSON.stringify(newSession(level, "dev", "practice"))],
    ]);
  const c = new Controller(
    level,
    new SaveStore(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      level,
      "sandbox",
    ),
    () => crypto.randomUUID(),
    false,
  );
  for (const id of level.solution) c.select(id);
  expect(c.state.status).toBe("complete");
  expect(c.state.coins).toBe(0);
  expect(c.state.bestStars).toBe(0);
  expect([...data.keys()].every((k) => k.startsWith("sandbox"))).toBe(true);
});
