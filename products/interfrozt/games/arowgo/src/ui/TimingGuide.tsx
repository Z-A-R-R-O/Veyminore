import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Level } from "../domain/rules";
export function TimingGuide({
  level,
  removed,
  persist = true,
}: {
  level: Level;
  removed: number;
  persist?: boolean;
}) {
  const clock = level.arrows.some(
    (a) => a.pulse !== undefined || a.window !== undefined,
  );
  const gates = level.arrows.some((a) => a.phase !== undefined),
    key = clock
      ? "arowgo.lesson.clockwork"
      : gates
        ? "arowgo.lesson.aurora"
        : "arowgo.lesson.ice";
  const dialog = useRef<HTMLDialogElement>(null);
  const [demo, setDemo] = useState(0);
  useEffect(() => {
    try {
      if (persist && localStorage.getItem(key) === "seen") return;
    } catch {}
    dialog.current?.showModal();
  }, [key, persist]);
  function done() {
    try {
      if (persist) localStorage.setItem(key, "seen");
    } catch {}
    dialog.current?.close();
  }
  return (
    <>
      <button
        className="timing-help"
        onClick={() => dialog.current?.showModal()}
        aria-label={
          level.levelId.startsWith("amber-")
            ? "Timing rules"
            : "Frostfall rules"
        }
      >
        {clock ? `◷ Beat ${(removed % 3) + 1}/3 · ${removed} removed · ` : ""}❄
        Ice seals
        {gates ? ` · ${removed % 2 === 0 ? "☀ Sun" : "☾ Moon"} phase` : ""} ·
        Rules
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="timing-guide"
          aria-labelledby="timing-title"
        >
          <h2 id="timing-title">
            {clock
              ? "Plan the clockwork"
              : gates
                ? "Follow the aurora"
                : "Break the ice"}
          </h2>
          <p>
            Ice numbers count down after each successful arrow removal. At zero,
            the seal thaws. Its path must still be clear.
          </p>
          {clock && (
            <p>
              Three-beat gates show 1/3, 2/3, or 3/3. They open only on that
              beat. Every removal advances 1 → 2 → 3 → 1. Square gold window
              gates count down until opening, then show how many removal
              opportunities remain; × means closed permanently. Green means
              open, but the exit must still be clear. Keep spare moves to reach
              the right beat.
            </p>
          )}
          {gates && (
            <p>
              Sun gates open in the Sun phase; Moon gates open in the Moon
              phase. Every successful removal switches phase. Save another clear
              arrow when you need to switch!
            </p>
          )}
          <div className="timing-demo" aria-live="polite">
            <span>❄ {Math.max(0, 2 - demo) || "Thawed"}</span>
            {clock && (
              <>
                <span>◷ Beat {(demo % 3) + 1}/3</span>
                <span>
                  ▣ Window:{" "}
                  {demo < 2
                    ? `opens in ${2 - demo}`
                    : demo <= 4
                      ? `${5 - demo} opportunities`
                      : "closed"}
                </span>
              </>
            )}
            {gates && (
              <span>{demo % 2 === 0 ? "☀ Sun open" : "☾ Moon open"}</span>
            )}
          </div>
          <button onClick={() => setDemo((n) => n + 1)}>Try a move</button>
          <p>
            Mistakes do not advance the count. Erase does. A legal move can
            leave no winning route—plan ahead.
          </p>
          <button className="primary" onClick={done}>
            Start puzzle
          </button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
