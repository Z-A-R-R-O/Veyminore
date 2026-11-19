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
const bloom = levels.slice(0, 29);
const cove = levels.slice(29);

test("dense Levels 30–80 complete and reload with safe rewards", async ({
  page,
}) => {
  test.setTimeout(600000);
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "seed");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.addInitScript((values) => {
    if (!localStorage.getItem("dense-test-init")) {
      for (const [k, v] of values) localStorage.setItem(k, v);
      localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
      localStorage.setItem("arowgo.tutorial.keys.v1", "seen");
      localStorage.setItem("arowgo.lesson.anchors", "seen");
      localStorage.setItem("arowgo.lesson.kegs", "seen");
      localStorage.setItem("arowgo.lesson.ice", "seen");
      localStorage.setItem("arowgo.lesson.aurora", "seen");
      localStorage.setItem("dense-test-init", "1");
    }
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#play/30");

  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  for (let i = 0; i < 51; i++) {
    await expect(
      page.getByRole("heading", { name: `Level ${i + 30}`, exact: true }),
    ).toBeVisible();
    if ([0, 10, 20, 30, 40, 50].includes(i))
      await page.screenshot({
        path: `tmp/dense-level-${i + 30}.png`,
      });
    for (const id of cove[i].solution) await move(id);
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: i === 50 ? "Adventure complete" : "Next level",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Amber Dunes cleared!" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("2000 total coins")).toBeVisible();
  await expect(page.getByLabel("240 of 240 stars")).toBeVisible();
});
