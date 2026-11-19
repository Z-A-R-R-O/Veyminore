import { recoverInterruptedRestore, SAVE_LOCK } from "./account/cloud-local";
async function start() {
  if (!navigator.locks) {
    if (localStorage.getItem("arowgo.cloud.restore-journal.v1"))
      throw Error("Recovery requires a browser with Web Locks support.");
    await import("./game-entry");
    return;
  }
  if (localStorage.getItem("arowgo.cloud.restore-journal.v1")) {
    await navigator.locks.request(SAVE_LOCK, () => {
      recoverInterruptedRestore(localStorage);
    });
  }
  // Every game tab holds a shared lock for its lifetime; restore requires exclusivity.
  const needsRecovery = await navigator.locks.request(
    SAVE_LOCK,
    { mode: "shared" },
    async () => {
      // An interrupted restore may have left a journal while this tab waited.
      if (localStorage.getItem("arowgo.cloud.restore-journal.v1")) return true;
      await import("./game-entry");
      await new Promise<void>(() => {});
      return false;
    },
  );
  if (needsRecovery) await start();
}
void start().catch(() => {
  const root = document.getElementById("root")!;
  root.textContent =
    "Your save recovery could not finish. Close other AROWGO tabs and reload. Your recovery copy has been kept.";
});
