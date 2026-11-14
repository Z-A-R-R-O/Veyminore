import { test, expect } from "@playwright/test";
test("blocked curved arrow approaches, recoils, and costs exactly one heart", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await expect(
    page.getByRole("button", { name: "Analyze", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
  const arrow = page.locator('[data-arrow="D"]');
  const original = await arrow.locator(".arrow-body").getAttribute("d");
  const button = page.getByRole("button", {
    name: "Slide arrow D",
    exact: true,
  });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(arrow).toHaveAttribute("data-motion", "blocked");
  await expect(arrow.locator(".arrow-body")).not.toHaveAttribute(
    "d",
    original!,
  );
  await expect(arrow).not.toHaveAttribute("data-motion", "blocked");
  await expect(arrow).toHaveAttribute("transform", "translate(0 0)");
  await expect(arrow.locator(".arrow-body")).toHaveAttribute("d", original!);
  await expect(page.locator(".vector-arrows [data-arrow]")).toHaveCount(10);
  await expect(page.getByLabel("2 hearts remaining")).toBeVisible();
  await expect(page.locator('[data-arrow="B"]')).toHaveAttribute(
    "opacity",
    "1",
  );
  await page.reload();
  await expect(page.getByLabel("2 hearts remaining")).toBeVisible();
});
