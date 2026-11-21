#!/usr/bin/env node
import { resolve } from "node:path";
import { createLedgerBackup } from "../server/economy/backup.mjs";

const dbPath = process.argv[2] || process.env.AROWGO_DATABASE_PATH || "server/.local/economy.sqlite";
const targetDir = process.argv[3] || process.env.AROWGO_BACKUP_DIR || "server/.local/backups";

console.log(`[Backup] Starting ledger backup for ${dbPath} -> ${targetDir}...`);

try {
  const result = createLedgerBackup(dbPath, targetDir);
  console.log(`[Backup] Success!`);
  console.log(`  File:     ${result.backupPath}`);
  console.log(`  Manifest: ${result.manifestPath}`);
  console.log(`  SHA-256:  ${result.manifest.sha256}`);
  console.log(`  Accounts: ${result.manifest.stats.accountCount}`);
  console.log(`  Coins:    ${result.manifest.stats.totalCoins}`);
  console.log(`  Gems:     ${result.manifest.stats.totalGems}`);
  console.log(`  Txns:     ${result.manifest.stats.transactionCount}`);
  process.exit(0);
} catch (error) {
  console.error(`[Backup] Error: ${error.message}`);
  process.exit(1);
}
