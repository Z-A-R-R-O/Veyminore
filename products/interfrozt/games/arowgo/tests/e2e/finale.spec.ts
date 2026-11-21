import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
// Completed fixtures use the current authored campaign content.
const levels = Array.from({ length: 20 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`,
        "utf8",
      ),
    ),
  ),
);
import { newSession, resolve } from "../../src/application/session";
import { SAVE_KEY } from "../../src/storage/save";

test("finale suggests missing stars and replay preserves earnings", async ({
  page,
}) => {
  const saves = levels.map((level, i) => {
    let state = newSession(level, `finale-${i}`);
    for (const [n, id] of level.solution.entries())
      state = resolve(level, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
        now: n * 1000,
      }).state;
    if (i === 3)
      state = {
        ...state,
        mistakes: 1,
        elapsedMs: state.targetMs! + 1,
        bestStars: 1,
      };
    return {
      key: i === 0 ? SAVE_KEY : `arowgo.level.${level.levelId}.v1`,
      value: JSON.stringify(state),
    };
  });
  await page.addInitScript(() =>
    localStorage.setItem("arowgo.tutorial.snake.v2", "seen"),
  );
  await page.goto("/");
  await page.evaluate(
    (saves) => saves.forEach((s) => localStorage.setItem(s.key, s.value)),
    saves,
  );
  await page.goto("/#finale/bloom");
  await page.reload();
  await expect(page.getByLabel("58 of 60 stars")).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("button", { name: "Improve Level 4" }),
    ).toBeInViewport();
    const fit = await page
      .locator(".hub-content")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    await page.screenshot({path:`docs/verification/finale-${width}.png`,scale:"css"});
    expect(fit,`${width}x${height} ${await page.locator(".hub-content").evaluate(e=>JSON.stringify({client:e.clientHeight,scroll:e.scrollHeight,children:[...e.querySelector(".campaign-finale")!.children].map(c=>[c.className,c.getBoundingClientRect().height])}))}`).toBe(true);
    await page.screenshot({ path: `docs/verification/finale-${width}.png` });
  }
  await page.getByRole("button", { name: "Improve Level 4" }).click();
  await expect(
    page.getByRole("heading", { name: "Level 04", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    saves[3].key,
  );
  expect(saved.bestStars).toBe(1);
  expect(saved.coins).toBe(25);
  expect(saved.status).toBe("playing");
});
