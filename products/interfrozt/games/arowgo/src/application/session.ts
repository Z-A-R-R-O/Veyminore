import { checkExit, legalArrows, type Exit, type Level } from "../domain/rules";
export type Mode = "story" | "practice";
export interface Session {
  schemaVersion: 1;
  rulesVersion: 1;
  contentVersion: 1;
  levelId: string;
  attemptId: string;
  mode: Mode;
  active: string[];
  mistakes: number;
  assisted: boolean;
  status: "playing" | "failed" | "complete";
  processed: string[];
  coins: number;
  claimed: boolean;
  bestStars: number;
  reward: number;
}
export interface Command {
  id: string;
  attemptId: string;
  type: "select" | "hint";
  arrowId?: string;
}
export interface Outcome {
  state: Session;
  exit?: Exit;
  arrowId?: string;
  hints?: string[];
}
export function newSession(
  level: Level,
  attemptId: string,
  mode: Mode = "story",
  previous?: Session,
): Session {
  return {
    schemaVersion: 1,
    rulesVersion: 1,
    contentVersion: 1,
    levelId: level.levelId,
    attemptId,
    mode,
    active: level.arrows.map((a) => a.id),
    mistakes: 0,
    assisted: false,
    status: "playing",
    processed: [],
    coins: previous?.coins ?? 0,
    claimed: previous?.claimed ?? false,
    bestStars: previous?.bestStars ?? 0,
    reward: 0,
  };
}
export function stars(state: Session): number {
  if (state.status !== "complete" || state.mode === "practice") return 0;
  return state.assisted
    ? 1
    : state.mistakes === 0
      ? 3
      : state.mistakes === 1
        ? 2
        : 1;
}
export function resolve(
  level: Level,
  state: Session,
  command: Command,
): Outcome {
  if (
    state.status !== "playing" ||
    command.attemptId !== state.attemptId ||
    state.processed.includes(command.id)
  )
    return { state };
  if (command.type === "hint") {
    const hints = legalArrows(level, state.active).slice(0, 1);
    if (!hints.length) return { state };
    return {
      state: {
        ...state,
        assisted: true,
        processed: [...state.processed, command.id],
      },
      hints,
    };
  }
  if (!command.arrowId || !state.active.includes(command.arrowId))
    return { state };
  const exit = checkExit(level, state.active, command.arrowId);
  const next = { ...state, processed: [...state.processed, command.id] };
  if (!exit.clear) {
    next.mistakes++;
    if (next.mode === "story" && next.mistakes >= 3) next.status = "failed";
  } else {
    next.active = state.active.filter((id) => id !== command.arrowId);
    if (!next.active.length) {
      next.status = "complete";
      if (next.mode === "story") {
        next.bestStars = Math.max(next.bestStars, stars(next));
        if (!next.claimed) {
          next.coins += 25;
          next.reward = 25;
          next.claimed = true;
        }
      }
    }
  }
  return { state: next, exit, arrowId: command.arrowId };
}

export function parseSession(raw: string, level: Level): Session {
  const s: Session = JSON.parse(raw);
  if (
    !s ||
    s.schemaVersion !== 1 ||
    s.rulesVersion !== 1 ||
    s.contentVersion !== 1 ||
    s.levelId !== level.levelId ||
    typeof s.attemptId !== "string" ||
    !s.attemptId ||
    !["story", "practice"].includes(s.mode) ||
    !["playing", "failed", "complete"].includes(s.status) ||
    !Array.isArray(s.active) ||
    new Set(s.active).size !== s.active.length ||
    s.active.some((id) => !level.arrows.some((a) => a.id === id)) ||
    !Number.isSafeInteger(s.mistakes) ||
    s.mistakes < 0 ||
    typeof s.assisted !== "boolean" ||
    !Array.isArray(s.processed) ||
    s.processed.some((id) => typeof id !== "string") ||
    new Set(s.processed).size !== s.processed.length ||
    typeof s.claimed !== "boolean" ||
    s.coins !== (s.claimed ? 25 : 0) ||
    !Number.isInteger(s.bestStars) ||
    s.bestStars < 0 ||
    s.bestStars > 3 ||
    ![0, 25].includes(s.reward)
  )
    throw new Error("Invalid or incompatible save");
  if (
    (s.status === "complete") !== (s.active.length === 0) ||
    (s.status === "failed") !== (s.mode === "story" && s.mistakes >= 3) ||
    (s.mode === "story" && s.mistakes > 3) ||
    s.claimed !== s.bestStars > 0 ||
    (s.reward > 0 &&
      (s.mode !== "story" || s.status !== "complete" || !s.claimed)) ||
    (s.mode === "story" &&
      s.status === "complete" &&
      (!s.claimed || s.bestStars < stars(s)))
  )
    throw new Error("Inconsistent save");
  // A legal removal can never leave one of its prerequisites active.
  const removed = level.arrows
    .map((a) => a.id)
    .filter((id) => !s.active.includes(id));
  for (const id of removed)
    if (!checkExit(level, [...s.active, id], id).clear)
      throw new Error("Impossible saved board");
  return s;
}
