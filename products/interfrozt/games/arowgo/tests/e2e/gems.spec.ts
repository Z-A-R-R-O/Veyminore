import { test, expect } from "@playwright/test";
test("starter gems, gem crate and time boost persist without repeat charges", async ({
  page,
}) => {
  await page.goto("/#shop");
  await page
    .getByRole("button", { name: "Claim 20 gems", exact: true })
    .click();
  await expect(page.getByLabel("20 total gems")).toBeVisible();
  await page.getByRole("button", { name: "Open · 1 gem", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Skip animation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep in collection", exact: true })
    .click();
  await expect(page.getByLabel("19 total gems")).toBeVisible();
  await page.goto("/#play/1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Use Time Boost · 3 gems", exact: true })
    .click();
  await expect(page.getByText(/Within 110s/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Within 110s/)).toBeVisible();
  await page.goto("/#shop");
  await expect(page.getByLabel("16 total gems")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim 20 gems", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  const header = await page.locator(".hub-header").boundingBox();
  expect(header!.x + header!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "docs/verification/gem-shop-320.png" });
});
