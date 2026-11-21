import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";

/**
 * Validates SQLite structural integrity, foreign keys, and ledger balance invariants.
 * Throws an Error with detailed diagnostics if any check fails.
 */
export function verifyLedgerIntegrity(dbOrPath) {
  const isOwner = typeof dbOrPath === "string" || dbOrPath instanceof URL;
  const db = isOwner ? new DatabaseSync(dbOrPath) : dbOrPath;

  try {
    // 1. SQLite internal B-tree and page integrity check
    const integrityRow = db.prepare("PRAGMA integrity_check").get();
    const integrityResult = integrityRow ? Object.values(integrityRow)[0] : null;
    if (integrityResult !== "ok") {
      throw new Error(`SQLite integrity check failed: ${integrityResult}`);
    }

    // 2. Foreign key consistency check
    const fkErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (fkErrors.length > 0) {
      throw new Error(`Foreign key constraint violations detected: ${JSON.stringify(fkErrors)}`);
    }

    // 3. Balance invariant verification:
    // For every wallet, current coins and gems must strictly equal the sum of all immutable ledger entries.
    const invariantRows = db.prepare(`
      SELECT
        w.account,
        w.coins,
        w.gems,
        COALESCE(SUM(l.coins), 0) AS expected_coins,
        COALESCE(SUM(l.gems), 0) AS expected_gems
      FROM wallets w
      LEFT JOIN ledger l ON w.account = l.account
      GROUP BY w.account
    `).all();

    for (const row of invariantRows) {
      if (row.coins < 0 || row.gems < 0) {
        throw new Error(`Negative balance detected for account ${row.account}: coins=${row.coins}, gems=${row.gems}`);
      }
      if (row.coins !== row.expected_coins) {
        throw new Error(
          `Coin balance mismatch for account ${row.account}: wallet=${row.coins}, ledger_sum=${row.expected_coins}`
        );
      }
      if (row.gems !== row.expected_gems) {
        throw new Error(
          `Gem balance mismatch for account ${row.account}: wallet=${row.gems}, ledger_sum=${row.expected_gems}`
        );
      }
    }

    // 4. Collect summary statistics
    const totals = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM wallets) AS account_count,
        (SELECT COUNT(*) FROM ledger) AS transaction_count,
        (SELECT COALESCE(SUM(coins), 0) FROM wallets) AS total_coins,
        (SELECT COALESCE(SUM(gems), 0) FROM wallets) AS total_gems
    `).get();

    return {
      ok: true,
      stats: {
        accountCount: Number(totals.account_count),
        transactionCount: Number(totals.transaction_count),
        totalCoins: Number(totals.total_coins),
        totalGems: Number(totals.total_gems),
      },
    };
  } finally {
    if (isOwner) {
      db.close();
    }
  }
}

/**
 * Creates an atomic, point-in-time SQLite backup using VACUUM INTO,
 * computes SHA-256 verification hash, and generates a structured audit manifest.
 */
export function createLedgerBackup(sourceDbPath, targetDir, { now = Date.now } = {}) {
  const resolvedSource = resolve(sourceDbPath);
  if (!existsSync(resolvedSource)) {
    throw new Error(`Source database does not exist: ${resolvedSource}`);
  }

  // Pre-backup integrity check
  const preCheck = verifyLedgerIntegrity(resolvedSource);

  const resolvedDir = resolve(targetDir);
  mkdirSync(resolvedDir, { recursive: true });

  const timestamp = now();
  const backupFileName = `arowgo-ledger-${timestamp}.sqlite`;
  const backupPath = join(resolvedDir, backupFileName);
  const manifestFileName = `arowgo-ledger-${timestamp}.json`;
  const manifestPath = join(resolvedDir, manifestFileName);

  // Take atomic consistent online snapshot
  const db = new DatabaseSync(resolvedSource);
  try {
    // Escape single quotes for SQLite VACUUM INTO statement
    const escapedBackupPath = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedBackupPath}';`);
  } finally {
    db.close();
  }

  // Compute cryptographic hash of generated backup
  const backupBytes = readFileSync(backupPath);
  const hash = createHash("sha256").update(backupBytes).digest("hex");
  const stats = statSync(backupPath);

  // Post-backup verification on the backup file itself
  const postCheck = verifyLedgerIntegrity(backupPath);

  const manifest = {
    schemaVersion: 1,
    backupFile: backupFileName,
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    sha256: hash,
    sizeBytes: stats.size,
    stats: postCheck.stats,
    status: "verified",
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return {
    backupPath,
    manifestPath,
    manifest,
  };
}

/**
 * Restores a database from a verified backup file.
 * Validates integrity, verifies SHA-256 manifest if present, creates a safety copy of existing DB,
 * and confirms restored database invariants.
 */
export function restoreLedgerBackup(
  backupFilePath,
  targetDbPath,
  { verifyOnly = false, now = Date.now } = {}
) {
  const resolvedBackup = resolve(backupFilePath);
  if (!existsSync(resolvedBackup)) {
    throw new Error(`Backup file does not exist: ${resolvedBackup}`);
  }

  // Check manifest hash if manifest file exists
  const candidateManifestPath = resolvedBackup.replace(/\.sqlite$/, ".json");
  if (existsSync(candidateManifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(candidateManifestPath, "utf8"));
      const currentHash = createHash("sha256").update(readFileSync(resolvedBackup)).digest("hex");
      if (manifest.sha256 && manifest.sha256 !== currentHash) {
        throw new Error(`Backup hash mismatch! Expected ${manifest.sha256}, calculated ${currentHash}`);
      }
    } catch (e) {
      if (e.message.includes("hash mismatch")) throw e;
      // Corrupt manifest file
    }
  }

  // Verify backup integrity and ledger invariants
  const verification = verifyLedgerIntegrity(resolvedBackup);
  if (verifyOnly) {
    return {
      verified: true,
      stats: verification.stats,
    };
  }

  const resolvedTarget = resolve(targetDbPath);
  let safetyBackupPath = null;

  if (existsSync(resolvedTarget)) {
    safetyBackupPath = `${resolvedTarget}.pre-restore-${now()}`;
    copyFileSync(resolvedTarget, safetyBackupPath);
  } else {
    mkdirSync(dirname(resolvedTarget), { recursive: true });
  }

  // Perform clean copy restore
  copyFileSync(resolvedBackup, resolvedTarget);

  // Re-verify the restored target database
  const targetVerification = verifyLedgerIntegrity(resolvedTarget);

  return {
    restored: true,
    targetDbPath: resolvedTarget,
    safetyBackupPath,
    stats: targetVerification.stats,
  };
}
