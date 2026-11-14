import { test, expect } from "@playwright/test";
test("guest profile and crate unlock persist and equipped effects reach gameplay", async ({
  page,
}) => {
  await page.goto("/#profile");
  await page.getByLabel("Display name").fill("Zarro");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Zarro", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await page.getByRole("button", { name: "Open gift", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Open crate" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Open gift", exact: true }).click();
  await page
    .getByRole("button", { name: "Open free crate", exact: true })
    .click();
  await expect(
    page.getByText("Opening… your reward is already saved."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip animation" }).click();
  await expect(
    page.getByText("New arrow unlocked. Saved to your collection."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Equip arrow", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open gift", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("0 total coins")).toBeVisible();
  const profile = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("arowgo.profile.v1")!),
  );
  expect(profile.owned).toHaveLength(2);
  expect(profile.equipped).not.toBe("classic");
  await page.goto("/#play/1");
  await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-skin",
    profile.equipped,
  );
  const actual = await page
    .locator('[data-arrow="A"] .arrow-body')
    .evaluate((e) => getComputedStyle(e).stroke);
  expect(actual).not.toBe("rgb(66, 37, 99)");
  await expect(page.locator('[data-arrow="A"] .arrow-sheen')).not.toHaveCSS(
    "animation-name",
    "none",
  );
});
test("result appears after final exit and keeps stable full-screen bounds", async ({
  page,
}) => {
  await page.goto("/#play/1");
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
    const b = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(b).toBeEnabled();
    await b.focus();
    await page.keyboard.press("Enter");
  }
  const last = page.getByRole("button", { name: "Slide arrow J", exact: true });
  await expect(last).toBeEnabled();
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-arrow="J"]')).toHaveAttribute(
    "data-motion",
    "snake",
  );
  await expect(page.locator(".result-layer")).toHaveCount(0);
  await expect(page.locator(".result-layer")).toBeVisible();
  await expect(page.locator('[data-arrow="J"]')).toHaveCount(0);
  const frames = await page.evaluate(async () => {
    const out: {
      x: number;
      y: number;
      w: number;
      h: number;
      opacity: string;
    }[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame);
      const el = document.querySelector(".result-layer")!;
      const r = el.getBoundingClientRect();
      out.push({
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        opacity: getComputedStyle(el).opacity,
      });
    }
    return out;
  });
  for (const f of frames) {
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.w).toBe(page.viewportSize()!.width);
    expect(f.h).toBe(page.viewportSize()!.height);
    expect(f.opacity).toBe("1");
  }
  await expect(page.locator(".coin-reveal strong")).toHaveText("+25");
  await page.getByRole("button", { name: "Next level", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Level 02", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-layer")).toHaveCount(0);
});
