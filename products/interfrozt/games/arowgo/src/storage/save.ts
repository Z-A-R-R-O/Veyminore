import { parseSession, type Session } from "../application/session";
import type { Level } from "../domain/rules";
export const SAVE_KEY = "arowgo.slice.v1";
const BACKUP_KEY = `${SAVE_KEY}.backup`;
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class SaveStore {
  constructor(
    private store: Store,
    private level: Level,
  ) {}
  load(): { state?: Session; notice?: string } {
    try {
      const primary = this.store.getItem(SAVE_KEY),
        backup = this.store.getItem(BACKUP_KEY);
      if (!primary && !backup) return {};
      if (primary) {
        try {
          return { state: parseSession(primary, this.level) };
        } catch {
          /* Try last valid checkpoint. */
        }
      }
      if (backup) {
        try {
          return {
            state: parseSession(backup, this.level),
            notice:
              "Your last safe checkpoint was recovered. Recent progress may need replaying.",
          };
        } catch {
          /* Preserve incompatible data until reset. */
        }
      }
      return {
        notice:
          "This save cannot be read. Start a new run to replace it; your previous data is kept until then.",
      };
    } catch {
      return {
        notice:
          "Saving is unavailable. You can play, but progress may be lost when you close this page.",
      };
    }
  }
  save(state: Session): boolean {
    try {
      const previous = this.store.getItem(SAVE_KEY);
      if (previous) {
        try {
          parseSession(previous, this.level);
          this.store.setItem(BACKUP_KEY, previous);
        } catch {
          /* Never overwrite a good backup with damaged data. */
        }
      }
      // A single atomic key replacement contains board, result, best stars and first-clear ledger.
      this.store.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
}
