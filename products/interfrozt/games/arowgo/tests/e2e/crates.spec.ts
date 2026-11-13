import { test, expect } from "@playwright/test";
import { skins, guest } from "../../src/storage/profile";

test("paid opening saves once, reel lands on its reward, and reload preserves it", async ({
  page,
}) => {
  await page.goto("/#settings");
  await page.getByRole("checkbox").check();
  await page.goto("/#play/1");
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    const arrow = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(arrow).toBeEnabled();
    await arrow.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByRole("dialog", { name: "Level result" }),
  ).toBeVisible();
  await page.goto("/#settings");
  await page.getByRole("checkbox").uncheck();
  await page.goto("/#shop");
  await page
    .getByRole("button", { name: "Open · 10 coins", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Bloom Crate drop odds"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm opening" }).click();
  await expect(page.getByLabel("15 total coins")).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("arowgo.profile.v1")!),
  );
  expect(saved.openings).toBe(1);
  await expect(
    page.getByRole("button", { name: "Equip arrow", exact: true }),
  ).toBeVisible({ timeout: 8000 });
  const alignment = await page.evaluate(() => {
    const reel = document.querySelector(".crate-reel")!.getBoundingClientRect();
    const item = document
      .querySelectorAll(".reel-item")[28]
      .getBoundingClientRect();
    return Math.abs(reel.x + reel.width / 2 - item.x - item.width / 2);
  });
  expect(alignment).toBeLessThan(2);
  await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(
    skins.find((s) => s.id === saved.lastReward.skin)!.name,
  );
  await page.getByRole("button", { name: "Keep in collection" }).click();
  await page.reload();
  await expect(page.getByLabel("15 total coins")).toBeVisible();
  await page
    .getByRole("button", { name: "Open · 10 coins", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm opening" }).click();
  const mid = await page.evaluate(() =>
    localStorage.getItem("arowgo.profile.v1"),
  );
  await page.reload();
  expect(
    await page.evaluate(() => localStorage.getItem("arowgo.profile.v1")),
  ).toBe(mid);
  await expect(page.locator(".last-discovery")).toBeVisible();
});

test("storage failure keeps gift available and reduced motion skips the reel", async ({
  page,
}) => {
  await page.goto("/#shop");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restore: () => void }).restore = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "arowgo.profile.v1") throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Open gift" }).click();
  await page.getByRole("button", { name: "Open free crate" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Could not save this opening.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("arowgo.profile.v1")),
  ).toBeNull();
  await page.evaluate(() =>
    (window as unknown as { restore: () => void }).restore(),
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open gift" }).click();
  await page.getByRole("button", { name: "Open free crate" }).click();
  await expect(
    page.getByRole("button", { name: "Equip arrow", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reel-belt")).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Keep in collection" }).click();
  await page.getByRole("button", { name: "mythic", exact: true }).click();
  await expect(page.locator(".collectible")).toHaveCount(2);
});

test("all fifteen arrows render in gameplay with their effects and reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  for (const skin of skins) {
    await page.evaluate(
      ({ p, skin }) =>
        localStorage.setItem(
          "arowgo.profile.v1",
          JSON.stringify({
            ...p,
            owned: ["classic", ...(skin.id === "classic" ? [] : [skin.id])],
            equipped: skin.id,
          }),
        ),
      { p: guest(), skin },
    );
    await page.goto("/#play/1");
    await page.reload();
    await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute(
      "data-arrow-effect",
      skin.effect,
    );
    const color = await page
      .locator('[data-arrow="A"] .arrow-body')
      .evaluate((e) => getComputedStyle(e).stroke);
    const hex = skin.color.slice(1);
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    expect(color).toBe(rgb);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('[data-arrow="A"] .arrow-sheen')).toHaveCSS(
    "animation-name",
    "none",
  );
});
