import { WebAccountApi } from "./web-api";
import { confirmSyncAnchor } from "./completion-sync";
import { validatePlayableRestore, describeSave } from "./cloud-restore";
import { captureLegacyBackup, type LegacyBackup } from "./legacy-backup";
import { cloudRequest, type CloudState } from "./cloud-api";
import {
  recoverInterruptedRestore,
  restoreBackup,
  sameBackup,
  SAVE_LOCK,
  RECOVERY_KEY,
} from "./cloud-local";
const status = document.querySelector<HTMLElement>("#status")!;
const comparison = document.querySelector<HTMLElement>("#comparison")!;
const button = (id: string) =>
  document.querySelector<HTMLButtonElement>("#" + id)!;
let cloud: CloudState,
  local: LegacyBackup,
  accountId = "",
  choice: "upload" | "restore" | null = null;
let busy = false;
const enabled =
  import.meta.env.DEV &&
  import.meta.env.VITE_AROWGO_CLOUD_SYNC === "1" &&
  location.origin === "http://localhost:4173";
function hideActions() {
  for (const id of ["upload", "restore", "confirm", "cancel"])
    button(id).hidden = true;
}
function error(e: unknown) {
  hideActions();
  status.textContent = `Sync stopped (${e instanceof Error ? e.message : "unavailable"}). Your local save has not been replaced by a cloud response. Check again before retrying.`;
  button("refresh").hidden = false;
}
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw Error("browser-not-supported");
  return navigator.locks.request(
    SAVE_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw Error("close-other-game-tabs");
      recoverInterruptedRestore(localStorage);
      return fn();
    },
  );
}
async function check() {
  if (busy) return;
  busy = true;
  hideActions();
  button("refresh").hidden = true;
  try {
    if (!enabled) throw Error("cloud-disabled");
    await exclusive(async () => {
      const session = await new WebAccountApi(true).session();
      if (!session.account) throw Error("sign-in-required");
      accountId = session.account.id;
      local = captureLegacyBackup(localStorage);
      cloud = await cloudRequest(accountId, "load");
      comparison.replaceChildren();
      for (const line of [
        `This device: ${describeSave(local)}`,
        `Cloud: ${cloud.save ? describeSave(cloud.save.snapshot) + " · Saved " + new Date(cloud.save.savedAt).toLocaleString() : "no save yet"}`,
      ]) {
        const p = document.createElement("p");
        p.textContent = line;
        comparison.append(p);
      }
      status.textContent =
        cloud.save && sameBackup(local, cloud.save.snapshot)
          ? "This device matches your cloud save."
          : "Choose which complete save to keep. No changes have been made.";
      button("upload").hidden = false;
      button("restore").hidden = !cloud.save;
    });
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    button("refresh").hidden = false;
    button("download").hidden = !localStorage.getItem(RECOVERY_KEY);
  }
}
function choose(action: "upload" | "restore") {
  choice = action;
  hideActions();
  status.textContent =
    action === "upload"
      ? "Replace the cloud save with this device’s complete save? The previous cloud save will be retained."
      : "Replace this device’s progress and balances with the cloud save? Your current data will be retained as a recovery copy. Balances are not merged.";
  button("confirm").hidden = button("cancel").hidden = false;
}
button("upload").onclick = () => choose("upload");
button("restore").onclick = () => choose("restore");
button("cancel").onclick = () => void check();
button("refresh").onclick = () => void check();
button("confirm").onclick = async () => {
  if (busy || !choice) return;
  busy = true;
  hideActions();
  button("refresh").hidden = true;
  try {
    await exclusive(async () => {
      if (!sameBackup(captureLegacyBackup(localStorage), local))
        throw Error("local-save-changed");
      if (choice === "upload") {
        const result = await cloudRequest(accountId, "save", {
          expectedVersion: cloud.version,
          operationId: crypto.randomUUID(),
          snapshot: local,
        });
        if (!result.save || !sameBackup(result.save.snapshot, local))
          throw Error("cloud-verification-failed");
        confirmSyncAnchor(localStorage, accountId, result.version);
        status.textContent =
          "Cloud save confirmed. Local progress and balances are unchanged.";
      } else {
        const fresh = await cloudRequest(accountId, "load");
        if (
          fresh.version !== cloud.version ||
          !fresh.save ||
          !cloud.save ||
          !sameBackup(fresh.save.snapshot, cloud.save.snapshot)
        )
          throw Error("save-conflict");
        restoreBackup(
          localStorage,
          local,
          validatePlayableRestore(fresh.save.snapshot),
          accountId,
        );
        confirmSyncAnchor(localStorage, accountId, fresh.version);
        status.textContent =
          "Cloud save restored. Your previous local save is available as a recovery download. Return to Profile to load it.";
      }
    });
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    button("refresh").hidden = false;
    button("download").hidden = !localStorage.getItem(RECOVERY_KEY);
  }
};
button("download").onclick = () => {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "arowgo-save-recovery.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
void check();
