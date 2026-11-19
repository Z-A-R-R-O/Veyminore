import { WebAccountApi } from "./web-api";
import { captureLegacyBackup } from "./legacy-backup";
import {
  restoreBackup,
  sameBackup,
  RECOVERY_KEY,
  validateBackup,
} from "./cloud-local";
import { validatePlayableRestore } from "./cloud-restore";
const status = document.querySelector<HTMLElement>("#status")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const signin = document.querySelector<HTMLElement>("#signin")!;
const api = new WebAccountApi(true);
async function ready() {
  const s = await api.session();
  if (!s.account) {
    status.textContent = "Please sign in, then return here to run the test.";
    signin.hidden = false;
  } else {
    status.textContent = "Signed in. Ready to test with synthetic save data.";
    run.disabled = false;
  }
}
run.onclick = async () => {
  run.disabled = true;
  try {
    const before = captureLegacyBackup(localStorage);
    const session = await api.session();
    if (!session.account) throw Error("Sign in again first.");
    status.textContent =
      "Testing real PlayFab write, read-back, stale-version rejection and restore. This can take up to three minutes…";
    const r = await fetch("/api/arowgo/v1/account/cloud-probe", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
      body: "{}",
      signal: AbortSignal.timeout(180000),
    });
    const result = await r.json();
    if (!r.ok || result.passed !== true)
      throw Error(
        typeof result.error === "string" ? result.error : "Test failed",
      );
    const target = validatePlayableRestore(validateBackup(result.snapshot));
    const map = new Map<string, string>([
      ["arowgo.profile.v1", '{"gems":7,"test":true}'],
    ]);
    const memory = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const original = captureLegacyBackup(memory);
    restoreBackup(memory, original, target, session.account.id);
    if (
      !sameBackup(captureLegacyBackup(memory), target) ||
      !sameBackup(JSON.parse(memory.getItem(RECOVERY_KEY)!).before, original)
    )
      throw Error("Isolated restore verification failed");
    if (!sameBackup(before, captureLegacyBackup(localStorage)))
      throw Error(
        "Local saves changed during the test; do not enable sync until reviewed.",
      );
    status.textContent =
      "PASS — real PlayFab write, read-back, conflict rejection and cloud restore; isolated browser restore and recovery copy; your local progress and currency unchanged. Normal sync is still disabled.";
  } catch (e) {
    status.textContent = `NOT ENABLED — ${e instanceof Error ? e.message : "Test failed"}. Normal sync remains disabled.`;
  } finally {
    run.disabled = false;
  }
};
if (import.meta.env.DEV && location.origin === "http://localhost:4173")
  void ready().catch(() => {
    status.textContent =
      "Account service unavailable. Reload after it is running.";
  });
else status.textContent = "Development test only.";
