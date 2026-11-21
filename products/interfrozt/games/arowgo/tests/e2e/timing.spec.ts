import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
const beforeTimingLevels = JSON.parse(
  readFileSync("content/levels/frost-before-timing.json", "utf8"),
).map(validateLevel);
const levels = Array.from({ length: 40 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/cove/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
import { newSession, resolve } from "../../src/application/session";
test("old progress opens the new rules; guide and timing badges fit small screens", async ({
  page,
}) => {
  const saves = [...levels.slice(0, 40), ...beforeTimingLevels.slice(0, 6)].map(
    (l, i) => {
      let s = newSession(l, "old");
      for (const id of l.solution)
        s = resolve(l, s, {
          id,
          attemptId: "old",
          type: "select",
          arrowId: id,
        }).state;
      return [
        i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`,
        JSON.stringify(s),
      ];
    },
  );
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
    for (const k of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
    ])
      localStorage.setItem(k, "seen");
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#play/46");
  const dialog = page.getByRole("dialog", { name: "Follow the aurora" });
  await expect(dialog).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const b = (await dialog.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(height + 1);
    await page.screenshot({
      path: `tmp/timing-guide-${width}.png`,
      scale: "css",
    });
  }
  await dialog.getByRole("button", { name: "Try a move" }).click();
  await expect(dialog.locator(".timing-demo")).toContainText("Moon open");
  await dialog.getByRole("button", { name: "Start puzzle" }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.timing-badge[data-kind="aurora"]')).toHaveCount(
    validateLevel(
      JSON.parse(readFileSync("content/levels/frost/level-46.json", "utf8")),
    ).arrows.filter((a) => a.phase !== undefined).length,
  );
  await expect(page.locator('.timing-badge[data-kind="ice"]')).toHaveCount(2);
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("arowgo.level.frost-46.v1")!),
  );
  expect(restored.coins).toBe(25);
  expect(restored.bestStars).toBe(3);
  expect(restored.claimed).toBe(true);
  await page.screenshot({ path: "tmp/timing-board.png", scale: "css" });
  await page.getByRole("button", { name: "Frostfall rules" }).click();
  await expect(dialog).toBeVisible();
});
