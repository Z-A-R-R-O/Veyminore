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
  private commit(next: Session) {
    if (next === this.state) return;
    if (!this.saves.save(next))
      this.notice =
        "Progress is in memory only. Keep this page open; local saving is unavailable.";
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }
  select(arrowId: string): Outcome {
    const result = resolve(this.level, this.state, {
      id: this.id(),
      attemptId: this.state.attemptId,
      type: "select",
      arrowId,
    });
    this.commit(result.state);
    return result;
  }
  hint(): Outcome {
    const result = resolve(this.level, this.state, {
      id: this.id(),
      attemptId: this.state.attemptId,
      type: "hint",
    });
    this.commit(result.state);
    return result;
  }
  restart(mode: Mode = this.state.mode) {
    this.commit(newSession(this.level, this.id(), mode, this.state));
  }
}
