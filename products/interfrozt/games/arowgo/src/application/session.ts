import type { MovePraise } from "../domain/movePraise";
import {
  checkExit,
  hasTiming,
  safeArrows,
  expiredKeg,
  solve,
  type Exit,
  type Level,
} from "../domain/rules";
export type Mode = "story" | "practice";
export interface Session {
  moveLog?: Array<{ type: "select" | "erase"; arrowId: string }>;
  failureReason?: "keg" | "stranded";
  feedbackCounts?: Partial<Record<MovePraise, number>>;
  timeBoost?: boolean;
  schemaVersion: 1;
  rulesVersion: 1 | 2;
  contentVersion: number;
  levelId: string;
  attemptId: string;
  mode: Mode;
  active: string[];
  mistakes: number;
  assisted: boolean;
  erased: string[];
  status: "playing" | "failed" | "complete";
  processed: string[];
  coins: number;
  claimed: boolean;
  bestStars: number;
  reward: number;
  scoringVersion?: 2;
  startedAt?: number;
  elapsedMs?: number;
  targetMs?: number;
}
export interface Command {
  id: string;
  attemptId: string;
  type: "select" | "hint" | "analyze" | "erase";
  arrowId?: string;
  now?: number;
}
export interface Outcome {
  state: Session;
  exit?: Exit;
  arrowId?: string;
  hints?: string[];
  erased?: boolean;
}
export function newSession(
  level: Level,
  attemptId: string,
  mode: Mode = "story",
  previous?: Session,
): Session {
  return {
    schemaVersion: 1,
    moveLog: [],
    rulesVersion: level.rulesVersion,
    contentVersion: level.contentVersion,
    levelId: level.levelId,
    attemptId,
    mode,
    active: level.arrows.map((a) => a.id),
    mistakes: 0,
    assisted: false,
    feedbackCounts: {},
    erased: [],
    status: "playing",
    processed: [],
    coins: previous?.coins ?? 0,
    claimed: previous?.claimed ?? false,
    bestStars: previous?.bestStars ?? 0,
    reward: 0,
    scoringVersion: 2,
    elapsedMs: 0,
    targetMs: Math.max(60000, level.arrows.length * 8000),
  };
}
export function stars(state: Session): number {
  if (state.status !== "complete" || state.mode === "practice") return 0;
  if (state.scoringVersion === 2)
    return (
      1 +
      Number(state.mistakes === 0) +
      Number((state.elapsedMs ?? Infinity) <= (state.targetMs ?? 0))
    );
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
  const now = command.now ?? state.startedAt ?? 0;
  const timed = {
    ...state,
    startedAt: state.startedAt ?? now,
    elapsedMs: Math.max(state.elapsedMs ?? 0, now - (state.startedAt ?? now)),
  };
  if (command.type === "hint" || command.type === "analyze") {
    const legal = safeArrows(level, state.active);
    const hints = command.type === "hint" ? legal.slice(0, 1) : legal;
    if (!hints.length) return { state };
    return {
      state: {
        ...timed,
        assisted: true,
        processed: [...state.processed, command.id],
      },
      hints,
    };
  }
  if (!command.arrowId || !state.active.includes(command.arrowId))
    return { state };
  const exit = checkExit(level, state.active, command.arrowId);
  const next = { ...timed, processed: [...state.processed, command.id] };
  if (state.moveLog)
    next.moveLog = [
      ...state.moveLog,
      { type: command.type, arrowId: command.arrowId },
    ];
  if (command.type === "erase") {
    next.assisted = true;
    next.erased = [...state.erased, command.arrowId];
  }
  if (!exit.clear && command.type !== "erase") {
    next.mistakes++;
    if (next.mode === "story" && next.mistakes >= 3) next.status = "failed";
  } else {
    next.active = state.active.filter((id) => id !== command.arrowId);
    if (next.active.length && hasTiming(level)) {
      if (expiredKeg(level, next.active)) {
        next.status = "failed";
        next.failureReason = "keg";
      } else if (!solve(level, next.active)) {
        next.status = "failed";
        next.failureReason = "stranded";
      }
    }
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
  return {
    state: next,
    exit,
    arrowId: command.arrowId,
    erased: command.type === "erase",
  };
}

export function parseSession(raw: string, level: Level): Session {
  const s: Session = JSON.parse(raw);
  if (
    s?.scoringVersion !== undefined &&
    (s.scoringVersion !== 2 ||
      !Number.isSafeInteger(s.elapsedMs) ||
      s.elapsedMs! < 0 ||
      (s.timeBoost !== undefined && typeof s.timeBoost !== "boolean") ||
      s.targetMs !==
        Math.max(60000, level.arrows.length * 8000) +
          (s.timeBoost ? 30000 : 0) ||
      (s.startedAt !== undefined &&
        (!Number.isSafeInteger(s.startedAt) || s.startedAt < 0)))
  )
    throw new Error("Invalid scoring data");
  if (
    s?.moveLog !== undefined &&
    (!Array.isArray(s.moveLog) ||
      s.moveLog.length > s.processed?.length ||
      s.moveLog.some(
        (m) =>
          !m ||
          !["select", "erase"].includes(m.type) ||
          !level.arrows.some((a) => a.id === m.arrowId),
      ))
  )
    throw Error("Invalid move record");
  // Additive migration of first-playable v1 saves, which had no Erase tool.
  if (
    s &&
    typeof s === "object" &&
    !Object.prototype.hasOwnProperty.call(s, "erased")
  )
    s.erased = [];
  if (
    !s ||
    s.schemaVersion !== 1 ||
    s.rulesVersion !== level.rulesVersion ||
    s.contentVersion !== level.contentVersion ||
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
    !Array.isArray(s.erased) ||
    new Set(s.erased).size !== s.erased.length ||
    s.erased.some(
      (id) => s.active.includes(id) || !level.arrows.some((a) => a.id === id),
    ) ||
    (s.erased.length > 0 && !s.assisted) ||
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
    (s.status === "failed") !==
      ((s.mode === "story" && s.mistakes >= 3) ||
        s.failureReason !== undefined) ||
    (s.mode === "story" && s.mistakes > 3) ||
    s.claimed !== s.bestStars > 0 ||
    (s.reward > 0 &&
      (s.mode !== "story" || s.status !== "complete" || !s.claimed)) ||
    (s.mode === "story" &&
      s.status === "complete" &&
      (!s.claimed || s.bestStars < stars(s)))
  )
    throw new Error("Inconsistent save");
  if (
    s.failureReason !== undefined &&
    (s.status !== "failed" ||
      !["keg", "stranded"].includes(s.failureReason) ||
      !hasTiming(level) ||
      (s.failureReason === "keg"
        ? !expiredKeg(level, s.active)
        : expiredKeg(level, s.active) || solve(level, s.active) !== null))
  )
    throw new Error("Invalid keg failure");
  if (
    hasTiming(level) &&
    s.status === "playing" &&
    (expiredKeg(level, s.active) || !solve(level, s.active))
  )
    throw new Error("Impossible keg state");
  // Alternating gates are non-monotone: validate the actual move history,
  // not a hypothetical reinsertion at the final phase.
  const dynamic = level.arrows.some(
    (a) =>
      a.phase !== undefined ||
      a.thawAfter !== undefined ||
      a.pulse !== undefined ||
      a.window !== undefined,
  );
  if (dynamic) {
    if (!s.moveLog) throw Error("Timing saves require a move record");
    let replay = newSession(level, "validate", s.mode);
    for (const [index, move] of s.moveLog.entries()) {
      if (replay.status !== "playing") throw Error("Moves after timing result");
      replay = resolve(level, replay, {
        id: String(index),
        attemptId: "validate",
        type: move.type,
        arrowId: move.arrowId,
      }).state;
    }
    if (
      JSON.stringify(replay.active) !== JSON.stringify(s.active) ||
      replay.mistakes !== s.mistakes ||
      replay.status !== s.status ||
      JSON.stringify(replay.erased) !== JSON.stringify(s.erased)
    )
      throw Error("Invalid timing move history");
  }
  // Static prerequisites stay cleared; phase restrictions are checked above.

  const removed = level.arrows
    .map((a) => a.id)
    .filter((id) => !s.active.includes(id));
  for (const id of removed)
    if (
      !dynamic &&
      !s.erased.includes(id) &&
      !checkExit(level, [...s.active, id], id).clear
    )
      throw new Error("Impossible saved board");
  if (
    s.feedbackCounts !== undefined &&
    (!s.feedbackCounts ||
      typeof s.feedbackCounts !== "object" ||
      Array.isArray(s.feedbackCounts) ||
      Object.entries(s.feedbackCounts).some(
        ([key, value]) =>
          ![
            "good",
            "great",
            "brilliant",
            "perfect",
            "book",
            "mistake",
            "blunder",
          ].includes(key) ||
          !Number.isSafeInteger(value) ||
          value! < 0,
      ) ||
      Object.values(s.feedbackCounts).reduce((a, b) => a + (b ?? 0), 0) >
        s.processed.length)
  )
    throw new Error("Invalid feedback counts");
  return s;
}
