import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash, randomInt } from "node:crypto";
import { rewardLevels, verifyClear } from "./rewards.mjs";
import {
  crates,
  gemPrices,
  rollSkin,
  skins,
  TIME_BOOST_COST,
} from "../../src/storage/profile.ts";
import { validateSnapshot } from "../account/cloud.mjs";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
/** Single-host development ledger. Never place its database in public/ or cloud snapshots. */
export function openWalletLedger(
  path,
  { now = Date.now, random = () => randomInt(0, 4294967296) / 4294967296 } = {},
) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS wallets(account TEXT PRIMARY KEY, coins INTEGER NOT NULL CHECK(coins>=0 AND coins<=1000000000), gems INTEGER NOT NULL CHECK(gems>=0 AND gems<=1000000000), revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,account TEXT NOT NULL,level TEXT NOT NULL,content INTEGER NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(account) REFERENCES wallets(account));
 CREATE TABLE IF NOT EXISTS clears(account TEXT NOT NULL,level TEXT NOT NULL,attempt TEXT NOT NULL,PRIMARY KEY(account,level));
 CREATE TABLE IF NOT EXISTS operations(account TEXT NOT NULL,operation TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(account,operation));
 CREATE TABLE IF NOT EXISTS inventory(account TEXT NOT NULL,skin TEXT NOT NULL,PRIMARY KEY(account,skin));
 CREATE TABLE IF NOT EXISTS claims(account TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(account,kind));
 CREATE TABLE IF NOT EXISTS finished(attempt TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS boosts(account TEXT NOT NULL,attempt TEXT NOT NULL,PRIMARY KEY(account,attempt));
 CREATE TABLE IF NOT EXISTS progress(account TEXT NOT NULL,level TEXT NOT NULL,stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 3),PRIMARY KEY(account,level));
 CREATE TABLE IF NOT EXISTS attempt_scores(attempt TEXT PRIMARY KEY,stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 3));
 CREATE TABLE IF NOT EXISTS preferences(account TEXT PRIMARY KEY,equipped TEXT NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS imports(account TEXT PRIMARY KEY,approval TEXT NOT NULL,manifest TEXT NOT NULL,backup TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS ledger(sequence INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT NOT NULL,operation TEXT NOT NULL,reason TEXT NOT NULL,coins INTEGER NOT NULL,gems INTEGER NOT NULL,created INTEGER NOT NULL,UNIQUE(account,operation));`);
  const query = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function seedReviewed(account, backup, replacing = false) {
    const entries = backup.entries ?? [];
    for (const { level } of db
      .prepare("SELECT level FROM clears WHERE account=?")
      .all(account)) {
      const index = rewardLevels.findIndex((l) => l.levelId === level);
      const key = index === 0 ? "arowgo.slice.v1" : `arowgo.level.${level}.v1`;
      let stars = 1;
      try {
        const saved = JSON.parse(
          entries.find((e) => e.key === key)?.raw ?? "null",
        );
        if (
          saved?.levelId === level &&
          saved.claimed &&
          Number.isInteger(saved.bestStars) &&
          saved.bestStars >= 1 &&
          saved.bestStars <= 3
        )
          stars = saved.bestStars;
      } catch {
        /* Keep the reviewed clear even without a usable star record. */
      }
      run(
        "INSERT OR IGNORE INTO progress VALUES(?,?,?)",
        account,
        level,
        stars,
      );
    }
    let equipped = "classic";
    try {
      const profile = JSON.parse(
        entries.find((e) => e.key === "arowgo.profile.v1")?.raw ?? "null",
      );
      if (
        typeof profile?.equipped === "string" &&
        query(
          "SELECT 1 FROM inventory WHERE account=? AND skin=?",
          account,
          profile.equipped,
        )
      )
        equipped = profile.equipped;
    } catch {
      /* Preserve inventory; use the default if no preference was recorded. */
    }
    run(
      replacing
        ? "INSERT INTO preferences VALUES(?,?,0) ON CONFLICT(account) DO UPDATE SET equipped=excluded.equipped WHERE preferences.revision=0"
        : "INSERT OR IGNORE INTO preferences VALUES(?,?,0)",
      account,
      equipped,
    );
  }
  // Additive upgrade: previously reviewed data seeds only missing rows.
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db.prepare("SELECT account,backup FROM imports").all())
      seedReviewed(row.account, JSON.parse(row.backup));
    db.exec(
      "INSERT OR IGNORE INTO progress SELECT account,level,1 FROM clears; INSERT OR IGNORE INTO preferences SELECT account,'classic',0 FROM wallets; COMMIT;",
    );
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  function identity(account) {
    if (typeof account !== "string" || !/^[A-F0-9]{1,64}$/i.test(account))
      throw Error("invalid-account");
  }
  function wallet(account) {
    const row = query(
      "SELECT coins,gems,revision FROM wallets WHERE account=?",
      account,
    );
    return row
      ? { coins: row.coins, gems: row.gems, revision: row.revision }
      : null;
  }
  function transact(account, operation, payload, action) {
    identity(account);
    if (!uuid(operation)) throw Error("invalid-operation");
    db.exec("BEGIN IMMEDIATE");
    try {
      const hash = digest(payload),
        previous = query(
          "SELECT hash,result FROM operations WHERE account=? AND operation=?",
          account,
          operation,
        );
      if (previous) {
        if (previous.hash !== hash) throw Error("operation-conflict");
        db.exec("COMMIT");
        return JSON.parse(previous.result);
      }
      run("INSERT OR IGNORE INTO wallets VALUES(?,0,0,0)", account);
      run("INSERT OR IGNORE INTO inventory VALUES(?,?)", account, "classic");
      const result = action();
      run(
        "INSERT INTO operations VALUES(?,?,?,?)",
        account,
        operation,
        hash,
        JSON.stringify(result),
      );
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    close: () => db.close(),
    get(account) {
      identity(account);
      return wallet(account);
    },
    history(account) {
      identity(account);
      return db
        .prepare(
          "SELECT sequence,operation,reason,coins,gems,created FROM ledger WHERE account=? ORDER BY sequence DESC LIMIT 100",
        )
        .all(account);
    },
    begin(account, operation, levelId) {
      return transact(account, operation, { type: "begin", levelId }, () => {
        const index = rewardLevels.findIndex((l) => l.levelId === levelId);
        if (index < 0) throw Error("unknown-level");
        if (
          index > 0 &&
          !query(
            "SELECT 1 FROM clears WHERE account=? AND level=?",
            account,
            rewardLevels[index - 1].levelId,
          )
        )
          throw Error("level-locked");
        const active = query(
          "SELECT count(*) AS count FROM attempts WHERE account=? AND expires>? AND id NOT IN (SELECT attempt FROM finished)",
          account,
          now(),
        );
        if (active.count >= 100) throw Error("too-many-attempts");
        const attemptId = randomUUID(),
          expiresAt = now() + 24 * 60 * 60 * 1000;
        run(
          "INSERT INTO attempts VALUES(?,?,?,?,?)",
          attemptId,
          account,
          levelId,
          rewardLevels[index].contentVersion,
          expiresAt,
        );
        return {
          attemptId,
          levelId,
          contentVersion: rewardLevels[index].contentVersion,
          expiresAt,
        };
      });
    },
    complete(account, operation, attemptId, moves, elapsedMs) {
      return transact(
        account,
        operation,
        { type: "complete", attemptId, moves, elapsedMs },
        () => {
          const attempt = query(
            "SELECT * FROM attempts WHERE id=? AND account=?",
            attemptId,
            account,
          );
          if (!attempt || attempt.expires <= now())
            throw Error("invalid-attempt");
          const { mistakes } = verifyClear(
            attempt.level,
            attempt.content,
            moves,
            true,
          );
          if (
            elapsedMs !== undefined &&
            (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0)
          )
            throw Error("invalid-completion");
          const priorScore = query(
            "SELECT stars FROM attempt_scores WHERE attempt=?",
            attemptId,
          );
          const level = rewardLevels.find((l) => l.levelId === attempt.level);
          const target =
            Math.max(60000, level.arrows.length * 8000) +
            (query(
              "SELECT 1 FROM boosts WHERE account=? AND attempt=?",
              account,
              attemptId,
            )
              ? 30000
              : 0);
          // Elapsed time is client-reported. It affects stars only, never wallet awards.
          const stars =
            priorScore?.stars ??
            1 +
              Number(mistakes === 0) +
              Number(elapsedMs !== undefined && elapsedMs <= target);
          run(
            "INSERT OR IGNORE INTO attempt_scores VALUES(?,?)",
            attemptId,
            stars,
          );
          const previousStars =
            query(
              "SELECT stars FROM progress WHERE account=? AND level=?",
              account,
              attempt.level,
            )?.stars ?? 0;
          run(
            "INSERT INTO progress VALUES(?,?,?) ON CONFLICT(account,level) DO UPDATE SET stars=MAX(progress.stars,excluded.stars)",
            account,
            attempt.level,
            stars,
          );
          run("INSERT OR IGNORE INTO finished VALUES(?)", attemptId);
          const existing = query(
            "SELECT 1 FROM clears WHERE account=? AND level=?",
            account,
            attempt.level,
          );
          if (!existing) {
            run(
              "INSERT INTO clears VALUES(?,?,?)",
              account,
              attempt.level,
              attemptId,
            );
            run(
              "UPDATE wallets SET coins=coins+25,revision=revision+1 WHERE account=?",
              account,
            );
            run(
              "INSERT INTO ledger(account,operation,reason,coins,gems,created) VALUES(?,?,?,25,0,?)",
              account,
              operation,
              `first-clear:${attempt.level}`,
              now(),
            );
          } else if (stars > previousStars)
            run(
              "UPDATE wallets SET revision=revision+1 WHERE account=?",
              account,
            );
          return {
            awarded: existing ? 0 : 25,
            stars,
            bestStars: Math.max(previousStars, stars),
            wallet: wallet(account),
          };
        },
      );
    },
    inventory(account) {
      identity(account);
      return db
        .prepare("SELECT skin FROM inventory WHERE account=? ORDER BY skin")
        .all(account)
        .map((row) => row.skin);
    },
    equip(account, operation, skin, expectedRevision) {
      return transact(
        account,
        operation,
        { type: "equip", skin, expectedRevision },
        () => {
          if (
            typeof skin !== "string" ||
            !query(
              "SELECT 1 FROM inventory WHERE account=? AND skin=?",
              account,
              skin,
            )
          )
            throw Error("skin-not-owned");
          const preference = query(
            "SELECT equipped,revision FROM preferences WHERE account=?",
            account,
          ) ?? { equipped: "classic", revision: 0 };
          if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
            throw Error("invalid-preference");
          if (preference.equipped === skin) return preference;
          if (preference.revision !== expectedRevision)
            throw Error("preference-conflict");
          run(
            "INSERT INTO preferences VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET equipped=excluded.equipped,revision=excluded.revision",
            account,
            skin,
            preference.revision + 1,
          );
          run(
            "UPDATE wallets SET revision=revision+1 WHERE account=?",
            account,
          );
          return { equipped: skin, revision: preference.revision + 1 };
        },
      );
    },
    gift(account, operation) {
      return transact(account, operation, { type: "gift" }, () => {
        if (
          query(
            "SELECT 1 FROM claims WHERE account=? AND kind=?",
            account,
            "gem-gift",
          )
        )
          return { awarded: 0, wallet: wallet(account) };
        run("INSERT INTO claims VALUES(?,?)", account, "gem-gift");
        run(
          "UPDATE wallets SET gems=gems+20,revision=revision+1 WHERE account=?",
          account,
        );
        run(
          "INSERT INTO ledger(account,operation,reason,coins,gems,created) VALUES(?,?,?,0,20,?)",
          account,
          operation,
          "gem-gift",
          now(),
        );
        return { awarded: 20, wallet: wallet(account) };
      });
    },
    chest(account, operation, crateId, currency, welcome = false) {
      return transact(
        account,
        operation,
        { type: "chest", crateId, currency, welcome },
        () => {
          const crate = crates.find((c) => c.id === crateId);
          if (
            !crate ||
            !["coins", "gems"].includes(currency) ||
            typeof welcome !== "boolean" ||
            (welcome && crateId !== "bloom")
          )
            throw Error("invalid-purchase");
          if (
            welcome &&
            query(
              "SELECT 1 FROM claims WHERE account=? AND kind=?",
              account,
              "welcome-chest",
            )
          )
            throw Error("already-claimed");
          const price = welcome
            ? 0
            : currency === "coins"
              ? crate.price
              : gemPrices[crateId];
          if (wallet(account)[currency] < price)
            throw Error("insufficient-funds");
          const skin = rollSkin(crateId, random(), random());
          const duplicate = !!query(
            "SELECT 1 FROM inventory WHERE account=? AND skin=?",
            account,
            skin,
          );
          const refund = duplicate ? Math.floor(price / 2) : 0,
            delta = refund - price;
          run("INSERT OR IGNORE INTO inventory VALUES(?,?)", account, skin);
          if (welcome)
            run("INSERT INTO claims VALUES(?,?)", account, "welcome-chest");
          run(
            currency === "coins"
              ? "UPDATE wallets SET coins=coins+?,revision=revision+1 WHERE account=?"
              : "UPDATE wallets SET gems=gems+?,revision=revision+1 WHERE account=?",
            delta,
            account,
          );
          run(
            "INSERT INTO ledger(account,operation,reason,coins,gems,created) VALUES(?,?,?,?,?,?)",
            account,
            operation,
            `chest:${crateId}`,
            currency === "coins" ? delta : 0,
            currency === "gems" ? delta : 0,
            now(),
          );
          return {
            reward: { skin, duplicate, refund, crate: crateId, currency },
            wallet: wallet(account),
          };
        },
      );
    },
    boost(account, operation, attemptId) {
      return transact(account, operation, { type: "boost", attemptId }, () => {
        const attempt = query(
          "SELECT * FROM attempts WHERE account=? AND id=?",
          account,
          attemptId,
        );
        if (
          !attempt ||
          attempt.expires <= now() ||
          query("SELECT 1 FROM finished WHERE attempt=?", attemptId)
        )
          throw Error("invalid-attempt");
        if (
          query(
            "SELECT 1 FROM boosts WHERE account=? AND attempt=?",
            account,
            attemptId,
          )
        )
          return {
            granted: true,
            seconds: 30,
            attemptId,
            wallet: wallet(account),
          };
        if (wallet(account).gems < TIME_BOOST_COST)
          throw Error("insufficient-funds");
        run("INSERT INTO boosts VALUES(?,?)", account, attemptId);
        run(
          "UPDATE wallets SET gems=gems-?,revision=revision+1 WHERE account=?",
          TIME_BOOST_COST,
          account,
        );
        run(
          "INSERT INTO ledger(account,operation,reason,coins,gems,created) VALUES(?,?,?,0,?,?)",
          account,
          operation,
          "time-boost",
          -TIME_BOOST_COST,
          now(),
        );
        return {
          granted: true,
          seconds: 30,
          attemptId,
          wallet: wallet(account),
        };
      });
    },
    /** Operator-only import. Deliberately absent from all HTTP command routes. */
    importReviewedLegacy(account, operation, manifest, backup) {
      return transact(
        account,
        operation,
        { type: "legacy-import", manifest, backup },
        () => {
          const clean = validateSnapshot(backup);
          if (
            !manifest ||
            manifest.accountId !== account ||
            typeof manifest.approvalId !== "string" ||
            !manifest.approvalId.trim() ||
            manifest.backupHash !== digest(clean)
          )
            throw Error("invalid-import");
          if (
            ![manifest.coins, manifest.gems].every(
              (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000,
            ) ||
            !Array.isArray(manifest.cleared) ||
            !Array.isArray(manifest.owned) ||
            typeof manifest.gemGiftClaimed !== "boolean" ||
            typeof manifest.welcomeClaimed !== "boolean"
          )
            throw Error("invalid-import");
          if (
            manifest.cleared.some(
              (id) => !rewardLevels.some((l) => l.levelId === id),
            ) ||
            manifest.owned.some((id) => !skins.some((s) => s.id === id)) ||
            !manifest.owned.includes("classic")
          )
            throw Error("invalid-import");
          if (
            query("SELECT 1 FROM imports WHERE account=?", account) ||
            wallet(account).revision !== 0 ||
            query("SELECT 1 FROM ledger WHERE account=?", account)
          )
            throw Error("import-conflict");
          // Archive the exact source inside the same transaction as balances and claim receipts.
          run(
            "INSERT INTO imports VALUES(?,?,?,?,?)",
            account,
            manifest.approvalId,
            JSON.stringify(manifest),
            JSON.stringify(clean),
            now(),
          );
          run(
            "UPDATE wallets SET coins=?,gems=?,revision=revision+1 WHERE account=?",
            manifest.coins,
            manifest.gems,
            account,
          );
          for (const level of new Set(manifest.cleared))
            run(
              "INSERT INTO clears VALUES(?,?,?)",
              account,
              level,
              `legacy:${manifest.approvalId}`,
            );
          for (const skin of new Set(manifest.owned))
            run("INSERT OR IGNORE INTO inventory VALUES(?,?)", account, skin);
          seedReviewed(account, clean, true);
          for (const [kind, claimed] of [
            ["gem-gift", manifest.gemGiftClaimed],
            ["welcome-chest", manifest.welcomeClaimed],
          ])
            if (claimed) run("INSERT INTO claims VALUES(?,?)", account, kind);
          run(
            "INSERT INTO ledger(account,operation,reason,coins,gems,created) VALUES(?,?,?,?,?,?)",
            account,
            operation,
            "reviewed-legacy-import",
            manifest.coins,
            manifest.gems,
            now(),
          );
          return {
            imported: true,
            backupHash: manifest.backupHash,
            wallet: wallet(account),
          };
        },
      );
    },
    migrationBackup(account) {
      identity(account);
      const row = query("SELECT backup FROM imports WHERE account=?", account);
      return row ? JSON.parse(row.backup) : null;
    },
    overview(account) {
      identity(account);
      const imported = query(
        "SELECT manifest FROM imports WHERE account=?",
        account,
      );
      return {
        accountId: account,
        progress: db
          .prepare(
            "SELECT level AS levelId,stars AS bestStars FROM progress WHERE account=? ORDER BY level",
          )
          .all(account),
        preference: query(
          "SELECT equipped,revision FROM preferences WHERE account=?",
          account,
        ) ?? { equipped: "classic", revision: 0 },
        lastReward: (() => {
          const row = query(
            "SELECT result FROM operations WHERE account=? AND json_extract(result, '$.reward.skin') IS NOT NULL ORDER BY rowid DESC LIMIT 1",
            account,
          );
          return row ? JSON.parse(row.result).reward : null;
        })(),
        wallet: wallet(account),
        inventory: db
          .prepare("SELECT skin FROM inventory WHERE account=?")
          .all(account)
          .map((r) => r.skin),
        cleared: db
          .prepare("SELECT level FROM clears WHERE account=?")
          .all(account)
          .map((r) => r.level),
        claims: db
          .prepare("SELECT kind FROM claims WHERE account=?")
          .all(account)
          .map((r) => r.kind),
        migration: imported ? JSON.parse(imported.manifest) : null,
      };
    },
  };
}
