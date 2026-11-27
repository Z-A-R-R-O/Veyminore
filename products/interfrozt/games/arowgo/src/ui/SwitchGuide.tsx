import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Level } from "../domain/rules";
export function SwitchGuide({
  level,
  persist = true,
}: {
  level: Level;
  persist?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [used, setUsed] = useState(0),
    [ordinary, setOrdinary] = useState(0);
  const key = "arowgo.lesson.switches.v1";
  useEffect(() => {
    try {
      if (persist && localStorage.getItem(key) === "seen") return;
    } catch {}
    dialog.current?.showModal();
  }, [persist]);
  const done = () => {
    try {
      if (persist) localStorage.setItem(key, "seen");
    } catch {}
    dialog.current?.close();
  };
  return (
    <>
      <button
        className="timing-help"
        onClick={() => {
          setUsed(0);
          setOrdinary(0);
          dialog.current?.showModal();
          if (dialog.current) dialog.current.scrollTop = 0;
        }}
        aria-label="Switch rules"
      >
        ◇ Switches{" "}
        {level.arrows.some((a) => a.switchGroup === 2) ? "1 & 2" : "1"} ·
        Matching gates only · Rules
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="timing-guide switch-guide"
          aria-labelledby="switch-guide-title"
        >
          <h2 id="switch-guide-title">Choose when to switch</h2>
          <p>
            Diamond badges are switches. Square badges are gates. Match their{" "}
            <strong>number</strong>: removing switch 1 toggles every gate 1, and
            never gate 2.
          </p>
          <div className="switch-demo" data-open={used === 1}>
            <span className="switch-demo-number">GATE 1</span>
            <div className="switch-demo-door" aria-hidden="true">
              <i />
              <i />
            </div>
            <strong aria-live="polite">{used === 1 ? "OPEN" : "CLOSED"}</strong>
          </div>
          <button
            className="primary"
            disabled={used === 2}
            onClick={() => setUsed((n) => n + 1)}
          >
            ◇ Remove {used === 0 ? "first" : "second"} switch 1
          </button>
          <button onClick={() => setOrdinary((n) => n + 1)}>
            Remove an ordinary arrow
          </button>
          <p aria-live="polite">
            {ordinary > 0
              ? `${ordinary} ordinary removals: gate unchanged. `
              : ""}
            {used === 2
              ? "Both switches used. This gate stays closed—clear its arrow before closing it."
              : "Each matching switch flips open ↔ closed. An open gate still needs a clear path."}
          </p>
          <button
            className="text-button"
            onClick={() => {
              setUsed(0);
              setOrdinary(0);
            }}
          >
            Reset demonstration
          </button>
          <p>
            Hold to inspect linked arrows and their changes—not a winning move.
            Erase toggles switches too; blocked taps do not.
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
