#!/usr/bin/env node
import { resolve } from "node:path";
import { restoreLedgerBackup } from "../server/economy/backup.mjs";

const backupFile = process.argv[2];
const targetDbPath = process.argv[3] || process.env.AROWGO_DATABASE_PATH || "server/.local/economy.sqlite";
const verifyOnly = process.argv.includes("--verify-only") || process.argv.includes("-v");

if (!backupFile) {
  console.error("Usage: node scripts/restore-ledger.mjs <backup-file.sqlite> [target-db.sqlite] [--verify-only]");
  process.exit(1);
}

console.log(`[Restore] Starting ledger ${verifyOnly ? "verification" : "restore"}...`);
console.log(`  Source: ${backupFile}`);
if (!verifyOnly) console.log(`  Target: ${targetDbPath}`);

try {
  const result = restoreLedgerBackup(backupFile, targetDbPath, { verifyOnly });
  if (verifyOnly) {
    console.log(`[Restore] Backup verification succeeded!`);
    console.log(`  Accounts: ${result.stats.accountCount}`);
    console.log(`  Coins:    ${result.stats.totalCoins}`);
    console.log(`  Gems:     ${result.stats.totalGems}`);
    console.log(`  Txns:     ${result.stats.transactionCount}`);
  } else {
    console.log(`[Restore] Restore succeeded!`);
    if (result.safetyBackupPath) {
      console.log(`  Pre-restore safety copy: ${result.safetyBackupPath}`);
    }
    console.log(`  Restored to:             ${result.targetDbPath}`);
    console.log(`  Accounts:                ${result.stats.accountCount}`);
    console.log(`  Coins:                   ${result.stats.totalCoins}`);
    console.log(`  Gems:                    ${result.stats.totalGems}`);
    console.log(`  Txns:                    ${result.stats.transactionCount}`);
  }
  process.exit(0);
} catch (error) {
  console.error(`[Restore] Error: ${error.message}`);
  process.exit(1);
}
