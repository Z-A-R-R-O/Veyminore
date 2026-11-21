import { useEffect } from "react";
import type { MovePraise } from "../domain/movePraise";
import "./move-praise.css";
export function MovePraiseBubble({
  kind,
  x = 50,
  y = 18,
  onDone,
}: {
  kind: MovePraise;
  x?: number;
  y?: number;
  onDone?: () => void;
}) {
  useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className="move-praise"
      role="status"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <FeedbackSymbol kind={kind} />
    </div>
  );
}

export function FeedbackSymbol({ kind }: { kind: MovePraise }) {
  const positions = {
    brilliant: "0% 0%",
    great: "50% 0%",
    good: "100% 0%",
    perfect: "100% 0%",
    book: "0% 100%",
    blunder: "50% 100%",
    mistake: "100% 100%",
  };
  const labels = {
    brilliant: "Brilliant move",
    great: "Great move",
    good: "Path opened",
    perfect: "Perfect finish",
    book: "Hint",
    blunder: "Attempt failed",
    mistake: "Blocked move",
  };
  return (
    <span
      className="feedback-symbol"
      role="img"
      aria-label={labels[kind]}
      style={{ backgroundPosition: positions[kind] }}
    />
  );
}
