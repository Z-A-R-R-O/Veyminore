import { CompletionSync, readSyncAnchor, AUTO_ANCHOR } from "./completion-sync";
import { captureLegacyBackup } from "./legacy-backup";
import { cloudRequest } from "./cloud-api";
export const autoSyncEnabled =
  import.meta.env.DEV &&
  import.meta.env.VITE_AROWGO_AUTO_SYNC === "1" &&
  import.meta.env.VITE_AROWGO_CLOUD_SYNC === "1" &&
  location.origin === "http://localhost:4173";
let message =
  "Automatic uploads follow completed levels after a confirmed cloud upload or restore.";
const listeners = new Set<() => void>();
export const autoSyncStatus = () => message;
export function subscribeAutoSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
let engine: CompletionSync | undefined;
export function startCompletionSync() {
  if (!autoSyncEnabled || engine) return;
  engine = new CompletionSync({
    read: () => readSyncAnchor(localStorage),
    write: (a) => localStorage.setItem(AUTO_ANCHOR, JSON.stringify(a)),
    snapshot: () => captureLegacyBackup(localStorage),
    request: cloudRequest,
    id: () => crypto.randomUUID(),
    lock: async (job) => {
      if (!navigator.locks) throw Error("browser-not-supported");
      await navigator.locks.request("arowgo-cloud-upload-v1", job);
    },
    status: (m) => {
      message = m;
      listeners.forEach((fn) => fn());
    },
  });
  window.addEventListener("arowgo-level-saved", () => engine?.completed());
  window.addEventListener("arowgo-local-saved", () => {
    if (message === "Completed level saved to cloud.") {
      message = "New progress saved locally.";
      listeners.forEach((fn) => fn());
    }
  });
  window.addEventListener("online", () => {
    void engine?.flush();
  });
  void engine.flush();
}
export function retryCompletionSync() {
  void engine?.flush();
}
