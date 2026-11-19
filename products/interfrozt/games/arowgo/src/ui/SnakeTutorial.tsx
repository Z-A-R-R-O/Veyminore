import { useState } from "react";
import { Board } from "../game/Board";
import { validateLevel, type Arrow } from "../domain/rules";
import { newSession, resolve } from "../application/session";
import { useMotion } from "./useMotion";
import "./snake-tutorial.css";
const examples: {
  title: string;
  text: string;
  arrows: Arrow[];
  solution: string[];
}[] = [
  {
    title: "Follow the head",
    text: "Tap the arrow. Its head travels straight ahead and the body follows.",
    arrows: [
      {
        id: "A",
        points: [
          [1, 2],
          [3, 2],
        ],
      },
    ],
    solution: ["A"],
  },
  {
    title: "Clear the way",
    text: "The upward arrow blocks the right-pointing head. Clear it first, then tap the right arrow.",
    arrows: [
      {
        id: "A",
        points: [
          [0, 2],
          [2, 2],
        ],
      },
      {
        id: "B",
        points: [
          [4, 3],
          [4, 1],
        ],
      },
    ],
    solution: ["B", "A"],
  },
  {
    title: "Bends follow like a snake",
    text: "Tap the bent arrow first. Only the space ahead of its head must be clear—the body follows its own path.",
    arrows: [
      {
        id: "A",
        points: [
          [0, 1],
          [0, 3],
          [2, 3],
        ],
      },
      {
        id: "B",
        points: [
          [3, 1],
          [3, 0],
        ],
      },
    ],
    solution: ["A", "B"],
  },
];
export const snakeLessons = examples.map((e, i) =>
  validateLevel({
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 5,
    levelId: `snake-lesson-${i}`,
    board: { columns: 6, rows: 6 },
    arrows: e.arrows,
    solution: e.solution,
  }),
);
export function SnakeTutorial({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState(() =>
    newSession(snakeLessons[0], "lesson", "practice"),
  );
  const [message, setMessage] = useState("");
  const [hints, setHints] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const motion = useMotion();
  return (
    <main className="snake-tutorial">
      <section>
        <span className="eyebrow">HOW TO PLAY · {step + 1} / 3</span>
        <h1>{examples[step].title}</h1>
        <p>{examples[step].text}</p>
        <div className="snake-lesson-board">
          <Board
            key={step}
            level={snakeLessons[step]}
            active={state.active}
            hints={hints}
            disabled={busy}
            reduced={motion.reduced}
            onSelect={(id) => {
              if (busy) return;
              const result = resolve(snakeLessons[step], state, {
                id: crypto.randomUUID(),
                attemptId: state.attemptId,
                type: "select",
                arrowId: id,
              });
              setState(result.state);
              setHints(
                result.exit && !result.exit.clear ? [result.exit.blocker] : [],
              );
              setMessage(
                result.exit?.clear
                  ? "That’s it—the body follows the head."
                  : "That arrow blocks the head’s path. Clear it first.",
              );
              setBusy(true);
              setTimeout(() => setBusy(false), motion.reduced ? 50 : 680);
              return result;
            }}
          />
        </div>
        <p role="status">{message || "Tap an arrow to try it."}</p>
        <button
          className="primary-button"
          disabled={state.status !== "complete" || busy}
          onClick={() => {
            if (step === 2) {
              onDone();
              return;
            }
            const next = step + 1;
            setStep(next);
            setState(
              newSession(snakeLessons[next], `lesson-${next}`, "practice"),
            );
            setHints([]);
            setMessage("");
          }}
        >
          {step === 2 ? "Start playing" : "Next lesson"}
        </button>
        <button className="text-button" onClick={onBack}>
          Back to menu
        </button>
      </section>
    </main>
  );
}
