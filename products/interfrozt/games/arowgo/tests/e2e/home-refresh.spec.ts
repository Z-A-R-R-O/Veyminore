import { test, expect } from "@playwright/test";
test("Home fits small and landscape screens and respects motion settings", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#home");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(450);
    const nav = (await page.getByRole("navigation").boundingBox())!;
    for (const control of await page.locator(".bloom-home button").all()) {
      const b = (await control.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(nav.y);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    const art = (await page.locator(".bloom-stage").boundingBox())!;
    expect(art.height).toBeGreaterThan(50);
    expect(
      await page
        .locator(".page-home")
        .evaluate((e) => e.scrollHeight - e.clientHeight),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `docs/verification/home-refresh-${viewport.width}.png`,
    });
  }
  await expect(page.locator(".ambient-bloom")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Reduce motion" }).check();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  expect(
    await page
      .locator(".bloom-home-island")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  await expect(page.locator(".ambient-bloom")).toBeHidden();
  await page.reload();
  await expect(page.locator(".ambient-bloom")).toBeHidden();
});
