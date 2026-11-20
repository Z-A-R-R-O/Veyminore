import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSessionStore } from "../server/account/session-store.mjs";
import { createRateLimiter } from "../server/account/rate-limiter.mjs";
import { openWalletLedger } from "../server/economy/wallet.mjs";
import {
  verifyLedgerIntegrity,
  createLedgerBackup,
  restoreLedgerBackup,
} from "../server/economy/backup.mjs";
import { createAccountService } from "../server/account/service.mjs";
import { createAccountServer } from "../server/account/http.mjs";

describe("Production Account and Ledger Infrastructure", () => {
  it("persists sessions durably across store reloads and syncs mutations via proxy", () => {
    const dir = mkdtempSync(join(tmpdir(), "arowgo-session-test-"));
    const dbPath = join(dir, "sessions.sqlite");
    let now = 100000;
    let store1;
    let store2;

    try {
      // 1. Initial store session creation and mutation
      store1 = openSessionStore(dbPath, { now: () => now });
      const sessionId = "sess-uuid-1234";
      store1.set(sessionId, {
        csrf: "csrf-token-abc",
        expires: now + 3600000,
        account: null,
        ticket: null,
        flow: null,
        busy: false,
        cloudBusy: false,
        attempts: [],
      });

      const loaded1 = store1.get(sessionId);
      expect(loaded1).toBeDefined();
      expect(loaded1.csrf).toBe("csrf-token-abc");

      // Mutate properties through proxy
      loaded1.account = { id: "PLAYFAB_123", name: "PlayerOne" };
      loaded1.ticket = "session-ticket-xyz";
      loaded1.attempts.push(now);

      store1.close();
      store1 = null;

      // 2. Re-open store from the same SQLite file (simulating server restart)
      store2 = openSessionStore(dbPath, { now: () => now });
      const reloaded = store2.get(sessionId);

      expect(reloaded).toBeDefined();
      expect(reloaded.csrf).toBe("csrf-token-abc");
      expect(reloaded.account).toEqual({ id: "PLAYFAB_123", name: "PlayerOne" });
      expect(reloaded.ticket).toBe("session-ticket-xyz");
      expect(reloaded.attempts).toEqual([now]);
      expect(store2.size).toBe(1);

      // 3. Test TTL expiration
      now += 3600000 + 1000; // Fast-forward past expiry
      expect(store2.get(sessionId)).toBeUndefined();
      expect(store2.size).toBe(0);
    } finally {
      store1?.close();
      store2?.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("enforces sliding-window IP rate limiting with Retry-After calculation", () => {
    let now = 50000;
    const limiter = createRateLimiter({
      windowMs: 10000, // 10 second window
      maxRequests: 3,
      now: () => now,
    });

    const ip = "192.168.1.100";
    const ip2 = "192.168.1.200";

    // 3 requests allowed
    expect(limiter.check(ip).allowed).toBe(true);
    now += 1000;
    expect(limiter.check(ip).allowed).toBe(true);
    now += 1000;
    expect(limiter.check(ip).allowed).toBe(true);

    // 4th request rejected
    const blocked = limiter.check(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);

    // Second IP is not affected
    expect(limiter.check(ip2).allowed).toBe(true);

    // After window slides past oldest timestamp, client is unblocked
    now += 9000;
    const retry = limiter.check(ip);
    expect(retry.allowed).toBe(true);
  });

  it("backs up ledger atomically with manifest, validates invariants, and detects corruption", () => {
    const dir = mkdtempSync(join(tmpdir(), "arowgo-backup-test-"));
    const dbPath = join(dir, "economy.sqlite");
    const backupDir = join(dir, "backups");
    let now = 200000;
    let ledger;

    try {
      // 1. Initialize ledger and record initial activity
      ledger = openWalletLedger(dbPath, { now: () => now });
      const accountId = "A1B2C3D4";

      // Gift welcome chest and starter gems
      ledger.gift(accountId, "00000000-0000-4000-8000-000000000001");
      const walletBefore = ledger.get(accountId);
      expect(walletBefore.gems).toBe(20);

      // Verify integrity before backup
      const preCheck = verifyLedgerIntegrity(dbPath);
      expect(preCheck.ok).toBe(true);
      expect(preCheck.stats.accountCount).toBe(1);
      expect(preCheck.stats.totalGems).toBe(20);

      // Close ledger handle so backup/VACUUM and raw file checks can run cleanly
      ledger.close();
      ledger = null;

      // 2. Perform online point-in-time backup
      const backupResult = createLedgerBackup(dbPath, backupDir, { now: () => now });
      expect(existsSync(backupResult.backupPath)).toBe(true);
      expect(existsSync(backupResult.manifestPath)).toBe(true);
      expect(backupResult.manifest.status).toBe("verified");
      expect(backupResult.manifest.stats.totalGems).toBe(20);
      expect(typeof backupResult.manifest.sha256).toBe("string");

      // 3. Corrupt an entry in an isolated copy to verify fraud/corruption detection
      const corruptDbPath = join(dir, "corrupt.sqlite");
      const rawDbBytes = readFileSync(dbPath);
      writeFileSync(corruptDbPath, rawDbBytes);

      const corruptDb = new DatabaseSync(corruptDbPath);
      // Falsify coin balance without matching ledger entry
      corruptDb.exec("UPDATE wallets SET coins = 999999 WHERE account = 'A1B2C3D4'");
      corruptDb.close();

      expect(() => verifyLedgerIntegrity(corruptDbPath)).toThrow(/Coin balance mismatch/);
    } finally {
      ledger?.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("restores ledger safely, creating a pre-restore backup and verifying restored state", () => {
    const dir = mkdtempSync(join(tmpdir(), "arowgo-restore-test-"));
    const dbPath = join(dir, "economy.sqlite");
    const backupDir = join(dir, "backups");
    let now = 300000;
    let ledger;
    let restoredLedger;

    try {
      // 1. Create initial state
      ledger = openWalletLedger(dbPath, { now: () => now });
      const accountId = "A1B2C3D4";
      ledger.gift(accountId, "00000000-0000-4000-8000-000000000002");
      expect(ledger.get(accountId).gems).toBe(20);
      ledger.close();
      ledger = null;

      // 2. Backup initial state
      const backupResult = createLedgerBackup(dbPath, backupDir, { now: () => now });

      // 3. Mutate state after backup
      now += 1000;
      ledger = openWalletLedger(dbPath, { now: () => now });
      ledger.chest(
        accountId,
        "00000000-0000-4000-8000-000000000003",
        "celestial",
        "gems",
        false
      );
      // Celestial crate costs 4 gems; gems should decrease from 20
      expect(ledger.get(accountId).gems).toBeLessThan(20);
      ledger.close();
      ledger = null;

      // 4. Restore database from backup
      now += 1000;
      const restoreResult = restoreLedgerBackup(backupResult.backupPath, dbPath, {
        now: () => now,
      });

      expect(restoreResult.restored).toBe(true);
      expect(existsSync(restoreResult.safetyBackupPath)).toBe(true);
      expect(restoreResult.stats.totalGems).toBe(20);

      // Re-open restored database and confirm exact balance
      restoredLedger = openWalletLedger(dbPath, { now: () => now });
      expect(restoredLedger.get(accountId).gems).toBe(20);
    } finally {
      ledger?.close();
      restoredLedger?.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("responds to /api/arowgo/v1/health probe and applies rate limiting at HTTP layer", async () => {
    const service = createAccountService({
      provider: { login: async () => {}, link: async () => {} },
      verifyIdentity: async () => {},
    });

    const rateLimiter = createRateLimiter({
      windowMs: 5000,
      maxRequests: 2,
    });

    const server = createAccountServer({
      service,
      rateLimiter,
      origin: "http://localhost:4173",
      isProduction: false,
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/arowgo/v1`;

    try {
      // 1. Health endpoint returns 200 without requiring auth or custom origin
      const healthRes = await fetch(`${base}/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe("ok");
      expect(healthData.service).toBe("arowgo-account");
      expect(typeof healthData.uptimeSeconds).toBe("number");

      // 2. Test HTTP-level rate limiting on session endpoint
      function callSession() {
        return new Promise((resolve, reject) => {
          const req = httpRequest(
            `${base}/account/session`,
            {
              method: "GET",
              headers: {
                Host: "localhost:4173",
                Origin: "http://localhost:4173",
              },
            },
            (res) => {
              const chunks = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => {
                let json = {};
                try {
                  json = JSON.parse(Buffer.concat(chunks).toString());
                } catch {}
                resolve({
                  status: res.statusCode,
                  headers: res.headers,
                  json,
                });
              });
            },
          );
          req.on("error", reject);
          req.end();
        });
      }

      const res1 = await callSession();
      expect(res1.status).toBe(200);

      const res2 = await callSession();
      expect(res2.status).toBe(200);

      // 3rd request should hit rate limit (maxRequests: 2)
      const res3 = await callSession();
      expect(res3.status).toBe(429);
      expect(res3.headers["retry-after"]).toBeDefined();
      expect(res3.json.error).toBe("rate-limited");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
