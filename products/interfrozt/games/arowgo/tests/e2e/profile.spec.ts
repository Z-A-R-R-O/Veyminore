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
  await expect(
    page.getByRole("button", { name: "Aurora: locked" }),
  ).toBeDisabled();
});
test("settings profile edit shortcut opens editor without backgrounds", async ({
  page,
}) => {
  await page.goto("/?account=1#settings");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page).toHaveURL(/#profile\/edit$/);
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Background", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("arowgo.profile.v1")!).avatarBackground,
    ),
  ).toBe("none");
});

test("profile portrait pencil opens editing", async ({ page }) => {
  await page.goto("/#profile");
  await page
    .getByRole("button", { name: "Edit portrait", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Avatar", exact: true }),
  ).toBeVisible();
});

test("all collections scroll to their final item with fixed controls", async ({
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
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    await page.getByRole("button", { name: "Avatar", exact: true }).click();
    await expect(page.locator(".adventure-picker button")).toHaveCount(33);
    const avatar = page.getByRole("button", {
      name: "Choose Celestial Dragon avatar",
    });
    await avatar.scrollIntoViewIfNeeded();
    await avatar.click();
    await page.getByRole("button", { name: "Frame", exact: true }).click();
    await expect(page.locator(".adventure-picker button")).toHaveCount(31);
    const frame = page.getByRole("button", {
      name: "Choose Shadow Crystal frame",
      exact: true,
    });
    await frame.scrollIntoViewIfNeeded();
    await frame.click();
    const save = page.getByRole("button", { name: "Save", exact: true });
    expect(
      (await save.boundingBox())!.y + (await save.boundingBox())!.height,
    ).toBeLessThan(height);
    await save.click();
    await expect(
      page.getByText("Profile saved.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Badges", exact: true }).click();
    await expect(page.locator(".badge-grid button")).toHaveCount(30);
    const badge = page.getByRole("button", {
      name: "Ethereal Legend",
      exact: true,
    });
    await badge.scrollIntoViewIfNeeded();
    await badge.click();
    await expect(page.locator(".badge-detail")).toContainText(
      "Earn 120 campaign stars.",
    );
    await page.screenshot({ path: `tmp/scroll-badges-${width}.png` });
    await page.getByRole("button", { name: "Arrows", exact: true }).click();
    await page.locator(".player-skin").last().scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".player-profile")
        .evaluate(
          (el) =>
            el.scrollHeight <= el.clientHeight + 1 &&
            el.scrollWidth <= el.clientWidth + 1,
        ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: /Next (avatars|frames|badges|arrows)/ }),
    ).toHaveCount(0);
  }
  await page.reload();
  await expect(
    page.locator(".player-avatar .adventure-avatar"),
  ).toHaveAttribute("src", "/assets/avatars/adventure-30.webp");
  await expect(
    page.locator(".player-avatar .avatar-frame-overlay"),
  ).toHaveAttribute("src", "/assets/avatars/frames/frame-30.webp");
});
