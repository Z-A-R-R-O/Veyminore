import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
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
const previousPlainLevels = [11, 14, 17, 19, 20].map((n) =>
  validateLevel(
    JSON.parse(
      readFileSync(`content/levels/archive-v3/bloom-${n}.json`, "utf8"),
    ),
  ),
);
import { newSession, resolve } from "../../src/application/session";

test("old cleared campaign keeps awards and unlocks through key upgrade", async ({
  page,
}) => {
  const saves = levels.map((current) => {
    const old =
      previousPlainLevels.find((l) => l.levelId === current.levelId) ?? current;
    let state = newSession(old, "old");
    for (const id of old.solution)
      state = resolve(old, state, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    return [
      old.levelId === "bloom-01"
        ? "arowgo.slice.v1"
        : `arowgo.level.${old.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.goto("/");
  await page.evaluate((saves) => {
    localStorage.clear();
    // This case isolates key onboarding; the earlier barrel lesson has its own coverage.
    localStorage.setItem("arowgo.lesson.kegs", "seen");
    for (const [k, v] of saves) localStorage.setItem(k, v);
  }, saves);
  await page.goto("/#play/11");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keys & locks" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play Level 11", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Level 11", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("New puzzle. Coins and best stars kept.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/verification/keys-migrated.png" });
  expect(
    await page.evaluate(() =>
      localStorage.getItem("arowgo.level.bloom-11.v1.content-3"),
    ),
  ).toBe(saves[10][1]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Level 11", exact: true }),
  ).toBeVisible();
  await page.goto("/#finale/bloom");
  await expect(
    page.getByRole("heading", { name: "Bloom Valley cleared!" }),
  ).toBeVisible();
  await expect(page.getByLabel("60 of 60 stars")).toBeVisible();
  await page.goto("/#profile");
  await expect(page.getByLabel("500 total coins")).toBeVisible();
});
