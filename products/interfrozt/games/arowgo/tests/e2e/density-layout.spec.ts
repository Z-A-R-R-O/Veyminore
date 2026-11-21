import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 80 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : "amber"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
test("dense boards fit small screens and accept precise pointer input", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const saves = levels.map((l, i) => {
    let s = newSession(l, "layout");
    if (i < 79)
      for (const id of l.solution)
        s = resolve(l, s, {
          id,
          attemptId: s.attemptId,
          type: "select",
          arrowId: id,
        }).state;
    if ([29, 59, 79].includes(i)) s = newSession(l, "layout-ready", "story", s);
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`,
      JSON.stringify(s),
    ];
  });
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
    for (const k of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
      "arowgo.lesson.ice",
      "arowgo.lesson.aurora",
    ])
      localStorage.setItem(k, "seen");
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
  ])
    for (const n of [30, 60, 80]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/?dense-layout=${width}-${n}#play/${n}`);
      await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
      const board = page.getByTestId("board");
      const b = (await board.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(height + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBeLessThanOrEqual(height);
      await page.screenshot({
        path: `tmp/dense-${info.project.name}-${n}-${width}.png`,
      });
      const l = levels[n - 1],
        id = l.solution[0],
        a = l.arrows.find((a) => a.id === id)!,
        p = a.points.at(-2)!,
        q = a.points.at(-1)!;
      const x = b.x + (b.width * (60 + ((p[0] + q[0]) / 2 + 0.5) * 48)) / 600,
        y = b.y + (b.height * (60 + ((p[1] + q[1]) / 2 + 0.5) * 48)) / 600;
      if (info.project.name === "phone") await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(
        page.getByRole("button", { name: `Slide arrow ${id}`, exact: true }),
      ).toHaveCount(0);
    }
});
