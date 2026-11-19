import { rateMove } from "../domain/movePraise";
import {
  newSession,
  resolve,
  type Mode,
  type Outcome,
  type Session,
} from "./session";
import type { Level } from "../domain/rules";
import { SaveStore } from "../storage/save";
export class Controller {
  state: Session;
  notice = "";
  private listeners = new Set<() => void>();
  constructor(
    readonly level: Level,
    private saves: SaveStore,
    private id: () => string = () => crypto.randomUUID(),
  ) {
    const loaded = saves.load();
    this.state = loaded.state ?? newSession(level, id());
    this.notice = loaded.notice ?? "";
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  applyTimeBoost() {
    if (this.state.timeBoost || this.state.scoringVersion !== 2) return;
    this.commit({
      ...this.state,
      timeBoost: true,
      assisted: true,
      targetMs: this.state.targetMs! + 30000,
    });
  }
  private commit(next: Session) {
    if (next === this.state) return;
    const completed =
      this.state.status !== "complete" &&
      next.status === "complete" &&
      next.mode === "story";
    const persisted = this.saves.save(next);
    if (!persisted)
      this.notice =
        "Progress is in memory only. Keep this page open; local saving is unavailable.";
    else if (this.notice.startsWith("Progress is in memory only.")) this.notice = "";
    this.state = next;
    this.listeners.forEach((fn) => fn());
    if (persisted && typeof window !== "undefined")
      window.dispatchEvent(new Event("arowgo-local-saved"));
    if (persisted && completed && typeof window !== "undefined")
      window.dispatchEvent(new Event("arowgo-level-saved"));
  }
  select(arrowId: string): Outcome {
    const result = resolve(this.level, this.state, {
      id: this.id(),
      attemptId: this.state.attemptId,
      type: "select",
      now: Date.now(),
      arrowId,
    });
    const rating =
      result.state !== this.state
        ? rateMove(this.level, this.state, result)
        : null;
    if (rating)
      result.state = {
        ...result.state,
        feedbackCounts: {
          ...this.state.feedbackCounts,
          [rating]: (this.state.feedbackCounts?.[rating] ?? 0) + 1,
        },
      };
    this.commit(result.state);
    return result;
  }
  hint(type: "hint" | "analyze" = "hint"): Outcome {
    const result = resolve(this.level, this.state, {
      id: this.id(),
      attemptId: this.state.attemptId,
      type,
      now: Date.now(),
    });
    if (result.hints?.length && result.state !== this.state)
      result.state = {
        ...result.state,
        feedbackCounts: {
          ...this.state.feedbackCounts,
          book: (this.state.feedbackCounts?.book ?? 0) + 1,
        },
      };
    this.commit(result.state);
    return result;
  }
  erase(arrowId: string): Outcome {
    const result = resolve(this.level, this.state, {
      id: this.id(),
      attemptId: this.state.attemptId,
      type: "erase",
      now: Date.now(),
      arrowId,
    });
    this.commit(result.state);
    return result;
  }
  restart(mode: Mode = this.state.mode) {
    this.commit(newSession(this.level, this.id(), mode, this.state));
  }
}
