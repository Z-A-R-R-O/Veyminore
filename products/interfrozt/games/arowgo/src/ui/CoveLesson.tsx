import { useState, useEffect, useRef } from "react";
import { Board } from "../game/Board";
import { validateLevel } from "../domain/rules";
import { newSession, resolve } from "../application/session";
import { useMotion } from "./useMotion";
import "./snake-tutorial.css";
const make = (kind: "anchors" | "kegs") =>
  validateLevel({
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 7,
    levelId: `lesson-${kind}`,
    board: { columns: 6, rows: 6 },
    arrows: [
      {
        id: "A",
        points: [
          [1, 3],
          [1, 1],
        ],
        ...(kind === "kegs"
          ? {
              points: [
                [1, 3],
                [1, 2],
              ],
              deadline: 2,
            }
          : {}),
      },
      {
        id: "B",
        points: [
          [3, 3],
          [3, 1],
        ],
        ...(kind === "anchors"
          ? { anchorRequires: "A" }
          : {
              points: [
                [1, 1],
                [3, 1],
              ],
            }),
      },
      {
        id: "C",
        points: [
          [5, 3],
          [5, 1],
        ],
        ...(kind === "anchors"
          ? { anchorRequires: "A" }
          : {
              points: [
                [4, 5],
                [5, 5],
              ],
            }),
      },
    ],
    solution: kind === "kegs" ? ["B", "A", "C"] : ["A", "B", "C"],
  });
export function CoveLesson({
  kind,
  onDone,
  onBack,
}: {
  kind: "anchors" | "kegs";
  onDone: () => void;
  onBack: () => void;
}) {
  const [level] = useState(() => make(kind));
  const [state, setState] = useState(() =>
    newSession(level, "lesson", "practice"),
  );
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const motion = useMotion();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <main className="snake-tutorial cove-tutorial">
      <section>
        <span className="eyebrow">
          {kind === "kegs"
            ? "PLAN YOUR MOVES · TRY IT"
            : "VERDANT COVE · TRY IT"}
        </span>
        <h1>{kind === "anchors" ? "Weigh anchor" : "Mind the powder"}</h1>
        <p>
          {kind === "anchors"
            ? "Clear the gold anchor on the left to release both silver anchors. Hold an arrow to see its connection."
            : "The barrel has two moves to leave. Clear the horizontal arrow above it, then the barrel. Every successful removal uses one move; blocked taps do not. Think as long as you like."}
        </p>
        <div className="snake-lesson-board">
          <Board
            key={state.attemptId}
            level={level}
            active={state.active}
            hints={[]}
            disabled={busy || state.status !== "playing"}
            reduced={motion.reduced}
            onSelect={(id) => {
              if (busy) return;
              const result = resolve(level, state, {
                id: crypto.randomUUID(),
                attemptId: state.attemptId,
                type: "select",
                arrowId: id,
              });
              setState(result.state);
              setBusy(true);
              timer.current = setTimeout(
                () => setBusy(false),
                motion.reduced ? 140 : 680,
              );
              return result;
            }}
          />
        </div>
        <p role="status">
          {state.status === "failed"
            ? "The barrel needs both moves: its blocker first, then the barrel. Try again."
            : state.status === "complete"
              ? "Ready to plan!"
              : kind === "anchors"
                ? "One anchor can release several arrows."
                : "The number is a move allowance, not a timer."}
        </p>
        {state.status === "failed" ? (
          <button
            className="primary-button"
            onClick={() =>
              setState(newSession(level, crypto.randomUUID(), "practice"))
            }
          >
            Try lesson again
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={state.status !== "complete" || busy}
            onClick={onDone}
          >
            Continue to level
          </button>
        )}
        <button className="text-button" onClick={onBack}>
          Back to worlds
        </button>
      </section>
    </main>
  );
}
