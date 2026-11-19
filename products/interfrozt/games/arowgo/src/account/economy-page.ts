import { accountRestorePlan } from "./account-restore";
import {
  restoreAccountCopy,
  recoverAccountRestore,
  ACCOUNT_RESTORE_BACKUP,
} from "./account-restore-store";
import type { LegacyBackup } from "./legacy-backup";
import "./test-page.css";
import { WebAccountApi } from "./web-api";
import { captureLegacyBackup } from "./legacy-backup";
import {
  backupHash,
  migrationPacket,
  activateAccountCopy,
} from "./economy-migration";
import { economyRequest } from "./economy-api";
import { SAVE_LOCK } from "./cloud-local";
const root = document.getElementById("root")!;
root.innerHTML = `<main class="wallet-review"><section class="card"><img class="wallet-review-art" src="/assets/account/cloud-vault-v1.png" alt="" width="150" height="150"><h1>Your account wallet</h1><p>Review your coins, gems and collection before moving to the account wallet. A recovery copy preserves your original progress.</p><p id="status" role="status">Checking your account…</p><pre id="summary" style="white-space:pre-wrap"></pre><button id="download" disabled>Download migration review</button><button id="activate" disabled>Use reviewed account wallet</button><button id="restore" hidden>Restore account progress on this device</button><button id="confirm-restore" hidden>Confirm restore</button><button id="recovery" hidden>Download recovery backup</button><p><a href="/?account=1#profile">Back to Profile</a></p></section></main>`;
const status = document.getElementById("status")!,
  summary = document.getElementById("summary")!;
const download = document.getElementById("download") as HTMLButtonElement,
  activate = document.getElementById("activate") as HTMLButtonElement;
const restore = document.getElementById("restore") as HTMLButtonElement,
  confirmRestore = document.getElementById(
    "confirm-restore",
  ) as HTMLButtonElement,
  recovery = document.getElementById("recovery") as HTMLButtonElement;
let preview: { snapshot: LegacyBackup; revision: number } | null = null;
let restoring = false;
let accountId = "";
function saveFile(value: unknown, name = "arowgo-migration-review.json") {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function locked<T>(job: () => Promise<T>) {
  if (!navigator.locks) throw Error("Use a browser supporting Web Locks.");
  return navigator.locks.request(
    SAVE_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw Error("Close other game tabs before continuing.");
      return job();
    },
  );
}
async function setup() {
  if (!import.meta.env.DEV || location.origin !== "http://localhost:4173")
    throw Error(
      "Account wallet preview is available on the development server.",
    );
  const session = await new WebAccountApi(true).session();
  if (!session.account) throw Error("Sign in from Profile first.");
  accountId = session.account.id;
  await locked(async () => {
    recoverAccountRestore(localStorage);
  });
  recovery.hidden = !localStorage.getItem(ACCOUNT_RESTORE_BACKUP);
  download.disabled = false;
  try {
    const packet = await locked(() =>
      migrationPacket(accountId, captureLegacyBackup(localStorage)),
    );
    summary.textContent = `${packet.manifest.coins} coins \u00b7 ${packet.manifest.gems} gems\n${packet.manifest.cleared.length} cleared levels \u00b7 ${packet.manifest.owned.length} skins`;
    status.textContent =
      "Download your review and recovery copy. Wallet activation requires a matching reviewed import.";
  } catch {
    status.textContent =
      "Your local save needs review. You can still back it up before restoring account progress.";
  }
  try {
    const current = await economyRequest(accountId, { action: "wallet" });
    if (current.migration) {
      activate.disabled = !!localStorage.getItem("arowgo.economy.binding.v1");
      restore.hidden = !!localStorage.getItem("arowgo.economy.binding.v1");
      const bound = localStorage.getItem("arowgo.economy.binding.v1");
      status.textContent = bound
        ? bound === accountId
          ? "This device is already connected. Your original local save remains separate; download its recovery copy below."
          : "This device belongs to another account. Sign in to that account to continue."
        : "Restore this account on a new device, or activate the original device using its matching reviewed save.";
    }
  } catch {
    status.textContent =
      "Review is available. The account wallet backend has not been enabled yet.";
  }
}
download.onclick = () => {
  void locked(async () => {
    const snapshot = captureLegacyBackup(localStorage);
    try {
      saveFile(await migrationPacket(accountId, snapshot));
    } catch {
      saveFile(snapshot, "arowgo-local-recovery.json");
    }
  }).catch((e) => (status.textContent = e.message));
};
activate.onclick = () => {
  activate.disabled = true;
  void locked(async () => {
    const snapshot = captureLegacyBackup(localStorage),
      current = await economyRequest(accountId, { action: "wallet" });
    if (current.migration?.backupHash !== (await backupHash(snapshot)))
      throw Error(
        "Your progress changed after review. Download a fresh review; no save was replaced.",
      );
    activateAccountCopy(localStorage, accountId, snapshot);
    location.href = "/?account=1#profile";
  }).catch((e) => {
    status.textContent = e.message;
    activate.disabled = false;
  });
};
restore.onclick = () => {
  if (restoring) return;
  restoring = true;
  restore.disabled = true;
  preview = null;
  confirmRestore.hidden = true;
  void locked(async () => {
    recoverAccountRestore(localStorage);
    if (localStorage.getItem("arowgo.economy.binding.v1"))
      throw Error(
        "This device already has an account save. Existing account saves are not replaced by this flow.",
      );
    const snapshot = captureLegacyBackup(localStorage),
      remote = await economyRequest(accountId, { action: "wallet" }),
      plan = accountRestorePlan(accountId, remote);
    preview = { snapshot, revision: plan.revision };
    summary.textContent = `Account ${accountId}\n${plan.completed} completed levels \u00b7 ${plan.stars} stars\n${plan.coins} coins \u00b7 ${plan.gems} gems\nEquipped skin: ${plan.equipped}`;
    status.textContent =
      "Confirm to save a recovery backup and restore this account on your device. Existing local progress stays separate. Partly played boards restart fresh; balances remain on the server.";
    confirmRestore.hidden = false;
  })
    .catch((e) => (status.textContent = e.message))
    .finally(() => {
      restore.disabled = false;
      restoring = false;
    });
};
confirmRestore.onclick = () => {
  if (restoring || !preview) return;
  restoring = true;
  confirmRestore.disabled = true;
  restore.disabled = true;
  activate.disabled = true;
  const expected = preview;
  void locked(async () => {
    const remote = await economyRequest(accountId, { action: "wallet" }),
      plan = accountRestorePlan(accountId, remote);
    if (plan.revision !== expected.revision)
      throw Error(
        "Account progress changed. Review the latest account progress and confirm again.",
      );
    restoreAccountCopy(
      localStorage,
      accountId,
      expected.snapshot,
      plan.entries,
    );
    location.href = "/?account=1#profile";
  })
    .catch((e) => {
      status.textContent = e.message;
      preview = null;
      confirmRestore.hidden = true;
      recovery.hidden = !localStorage.getItem(ACCOUNT_RESTORE_BACKUP);
    })
    .finally(() => {
      restoring = false;
      confirmRestore.disabled = false;
      restore.disabled = false;
    });
};
recovery.onclick = () => {
  const raw = localStorage.getItem(ACCOUNT_RESTORE_BACKUP);
  if (raw) saveFile(JSON.parse(raw), "arowgo-account-recovery.json");
};
void setup().catch((e) => (status.textContent = e.message));
