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
root.innerHTML = `<main class="wallet-review"><section class="card"><img class="wallet-review-art" src="/assets/account/cloud-vault-v1.png" alt="" width="150" height="150"><h1>Your account wallet</h1><p>Review your coins, gems and collection before moving to the account wallet. A recovery copy preserves your original progress.</p><p id="status" role="status">Checking your account…</p><pre id="summary" style="white-space:pre-wrap"></pre><button id="download" disabled>Download migration review</button><button id="activate" disabled>Use reviewed account wallet</button><p><a href="/?account=1#profile">Back to Profile</a></p></section></main>`;
const status = document.getElementById("status")!,
  summary = document.getElementById("summary")!;
const download = document.getElementById("download") as HTMLButtonElement,
  activate = document.getElementById("activate") as HTMLButtonElement;
let accountId = "";
function saveFile(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "arowgo-migration-review.json";
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
  const packet = await locked(() =>
    migrationPacket(accountId, captureLegacyBackup(localStorage)),
  );
  summary.textContent = `${packet.manifest.coins} coins · ${packet.manifest.gems} gems\n${packet.manifest.cleared.length} cleared levels · ${packet.manifest.owned.length} skins`;
  download.disabled = false;
  status.textContent =
    "Download your review and recovery copy. Wallet activation requires a matching reviewed import.";
  try {
    const current = await economyRequest(accountId, { action: "wallet" });
    if (current.migration) {
      activate.disabled = false;
      status.textContent =
        "A reviewed wallet is ready. Activation checks that your local save still matches its recovery copy.";
    }
  } catch {
    status.textContent =
      "Review is available. The account wallet backend has not been enabled yet.";
  }
}
download.onclick = () => {
  void locked(async () => {
    const packet = await migrationPacket(
      accountId,
      captureLegacyBackup(localStorage),
    );
    saveFile(packet);
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
void setup().catch((e) => (status.textContent = e.message));
