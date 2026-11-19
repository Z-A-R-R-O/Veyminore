import type { LegacyBackup } from "./legacy-backup";
import type { CloudState } from "./cloud-api";
import { sameBackup } from "./cloud-local";
export const AUTO_ANCHOR = "arowgo.cloud.anchor.v1";
export interface SyncAnchor {
  accountId: string;
  version: number;
  pending: string | null;
}
export interface AutoDependencies {
  read(): SyncAnchor | null;
  write(anchor: SyncAnchor): void;
  snapshot(): LegacyBackup;
  request(
    accountId: string,
    action: "load" | "save",
    input?: Record<string, unknown>,
  ): Promise<CloudState>;
  lock(job: () => Promise<void>): Promise<void>;
  id(): string;
  status(message: string): void;
}
export class CompletionSync {
  private running = false;
  private rerun = false;
  constructor(private d: AutoDependencies) {}
  completed() {
    try {
      const anchor = this.d.read();
      if (!anchor) {
        this.d.status(
          "Set up auto-sync with a confirmed upload or restore in Manage cloud save.",
        );
        return;
      }
      this.d.write({ ...anchor, pending: this.d.id() });
      void this.flush();
    } catch {
      this.d.status(
        "Auto-sync paused: sync metadata could not be saved. Local progress is unchanged.",
      );
    }
  }
  async flush() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.d.lock(async () => {
          const anchor = this.d.read();
          if (!anchor?.pending) return;
          this.d.status("Saving completed level to cloud…");
          const snapshot = this.d.snapshot();
          const cloud = await this.d.request(anchor.accountId, "load");
          if (cloud.accountId !== anchor.accountId)
            throw Error("account-changed");
          // Matching bytes reconcile a previously committed request with a lost response.
          let result = cloud;
          if (!cloud.save || !sameBackup(cloud.save.snapshot, snapshot)) {
            if (cloud.version !== anchor.version) throw Error("save-conflict");
            result = await this.d.request(anchor.accountId, "save", {
              expectedVersion: anchor.version,
              operationId: anchor.pending,
              snapshot,
            });
          }
          if (
            result.accountId !== anchor.accountId ||
            !result.save ||
            !sameBackup(result.save.snapshot, snapshot)
          )
            throw Error("cloud-verification-failed");
          const current = this.d.read();
          if (
            !current ||
            current.accountId !== anchor.accountId ||
            current.version !== anchor.version
          )
            throw Error("account-changed");
          const pending =
            current.pending === anchor.pending ? null : current.pending;
          this.d.write({
            accountId: anchor.accountId,
            version: result.version,
            pending,
          });
          this.d.status(
            sameBackup(this.d.snapshot(), snapshot)
              ? "Completed level saved to cloud."
              : "New progress saved locally; completed checkpoint is in the cloud.",
          );
          if (pending) this.rerun = true;
        });
      } while (this.rerun);
    } catch (e) {
      this.rerun = false;
      this.d.status(
        e instanceof Error && e.message === "save-conflict"
          ? "Auto-sync paused: another cloud save exists. Resolve it in Manage cloud save."
          : "Auto-sync paused. Local progress is safe. Sign in and retry from Account.",
      );
    } finally {
      this.running = false;
    }
  }
}
export function readSyncAnchor(
  storage: Pick<Storage, "getItem">,
): SyncAnchor | null {
  const raw = storage.getItem(AUTO_ANCHOR);
  if (!raw) return null;
  const a = JSON.parse(raw);
  if (
    typeof a.accountId !== "string" ||
    !a.accountId ||
    !Number.isSafeInteger(a.version) ||
    a.version < 0 ||
    (a.pending !== null && typeof a.pending !== "string")
  )
    throw Error("invalid-sync-anchor");
  return a;
}
export function confirmSyncAnchor(
  storage: Pick<Storage, "setItem">,
  accountId: string,
  version: number,
) {
  storage.setItem(
    AUTO_ANCHOR,
    JSON.stringify({ accountId, version, pending: null }),
  );
}
