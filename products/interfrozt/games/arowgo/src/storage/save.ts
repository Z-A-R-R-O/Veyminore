import { parseSession, type Session } from "../application/session";
import type { Level } from "../domain/rules";
export const SAVE_KEY = "arowgo.slice.v1";
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class SaveStore {
  constructor(
    private store: Store,
    private level: Level,
    private key: string = SAVE_KEY,
  ) {}
  load(): { state?: Session; notice?: string } {
    try {
      const primary = this.store.getItem(this.key),
        backup = this.store.getItem(`${this.key}.backup`);
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
      const previous = this.store.getItem(this.key);
      if (previous) {
        try {
          parseSession(previous, this.level);
          this.store.setItem(`${this.key}.backup`, previous);
        } catch {
          /* Never overwrite a good backup with damaged data. */
        }
      }
      // A single atomic key replacement contains board, result, best stars and first-clear ledger.
      this.store.setItem(this.key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
}
