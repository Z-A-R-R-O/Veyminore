import { test, expect } from "@playwright/test";
test("multiple game tabs can load while holding shared save locks", async ({
  context,
}) => {
  const one = await context.newPage();
  await one.goto("/#profile");
  await expect(one.locator(".player-name")).toBeVisible();
  const two = await context.newPage();
  await two.goto("/#profile");
  await expect(two.locator(".player-name")).toBeVisible();
  expect(
    await two.evaluate(() =>
      navigator.locks.request(
        "arowgo-save-access-v1",
        { ifAvailable: true },
        (lock) => !!lock,
      ),
    ),
  ).toBe(false);
  await one.close();
  await two.close();
});
test("interrupted restore is recovered before profile initialization", async ({
  page,
}) => {
  await page.goto("/#profile");
  await expect(page.locator(".player-name")).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = "/src/account/legacy-backup.ts";
    const { captureLegacyBackup } = await import(modulePath);
    const before = captureLegacyBackup(localStorage);
    localStorage.setItem(
      "arowgo.cloud.restore-journal.v1",
      JSON.stringify({ schemaVersion: 1, before }),
    );
    localStorage.setItem("arowgo.profile.v1", "partial-write");
  });
  await page.reload();
  await expect(page.locator(".player-name")).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("arowgo.cloud.restore-journal.v1"),
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("arowgo.profile.v1")),
  ).not.toBe("partial-write");
});
