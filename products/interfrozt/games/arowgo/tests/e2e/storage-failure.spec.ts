import { test, expect } from "@playwright/test";
test("failed profile storage leaves the gem gift unclaimed and wallet unchanged", async ({
  page,
}) => {
  await page.goto("/#shop");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Claim 20 gems" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Profile storage is unavailable",
  );
  await expect(page.getByLabel("0 total gems")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim 20 gems" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss storage notice" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Claim 20 gems" }).click();
  await expect(page.getByLabel("20 total gems")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("20 total gems")).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim 20 gems" })).toHaveCount(
    0,
  );
});
