import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const bloom = Array.from({ length: 20 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`,
        "utf8",
      ),
    ),
  ),
);
const cove = Array.from({ length: 20 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(`content/levels/cove/level-${i + 21}.json`, "utf8"),
    ),
  ),
);
test("old Bloom progress unlocks Cove; all 20 new levels, lessons and rewards work", async ({
  page,
}) => {
  test.setTimeout(300000);
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "seed");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.addInitScript((values) => {
    if (!localStorage.getItem("cove-test-init")) {
      for (const [k, v] of values) localStorage.setItem(k, v);
      localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
      localStorage.setItem("arowgo.tutorial.keys.v1", "seen");
      localStorage.setItem("cove-test-init", "1");
    }
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#worlds");
  await expect(
    page.getByRole("heading", { name: "Verdant Cove", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play 21", exact: true }).click();
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  for (let i = 0; i < 20; i++) {
    if (i === 3 || i === 0) {
      await expect(
        page.getByRole("heading", {
          name: i === 3 ? "Weigh anchor" : "Mind the powder",
        }),
      ).toBeVisible();
      for (const id of i === 3 ? ["A", "B", "C"] : ["B", "A", "C"])
        await move(id);
      await page.getByRole("button", { name: "Continue to level" }).click();
    }
    await expect(
      page.getByRole("heading", { name: `Level ${i + 21}`, exact: true }),
    ).toBeVisible();
    if ([0, 3, 10, 19].includes(i))
      await page.screenshot({
        path: `docs/verification/cove-level-${i + 21}.png`,
      });
    for (const id of cove[i].solution) await move(id);
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Next level",
        exact: true,
      })
      .click();
  }
  await page.getByRole("button",{name:"Start puzzle",exact:true}).click();
  await expect(page.getByRole("heading", { name: "Level 41" })).toBeVisible();
  await page.goto("/#worlds");
  await page.reload();
  await expect(page.getByLabel("1000 total coins")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Frostfall Peaks", exact: true }),
  ).toBeVisible();
});

test("Cove map fits small phones and wide screens without hiding level controls", async ({
  page,
}) => {
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "seed");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
  }, saves);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#worlds");
    await page.getByRole("button", { name: "Choose world" }).click();
    await page.getByRole("button", { name: "Explore Verdant Cove" }).click();
    await expect(
      page.getByRole("heading", { name: "Verdant Cove", exact: true }),
    ).toBeVisible();
    const nodes = page.locator(".valley-stop");
    await expect(nodes).toHaveCount(10);
    for (const node of await nodes.all()) {
      const b = (await node.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(
        await node.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return e.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
        `Visible marker ${await node.getAttribute("aria-label")} at ${width}x${height}`,
      ).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: "docs/verification/cove-world-" + width + ".png",
    });
  }
});
