import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { openWalletLedger } from "../../server/economy/wallet.mjs";
import { guest } from "../../src/storage/profile";
import { rewardLevels as levels } from "../../server/economy/rewards.mjs";
import { newSession } from "../../src/application/session";
const origin = "http://localhost:4173";
test("two devices restore account progress without copying local currency; stale preview is rejected", async ({
  browser,
  viewport,
}) => {
  const w = openWalletLedger(":memory:");
  const state = {
    ...newSession(levels[0], randomUUID()),
    claimed: true,
    bestStars: 3,
    coins: 25,
  };
  const entries = [
    { key: "arowgo.profile.v1", raw: JSON.stringify(guest()) },
    { key: "arowgo.slice.v1", raw: JSON.stringify(state) },
  ];
  const backup = {
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries,
  };
  const manifest = {
    accountId: "ABC",
    approvalId: randomUUID(),
    backupHash: createHash("sha256")
      .update(JSON.stringify(backup))
      .digest("hex"),
    coins: 25,
    gems: 20,
    cleared: [levels[0].levelId],
    owned: ["classic", "mint"],
    gemGiftClaimed: true,
    welcomeClaimed: true,
  };
  w.importReviewedLegacy("ABC", manifest.approvalId, manifest, backup);
  const contexts = [];
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      await context.route("**/api/arowgo/v1/account/**", async (route) => {
        if (route.request().url().endsWith("/session"))
          return route.fulfill({
            json: {
              schemaVersion: 1,
              account: {
                id: "ABC",
                kind: "linked",
                providers: ["google"],
                revision: 0,
              },
              csrfToken: "a".repeat(32),
              expiresAt: "2030-01-01T00:00:00.000Z",
            },
          });
        return route.fulfill({
          json: { ...w.overview("ABC"), transactions: w.history("ABC") },
        });
      });
      const page = await context.newPage();
      await page.goto(origin + "/economy.html");
      const local = JSON.stringify({
        ...guest(),
        gems: 91 + i,
        name: "Device " + i,
      });
      await page.evaluate(
        (raw) => localStorage.setItem("arowgo.profile.v1", raw),
        local,
      );
      await page.reload();
      await page
        .getByRole("button", {
          name: "Restore account progress on this device",
        })
        .click();
      await expect(page.locator("#summary")).toContainText("3 stars");
      if (i === 1) {
        w.equip(
          "ABC",
          randomUUID(),
          "mint",
          w.overview("ABC").preference.revision,
        );
        await page
          .getByRole("button", { name: "Confirm restore", exact: true })
          .click();
        await expect(page.locator("#status")).toContainText(
          "Account progress changed",
        );
        expect(
          await page.evaluate(() =>
            localStorage.getItem("arowgo.economy.binding.v1"),
          ),
        ).toBeNull();
        await page
          .getByRole("button", {
            name: "Restore account progress on this device",
          })
          .click();
      }
      const before = w.overview("ABC").wallet;
      await page
        .getByRole("button", { name: "Confirm restore", exact: true })
        .click();
      await expect(page).toHaveURL(/#profile/);
      expect(
        await page.evaluate(() => localStorage.getItem("arowgo.profile.v1")),
      ).toBe(local);
      const restored = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("arowgo.economy.ABC.save.arowgo.slice.v1"),
        ),
      );
      expect(restored.claimed).toBe(true);
      expect(restored.bestStars).toBe(3);
      expect(w.overview("ABC").wallet).toEqual(before);
    }
  } finally {
    for (const c of contexts) await c.close();
    w.close();
  }
});
