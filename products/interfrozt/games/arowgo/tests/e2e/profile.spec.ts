import { test, expect } from "@playwright/test";
test("profile edits persist and collection equips only owned skins", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Display name" })
    .fill("Path Explorer");
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".player-name h1")).toHaveText("Path Explorer");
  await expect(page.locator(".player-avatar img")).toHaveAttribute(
    "src",
    "/assets/avatars/adventure-01.webp",
  );
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
      await page.screenshot({
        path: `tmp/profile-${width}-${height}-${name}.png`,
      });
      expect(
        await page
          .locator(".player-profile")
          .evaluate(
            (el) =>
              el.scrollHeight <= el.clientHeight + 1 &&
              el.scrollWidth <= el.clientWidth + 1,
          ),
        `${width}x${height} ${name}`,
      ).toBe(true);
    }
  }
});

test("every portrait page loads and the last character saves", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator(".adventure-picker img")).toHaveCount(6);
    await expect
      .poll(() =>
        page
          .locator(".adventure-picker img")
          .evaluateAll((images) =>
            images.every((im) => (im as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    if (i < 4)
      await page
        .getByRole("button", { name: "Next avatars", exact: true })
        .click();
  }
  await page
    .getByRole("button", { name: "Choose Celestial Dragon avatar" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.locator(".player-avatar img")).toHaveAttribute(
    "src",
    "/assets/avatars/adventure-30.webp",
  );
});
