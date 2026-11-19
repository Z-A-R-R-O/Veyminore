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

test("frames preview all thirty assets and save with avatar and background", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Fox Explorer avatar" })
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
  ).not.toHaveAttribute("style", /background-/);
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

test("appearance controls and portrait layers stay visible at all screen sizes", async ({
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
    await page
      .getByRole("button", { name: "Choose Fox Explorer avatar" })
      .click();
    for (const category of ["Avatar", "Frame"]) {
      await page.getByRole("button", { name: category, exact: true }).click();
      const boxes = await page
        .locator(".adventure-picker button")
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
        );
      expect(boxes.length).toBe(12);
      for (const b of boxes) {
        expect(b.w).toBeGreaterThanOrEqual(30);
        expect(b.h).toBeGreaterThanOrEqual(30);
        expect(b.x + b.w).toBeLessThanOrEqual(width);
        expect(b.y + b.h).toBeLessThan(height);
      }
      const save = await page
        .getByRole("button", { name: "Save", exact: true })
        .boundingBox();
      expect(save!.y + save!.height).toBeLessThan(height);
      const preview = await page
        .locator(".portrait-live-preview")
        .boundingBox();
      expect(preview!.width).toBeGreaterThanOrEqual(48);
      if (category === "Frame") {
        await page
          .getByRole("button", { name: "Choose Ruby Laurel frame" })
          .click();
        await expect(
          page.locator(".portrait-live-preview .avatar-frame-overlay"),
        ).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `tmp/portrait-audit-${width}-${height}.png`,
        });
      }
    }
  }
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

test("badge collection loads all assets and fits every viewport", async ({
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
    await page.getByRole("button", { name: "Journey", exact: true }).click();
    await page.getByRole("button", { name: "Badges", exact: true }).click();
    for (let i = 0; i < 5; i++) {
      await expect(page.locator(".badge-grid img")).toHaveCount(6);
      await expect
        .poll(() =>
          page
            .locator(".badge-grid img")
            .evaluateAll((ims) =>
              ims.every((im) => (im as HTMLImageElement).naturalWidth > 0),
            ),
        )
        .toBe(true);
      expect(
        await page
          .locator(".player-profile")
          .evaluate(
            (el) =>
              el.scrollHeight <= el.clientHeight + 1 &&
              el.scrollWidth <= el.clientWidth + 1,
          ),
      ).toBe(true);
      if (i < 4)
        await page.getByRole("button", { name: "Next badges" }).click();
    }
    await expect(
      page.getByRole("button", { name: "Next badges" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Ethereal Legend", exact: true })
      .click();
    await expect(page.locator(".badge-detail")).toContainText(
      "Earn 120 campaign stars.",
    );
    await page.screenshot({ path: `tmp/badges-${width}-${height}.png` });
  }
});
