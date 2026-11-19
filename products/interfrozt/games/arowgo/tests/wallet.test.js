import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWalletLedger } from "../server/economy/wallet.mjs";
import { rewardLevels, verifyClear } from "../server/economy/rewards.mjs";
import { createAccountService } from "../server/account/service.mjs";
const first = rewardLevels[0];
function clear(w, account = "ABC") {
  const attempt = w.begin(account, randomUUID(), first.levelId);
  return { attempt, op: randomUUID(), moves: first.solution };
}
describe("server wallet and reward ledger", () => {
  it("starts separate from legacy balances and does not create wallets on reads", () => {
    const w = openWalletLedger(":memory:");
    try {
      expect(w.get("ABC")).toBeNull();
      expect(w.history("ABC")).toEqual([]);
    } finally {
      w.close();
    }
  });
  it("commits 25 coins and its first-clear receipt exactly once", () => {
    const w = openWalletLedger(":memory:");
    try {
      const a = clear(w);
      const result = w.complete("ABC", a.op, a.attempt.attemptId, a.moves);
      expect(result.wallet).toMatchObject({ coins: 25, gems: 0, revision: 1 });
      expect(w.complete("ABC", a.op, a.attempt.attemptId, a.moves)).toEqual(
        result,
      );
      expect(
        w.complete("ABC", randomUUID(), a.attempt.attemptId, a.moves).awarded,
      ).toBe(0);
      const b = clear(w);
      expect(
        w.complete("ABC", b.op, b.attempt.attemptId, b.moves).awarded,
      ).toBe(0);
      expect(w.history("ABC")).toHaveLength(1);
    } finally {
      w.close();
    }
  });
  it("rejects operation ID reuse with different contents", () => {
    const w = openWalletLedger(":memory:");
    try {
      const a = clear(w);
      w.complete("ABC", a.op, a.attempt.attemptId, a.moves);
      expect(() => w.complete("ABC", a.op, a.attempt.attemptId, [])).toThrow(
        "operation-conflict",
      );
      expect(w.get("ABC").coins).toBe(25);
    } finally {
      w.close();
    }
  });
  it("binds attempts to account and server content and rejects incomplete moves", () => {
    const w = openWalletLedger(":memory:");
    try {
      const a = clear(w);
      expect(() =>
        w.complete("DEF", a.op, a.attempt.attemptId, a.moves),
      ).toThrow("invalid-attempt");
      expect(w.get("DEF")).toBeNull();
      expect(() => w.complete("ABC", a.op, a.attempt.attemptId, [])).toThrow(
        "incomplete-level",
      );
      expect(() =>
        w.complete("ABC", a.op, a.attempt.attemptId, ["invented"]),
      ).toThrow("invalid-completion");
      expect(w.get("ABC").coins).toBe(0);
      expect(w.history("ABC")).toEqual([]);
    } finally {
      w.close();
    }
  });
  it("rejects expired attempts and locked campaign levels", () => {
    let time = 0;
    const w = openWalletLedger(":memory:", { now: () => time });
    try {
      expect(() =>
        w.begin("ABC", randomUUID(), rewardLevels[1].levelId),
      ).toThrow("level-locked");
      const a = clear(w);
      time = 86400001;
      expect(() =>
        w.complete("ABC", a.op, a.attempt.attemptId, a.moves),
      ).toThrow("invalid-attempt");
    } finally {
      w.close();
    }
  });
  it("uses current canonical rules for all 80 levels", () => {
    expect(rewardLevels).toHaveLength(80);
    for (const l of rewardLevels) {
      expect(verifyClear(l.levelId, l.contentVersion, l.solution)).toBe(true);
      expect(() =>
        verifyClear(l.levelId, l.contentVersion + 1, l.solution),
      ).toThrow();
    }
  });
  it("durably retains wallet and receipts across reopening and independent connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "arowgo-ledger-"));
    const path = join(dir, "test.sqlite");
    let w = openWalletLedger(path);
    try {
      const a = clear(w);
      const receipt = w.complete("ABC", a.op, a.attempt.attemptId, a.moves);
      w.close();
      w = openWalletLedger(path);
      const second = openWalletLedger(path);
      try {
        expect(w.complete("ABC", a.op, a.attempt.attemptId, a.moves)).toEqual(
          receipt,
        );
        expect(
          second.complete("ABC", randomUUID(), a.attempt.attemptId, a.moves)
            .awarded,
        ).toBe(0);
        expect(second.get("ABC").coins).toBe(25);
      } finally {
        second.close();
      }
    } finally {
      w.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rolls back invalid begins without leaving a new wallet", () => {
    const w = openWalletLedger(":memory:");
    try {
      expect(() => w.begin("ABC", randomUUID(), "fake")).toThrow();
      expect(w.get("ABC")).toBeNull();
    } finally {
      w.close();
    }
  });
  it("keeps the endpoint disabled without an explicitly supplied ledger", () => {
    const service = createAccountService({ provider: {} });
    expect(() =>
      service.economyCommand("bad", "bad", { action: "wallet" }),
    ).toThrow("economy-disabled");
  });
  it("requires authenticated session and CSRF, deriving the owner from the session", async () => {
    const w = openWalletLedger(":memory:");
    try {
      const service = createAccountService({
        provider: { login: async () => ({ id: "ABC", ticket: "secret" }) },
        verifyIdentity: async () => {},
        economy: w,
      });
      const a = service.bootstrap();
      expect(() =>
        service.economyCommand(a.id, a.data.csrfToken, { action: "wallet" }),
      ).toThrow("unauthorized");
      const flow = service.flow(a.id, a.data.csrfToken, "sign-in");
      const b = await service.google(a.id, a.data.csrfToken, "sign-in", {
        schemaVersion: 1,
        operationId: randomUUID(),
        idToken: "test",
        flowId: flow.flowId,
      });
      expect(() =>
        service.economyCommand(b.id, "wrong", { action: "wallet" }),
      ).toThrow("forbidden");
      service.economyCommand(b.id, b.data.csrfToken, {
        action: "begin",
        operationId: randomUUID(),
        levelId: first.levelId,
        accountId: "DEF",
        coins: 999,
      });
      expect(w.get("ABC").coins).toBe(0);
      expect(w.get("DEF")).toBeNull();
    } finally {
      w.close();
    }
  });
});
