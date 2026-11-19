import { test, expect } from "@playwright/test";
test("profile edits persist and collection equips only owned skins", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Display name" })
    .fill("Path Explorer");
  await page.getByRole("button", { name: "Choose trophy avatar" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".player-name h1")).toHaveText("Path Explorer");
  await page.getByRole("button", { name: "Arrows", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Classic: equipped" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Mint: locked" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next arrows" }).click();
  await expect(
    page.getByRole("button", { name: "Aurora: locked" }),
  ).toBeDisabled();
});
test("all profile sections fit phone, landscape and desktop", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#profile");
    for (const name of ["Journey", "Arrows", "Edit profile"]) {
      await page.getByRole("button", { name, exact: true }).click();
      expect(
        await page
          .locator(".player-profile")
          .evaluate(
            (el) =>
              el.scrollHeight <= el.clientHeight + 1 &&
              el.scrollWidth <= el.clientWidth + 1,
          ),
      ).toBe(true);
    }
  }
});
