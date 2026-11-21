#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyLedgerIntegrity } from "../server/economy/backup.mjs";

const dbPath = process.argv[2] || process.env.AROWGO_DATABASE_PATH || "server/.local/economy.sqlite";

console.log(`[Verify] Checking ledger integrity and balance invariants for ${dbPath}...`);

try {
  const result = verifyLedgerIntegrity(dbPath);
  console.log(`[Verify] Integrity & invariants verified successfully!`);
  console.log(`  Accounts:     ${result.stats.accountCount}`);
  console.log(`  Total coins:  ${result.stats.totalCoins}`);
  console.log(`  Total gems:   ${result.stats.totalGems}`);
  console.log(`  Transactions: ${result.stats.transactionCount}`);
  process.exit(0);
} catch (error) {
  console.error(`[Verify] FAILED: ${error.message}`);
  process.exit(1);
}
