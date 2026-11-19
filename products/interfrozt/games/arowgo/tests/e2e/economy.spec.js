import { test, expect as baseExpect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { openWalletLedger } from "../../server/economy/wallet.mjs";
import { rewardLevels } from "../../server/economy/rewards.mjs";
import { validateSnapshot } from "../../server/account/cloud.mjs";
import { guest } from "../../src/storage/profile";
const expect=baseExpect.configure({timeout:15000});
const origin = "http://localhost:4173";
const connected = {
  schemaVersion: 1,
  account: { id: "ABC", kind: "linked", providers: ["google"], revision: 0 },
  csrfToken: "a".repeat(32),
  expiresAt: "2030-01-01T00:00:00.000Z",
};
test("reviewed migration, real ledger completion, lost chest response and reload preserve balances", async ({
  page,
}) => {
  const w = openWalletLedger(":memory:", { random: () => 0 });
  const profile = JSON.stringify({
    ...guest(),
    gems: 20,
    gemGiftClaimed: true,
    welcomeClaimed: true,
    name: "Keeper",
  });
  const backup = validateSnapshot({
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries: [
      { key: "arowgo.profile.v1", raw: profile },
      { key: "arowgo.tutorial.snake.v2", raw: "seen" },
    ],
  });
  const manifest = {
    accountId: "ABC",
    approvalId: randomUUID(),
    backupHash: createHash("sha256")
      .update(JSON.stringify(backup))
      .digest("hex"),
    coins: 0,
    gems: 20,
    cleared: [],
    owned: ["classic"],
    gemGiftClaimed: true,
    welcomeClaimed: true,
  };
  w.importReviewedLegacy("ABC", manifest.approvalId, manifest, backup);
  let loseChest = true;
  await page.route("**/api/arowgo/v1/account/**", async (route) => {
    if (route.request().url().endsWith("/session"))
      return route.fulfill({ json: connected });
    const b = route.request().postDataJSON();
    let result;
    try {
      if (b.expectedAccountId !== "ABC") throw Error("account-changed");
      switch (b.action) {
        case "wallet":
          result = { ...w.overview("ABC"), transactions: w.history("ABC") };
          break;
        case "begin":
          result = w.begin("ABC", b.operationId, b.levelId);
          break;
        case "complete":
          result = w.complete("ABC", b.operationId, b.attemptId, b.moves);
          break;
        case "chest":
          result = w.chest(
            "ABC",
            b.operationId,
            b.crateId,
            b.currency,
            b.welcome,
          );
          if (loseChest) {
            loseChest = false;
            return route.abort();
          }
          break;
        case "boost":
          result = w.boost("ABC", b.operationId, b.attemptId);
          break;
        default:
          throw Error("invalid-action");
      }
      return route.fulfill({ json: result });
    } catch (e) {
      return route.fulfill({ status: 409, json: { error: e.message } });
    }
  });
  try {
    await page.goto(origin + "/economy.html");
    await page.evaluate((entries) => {
      localStorage.clear();
      for (const e of entries) localStorage.setItem(e.key, e.raw);
    }, backup.entries);
    await page.reload();
    await expect(
      page.getByText("0 coins · 20 gems", { exact: false }),
    ).toBeVisible();
    await page.screenshot({path:`tmp/economy-review-${test.info().project.name}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page
      .getByRole("button", { name: "Use reviewed account wallet" })
      .click();
    await expect(page.locator(".player-name h1")).toHaveText("Keeper");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin + "/#play/1");
    await expect(page.getByRole("heading", {name:"Level 01", exact:true})).toBeVisible({timeout:15000});
    for (const id of rewardLevels[0].solution) {
      const b = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      });
      await expect(b).toBeEnabled();
      await b.focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      page.getByText("+25 coins saved to your account", { exact: true }),
    ).toBeVisible();
    expect(w.get("ABC").coins).toBe(25);
    await page.goto(origin + "/#shop");
    await page
      .getByRole("button", { name: "Open · 10 coins", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm opening" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Could not save this opening.", { exact: false }),
    ).toBeVisible();
    expect(w.get("ABC").coins).toBe(15);
    await page.getByRole("button", { name: "Confirm opening" }).click();
    await expect(
      page.getByRole("button", { name: "Equip arrow", exact: true }),
    ).toBeVisible();
    expect(w.get("ABC").coins).toBe(15);
    await page.reload();
    await expect(page.getByLabel("15 total coins")).toBeVisible();
    await expect(page.locator(".last-discovery")).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("arowgo.profile.v1")),
    ).toBe(profile);
    await page.goto(origin + "/#play/2");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Use Time Boost/ }).click();
    await expect.poll(() => w.get("ABC").gems).toBe(17);
    await page.reload();
    expect(w.get("ABC").gems).toBe(17);
  } finally {
    w.close();
  }
});
