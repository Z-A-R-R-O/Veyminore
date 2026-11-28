import { test, expect } from "@playwright/test";
test("merged daily challenge starts, completes once and preserves campaign", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() =>
    localStorage.setItem("arowgo.tutorial.snake.v2", "seen"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#home");
  await expect(
    page.getByRole("region", { name: "Daily challenge" }),
  ).toBeVisible({ timeout: 60000 });
  await page
    .getByRole("region", { name: "Daily challenge" })
    .getByRole("button")
    .click();
  await expect(page.getByRole("heading", { name: /Daily/ })).toBeVisible();
  const order = await page.evaluate(async () => {
    const dailyPath = "/src/storage/daily.ts",
      rulesPath = "/src/domain/rules.ts";
    const { getDailyLevel } = await import(dailyPath);
    const { solve } = await import(rulesPath);
    return solve(getDailyLevel())!;
  });
  for (const id of order) {
    const arrow = page.getByRole("button", { name: `Slide arrow ${id}`, exact: true });
    await expect(arrow).toBeVisible();
    const box = (await arrow.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(arrow).toHaveCount(0);
    await page.waitForTimeout(450);
  }
  await expect(page.getByText("1-Day Streak!", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  const state = await page.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage)),
  );
  expect(JSON.parse(state["arowgo.daily.v1"]).completedDates).toHaveLength(1);
  expect(JSON.parse(state["arowgo.profile.v1"]).gems).toBe(5);
  expect(state["arowgo.save.v1"]).toBeUndefined();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Daily/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("arowgo.profile.v1")!).gems,
    ),
  ).toBe(5);
});
