import { dependencies, legalArrows, type Level } from "./rules";
import type { Session, Outcome } from "../application/session";
export type MovePraise =
  | "good"
  | "great"
  | "brilliant"
  | "perfect"
  | "mistake"
  | "blunder"
  | "book";
export function rateMove(
  level: Level,
  before: Session,
  result: Outcome,
): MovePraise | null {
  if(result.state.status==="failed" && result.state.failureReason)return "blunder";
  if (result.exit && !result.exit.clear)
    return result.state.status === "failed" ? "blunder" : "mistake";
  if (
    !result.exit?.clear ||
    result.erased ||
    before.assisted ||
    result.state.assisted ||
    !result.arrowId
  )
    return null;
  if (result.state.status === "complete")
    return result.state.mistakes === 0 ? "perfect" : null;
  const previous = new Set(legalArrows(level, before.active));
  const opened = legalArrows(level, result.state.active).filter(
    (id) => !previous.has(id),
  ).length;
  if (!opened) return null;
  const graph = dependencies(level);
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    const next = new Set(seen);
    next.add(id);
    return (
      1 + Math.max(0, ...[...(graph.get(id) ?? [])].map((b) => depth(b, next)))
    );
  };
  if (opened >= 3 && depth(result.arrowId) >= 3) return "brilliant";
  return opened >= 2 ? "great" : "good";
}
