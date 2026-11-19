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
  for (let i = 0; i < 3; i++) {
    await expect(
      page.locator(".adventure-picker .adventure-avatar"),
    ).toHaveCount(i === 2 ? 6 : 12);
    await expect
      .poll(() =>
        page
          .locator(".adventure-picker img")
          .evaluateAll((images) =>
            images.every((im) => (im as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    if (i < 2)
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

test("backgrounds preview without saving, then persist alongside the avatar", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
    .click();
  await page.getByRole("button", { name: "Background", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Ocean Teal background" })
    .click();
  await expect(
    page.locator(".profile-identity .adventure-avatar"),
  ).toHaveAttribute("style", /background-02/);
  await page.reload();
  await expect(
    page.locator(".player-avatar .game-art").first(),
  ).not.toHaveAttribute("style", /background-02/);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
    .click();
  await page.getByRole("button", { name: "Background", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await expect
      .poll(() =>
        page
          .locator('[aria-label="Choose background"] img')
          .evaluateAll((imgs) =>
            imgs.every((im) => (im as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    if (i < 1)
      await page
        .getByRole("button", { name: "Next backgrounds", exact: true })
        .click();
  }
  await page
    .getByRole("button", { name: "Choose Pastel Aurora background" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.locator(".player-avatar img")).toHaveAttribute(
    "style",
    /background-12/,
  );
  await expect(page.locator(".player-avatar img")).toHaveAttribute(
    "src",
    /adventure-01/,
  );
});

test("frames preview all thirty assets and save with avatar and background", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
    .click();
  await page.getByRole("button", { name: "Background", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Ocean Teal background" })
    .click();
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await expect(
      page.locator('[aria-label="Choose frame"] .avatar-frame-overlay'),
    ).toHaveCount(i === 2 ? 6 : 12);
    await expect
      .poll(() =>
        page
          .locator('[aria-label="Choose frame"] .avatar-frame-overlay')
          .evaluateAll((imgs) =>
            imgs.every((im) => (im as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    if (i < 2)
      await page
        .getByRole("button", { name: "Next frames", exact: true })
        .click();
  }
  await page
    .getByRole("button", { name: "Choose Shadow Crystal frame", exact: true })
    .click();
  await page.screenshot({ path: `tmp/frames-${test.info().project.name}.png` });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(
    page.locator(".player-avatar .avatar-frame-overlay"),
  ).toHaveAttribute("src", /frame-30/);
  await expect(
    page.locator(".player-avatar .adventure-avatar"),
  ).toHaveAttribute("style", /background-02/);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("button", { name: "Next frames", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Choose No frame frame", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(
    page.locator(".player-avatar .avatar-frame-overlay"),
  ).toHaveCount(0);
});
