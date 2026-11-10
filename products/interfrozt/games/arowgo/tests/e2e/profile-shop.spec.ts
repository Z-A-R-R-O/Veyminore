import { test, expect } from "@playwright/test";
test("guest profile, top settings, shop purchase and equipped skin persist", async ({
  page,
}) => {
  await page.goto("/#profile");
  await expect(
    page.getByRole("heading", { name: "Guest", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Settings" }),
  ).toHaveCount(0);
  await expect(
    page.locator("header").getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill("Zarro");
  await page.getByRole("button", { name: "Choose trophy avatar" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Zarro", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Need 25 more", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page.getByRole("button", { name: "Leave puzzle" }).click();
  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await page
    .getByRole("button", { name: "Buy · 25 coins", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("25 total coins")).toBeVisible();
  await page
    .getByRole("button", { name: "Buy · 25 coins", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm purchase" }).click();
  await expect(page.getByLabel("0 total coins")).toBeVisible();
  await expect(page.getByText("Aurora purchased and equipped.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("0 total coins")).toBeVisible();
  await expect(page.locator(".skin-card.equipped h2")).toHaveText("Aurora");
  await page.goto("/#play/1");
  await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
  await expect(page.locator('[data-arrow="A"] .arrow-body')).toHaveCSS(
    "stroke",
    "rgb(22, 122, 145)",
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
