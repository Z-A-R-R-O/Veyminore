import { test, expect } from "@playwright/test";
test("local Satoshi, heart break and reassuring retry", async ({
  page,
}, info) => {
  await page.goto("/");
  const motto = page.getByText("A little play. A little practice in thinking.");
  if (info.project.name === "phone") await expect(motto).toBeHidden();
  else await expect(motto).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("14px Satoshi"))).toBe(
    true,
  );
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Satoshi");
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole("button", { name: "Slide arrow B", exact: true });
    await expect(b).toBeEnabled();
    await b.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".heart-token.is-breaking")).toHaveCount(1);
  }
  await expect(
    page.getByText("Your coins and best stars are safe.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Take a breath. Try a new order.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .locator(".result-overlay")
    .screenshot({ path: `docs/verification/retry-${info.project.name}.png` });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("3 hearts remaining")).toBeVisible();
  await expect(page.locator(".heart-token.is-breaking")).toHaveCount(0);
});
