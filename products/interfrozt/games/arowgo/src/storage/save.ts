import { newSession, parseSession, type Session } from "../application/session";
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
    private previousLevel?: Level | Level[],
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
          const migrated = this.migrate(primary);
          if (migrated) return migrated;
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
          const migrated = this.migrate(backup);
          if (migrated) return migrated;
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
  private migrate(raw: string): { state: Session; notice: string } | undefined {
    const candidates = Array.isArray(this.previousLevel)
      ? this.previousLevel
      : this.previousLevel
        ? [this.previousLevel]
        : [];
    const previousLevel = candidates.find((level) => {
      if (!level || level.contentVersion === this.level.contentVersion)
        return false;
      try {
        parseSession(raw, level);
        return true;
      } catch {
        return false;
      }
    });
    if (!previousLevel) return;
    let previous: Session;
    try {
      previous = parseSession(raw, previousLevel);
    } catch {
      return;
    }
    this.store.setItem(
      `${this.key}.content-${previousLevel.contentVersion}`,
      raw,
    );
    if (
      JSON.stringify(previousLevel.arrows) ===
        JSON.stringify(this.level.arrows) &&
      JSON.stringify(previousLevel.board) === JSON.stringify(this.level.board)
    ) {
      try {
        const state = parseSession(
          JSON.stringify({
            ...previous,
            rulesVersion: this.level.rulesVersion,
            contentVersion: this.level.contentVersion,
          }),
          this.level,
        );
        return {
          state,
          notice:
            "Snake movement rules are updated. Your current board and rewards are safe.",
        };
      } catch {
        /* Changed rules require a fresh attempt if the old state no longer validates. */
      }
    }
    return {
      state: newSession(
        this.level,
        `${previous.attemptId}:content-${this.level.contentVersion}`,
        previous.mode,
        previous,
      ),
      notice: "New puzzle. Coins and best stars kept.",
    };
  }
}
