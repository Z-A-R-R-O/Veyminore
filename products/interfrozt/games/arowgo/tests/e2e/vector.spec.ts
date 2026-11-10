import { test, expect } from "@playwright/test";
test("vector paths remain unique and bent arrow flows out", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
  await expect(page.locator(".vector-arrows")).toHaveCount(1);
  await expect(page.locator('[data-arrow="D"] .arrow-body')).toHaveAttribute(
    "stroke",
    "#422563",
  );
  await expect(page.locator('[data-arrow="D"]')).toHaveCount(1);
  for (const id of ["A", "B", "C"]) {
    const button = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
  }
  const button = page.getByRole("button", {
    name: "Slide arrow D",
    exact: true,
  });
  await expect(button).toBeEnabled();
  const body = page.locator('[data-arrow="D"] .arrow-body');
  const before = await body.getAttribute("d");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-arrow="D"]')).toHaveAttribute(
    "data-motion",
    "snake",
  );
  await expect(body).not.toHaveAttribute("d", before!);
  await expect(page.locator('[data-arrow="D"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Rule lab" }).click();
  await expect(page.locator(".vector-arrows")).toHaveCount(1);
});
