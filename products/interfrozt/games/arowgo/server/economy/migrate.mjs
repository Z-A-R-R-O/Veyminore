import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openWalletLedger } from "./wallet.mjs";
const [command, packetPath, ...flags] = process.argv.slice(2);
if (!["review", "import"].includes(command) || !packetPath)
  throw Error(
    "Usage: node server/economy/migrate.mjs review packet.json | import packet.json --reviewed",
  );
const packet = JSON.parse(readFileSync(resolve(packetPath), "utf8"));
// Validate the complete transaction in isolation before touching the durable ledger.
const probe = openWalletLedger(":memory:");
try {
  probe.importReviewedLegacy(
    packet.manifest.accountId,
    packet.manifest.approvalId,
    packet.manifest,
    packet.backup,
  );
} finally {
  probe.close();
}
console.log(
  JSON.stringify(
    {
      account: packet.manifest.accountId,
      coins: packet.manifest.coins,
      gems: packet.manifest.gems,
      cleared: packet.manifest.cleared.length,
      skins: packet.manifest.owned.length,
      backupHash: packet.manifest.backupHash,
    },
    null,
    2,
  ),
);
if (command === "import") {
  if (!flags.includes("--reviewed"))
    throw Error(
      "Review the displayed entitlement and source backup, then explicitly pass --reviewed.",
    );
  const path = new URL("../../.local/economy.sqlite", import.meta.url);
  mkdirSync(new URL("../../.local/", import.meta.url), { recursive: true });
  const ledger = openWalletLedger(path);
  try {
    const result = ledger.importReviewedLegacy(
      packet.manifest.accountId,
      packet.manifest.approvalId,
      packet.manifest,
      packet.backup,
    );
    console.log(JSON.stringify(result));
  } finally {
    ledger.close();
  }
}
