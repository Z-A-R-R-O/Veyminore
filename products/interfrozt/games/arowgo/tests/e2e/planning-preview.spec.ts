import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 80 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : "amber"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);

test("dense mobile hold shows immediate effects and cancels without changing saves", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  const saves = levels.slice(0, 79).map((l, i) => {
    let s = newSession(l, "preview-seed");
    for (const id of l.solution)
      s = resolve(l, s, {
        id,
        attemptId: s.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`,
      JSON.stringify(s),
    ];
  });
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
    for (const k of Object.keys(localStorage))
      if (k.includes("amber-80")) localStorage.removeItem(k);
    for (const key of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
      "arowgo.lesson.ice",
      "arowgo.lesson.aurora",
    ])
      localStorage.setItem(key, "seen");
  }, saves);
  const client = await context.newCDPSession(page),
    level = levels[79],
    id = level.solution[0];
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/?hold-width=${width}#play/80`);
    await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
    const arrow = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      }),
      b = (await arrow.boundingBox())!,
      x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    const snapshot = () =>
      page.evaluate(() =>
        JSON.stringify(
          Object.keys(localStorage)
            .sort()
            .map((k) => [k, localStorage.getItem(k)]),
        ),
      );
    const before = await snapshot();
    const start = () =>
      client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
    const end = () =>
      client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    await start();
    await expect(page.locator(".path-preview-label strong")).toHaveText(
      "Path open",
    );
    await expect(page.locator(".path-preview-label")).toContainText(
      "Kegs / ice −1",
    );
    await expect(page.locator(".path-preview-label")).toContainText(
      "Phases flip",
    );
    for (const ring of await page.locator("[data-preview-change]").all()) {
      const before = Number(await ring.getAttribute("data-before")),
        after = Number(await ring.getAttribute("data-after")),
        kind = await ring.getAttribute("data-preview-change");
      expect(after).toBe(
        kind === "phase" ? 1 - before : Math.max(0, before - 1),
      );
    }
    const board = (await page.getByTestId("board").boundingBox())!,
      label = (await page.locator(".path-preview-label").boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(board.x);
    expect(label.x + label.width).toBeLessThanOrEqual(
      board.x + board.width + 1,
    );
    expect(label.y + label.height).toBeLessThanOrEqual(
      board.y + board.height + 1,
    );
    await page.screenshot({
      path: `tmp/planning-hold-${info.project.name}-${width}.png`,
      scale: "css",
    });
    await end();
    await expect(page.locator(".hold-preview")).toHaveCount(0);
    expect(await snapshot()).toBe(before);
    await expect(arrow).toHaveCount(1);
    await start();
    await expect(page.locator(".path-preview")).toBeVisible();
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 25, y }],
    });
    await end();
    await expect(page.locator(".hold-preview")).toHaveCount(0);
    expect(await snapshot()).toBe(before);
    await start();
    await expect(page.locator(".path-preview")).toBeVisible();
    await client.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(page.locator(".hold-preview")).toHaveCount(0);
    expect(await snapshot()).toBe(before);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start();
    await expect(page.locator(".path-preview")).toBeVisible();
    await expect(page.locator(".preview-route")).toHaveCSS(
      "animation-name",
      "none",
    );
    await end();
    await expect(page.locator(".hold-preview")).toHaveCount(0);
    await arrow.focus();
    await page.keyboard.down("p");
    await expect(page.locator(".path-preview")).toBeVisible();
    await page.keyboard.press("Enter");
    expect(await snapshot()).toBe(before);
    await page.keyboard.press("Escape");
    await page.keyboard.up("p");
    await expect(page.locator(".hold-preview")).toHaveCount(0);
    await page.touchscreen.tap(x, y).catch(async () => {
      await page.mouse.click(x, y);
    });
    await expect(arrow).toHaveCount(0);
  }
});
