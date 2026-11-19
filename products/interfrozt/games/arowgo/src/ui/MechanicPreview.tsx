import { useEffect, useState } from "react";
import { useMotion } from "./useMotion";
import "./mechanic-preview.css";
const captions = [
  "Tap the arrow blocking the key.",
  "Now clear the gold key arrow.",
  "The lock opens. Its arrow can move!",
  "You’re ready. Try it yourself.",
];
export function MechanicPreview({
  onStart,
  onBack,
  startLabel = "Try it yourself",
}: {
  onStart: () => void;
  onBack: () => void;
  startLabel?: string;
}) {
  const motion = useMotion();
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(true),
    [run, setRun] = useState(0);
  useEffect(() => {
    if (!playing || motion.reduced || motion.hidden || step === 3) return;
    const timer = setTimeout(() => setStep((s) => s + 1), 2400);
    return () => clearTimeout(timer);
  }, [step, playing, motion.reduced, motion.hidden, run]);
  const hand = step === 0 ? [133, 58] : step === 1 ? [90, 135] : [240, 158];
  return (
    <main
      className="mechanic-preview"
      data-reduced={motion.reduced}
      data-paused={!playing || motion.hidden}
    >
      <section className="preview-card" aria-labelledby="preview-title">
        <span className="eyebrow">NEW MECHANIC · QUICK LOOK</span>
        <h1 id="preview-title">Keys & locks</h1>
        <div className="preview-stage" data-step={step} key={run}>
          <svg viewBox="0 0 320 300" aria-hidden="true">
            <defs>
              <marker
                id="demo-tip"
                viewBox="0 0 12 12"
                refX="9"
                refY="6"
                markerWidth="2"
                markerHeight="2"
                orient="auto"
              >
                <path d="M1 1 L11 6 L1 11Z" fill="#684094" />
              </marker>
            </defs>
            <g
              className={`demo-arrow demo-blocker ${step >= 1 ? "exited" : ""}`}
            >
              <path d="M90 58 H145" />
            </g>
            <g className={`demo-arrow demo-key ${step >= 2 ? "exited" : ""}`}>
              <path d="M90 230 V125" />
              <image
                href="/assets/mechanics/key.png"
                x="62"
                y="200"
                width="56"
                height="56"
              />
            </g>
            <g className={`demo-arrow demo-gate ${step >= 3 ? "exited" : ""}`}>
              <path d="M240 230 V150" />
            </g>
            <image
              className={`demo-lock ${step >= 2 ? "opened" : ""}`}
              href="/assets/mechanics/lock.png"
              x="212"
              y="200"
              width="56"
              height="56"
            />
            <g
              className="demo-pointer"
              style={{
                transform: `translate(${hand[0]}px,${hand[1]}px)`,
                opacity: step === 3 ? 0 : 1,
              }}
            >
              <circle
                className="demo-tap"
                r="16"
                fill="none"
                stroke="#d59cff"
                strokeWidth="3"
              />
              <image
                className="demo-hand"
                href="/assets/mechanics/hand.png"
                x="-23"
                y="-3"
                width="65"
                height="65"
              />
            </g>
          </svg>
        </div>
        <p className="preview-caption" aria-live="polite">
          {captions[step]}
        </p>
        <div className="preview-timeline" aria-label={`Step ${step + 1} of 4`}>
          {captions.map((_, i) => (
            <span key={i} className={i <= step ? "done" : ""} />
          ))}
        </div>
        <div className="preview-controls">
          {motion.reduced ? (
            <button
              onClick={() => setStep((s) => Math.min(3, s + 1))}
              disabled={step === 3}
            >
              Next step
            </button>
          ) : (
            <button onClick={() => setPlaying((p) => !p)} disabled={step === 3}>
              {playing ? "Pause" : "Play"}
            </button>
          )}
          <button
            onClick={() => {
              setStep(0);
              setRun((r) => r + 1);
              setPlaying(true);
            }}
          >
            Replay
          </button>
        </div>
        <button className="primary-button" onClick={onStart}>
          {startLabel}
        </button>
        <button className="text-button" onClick={onBack}>
          Back to Modes
        </button>
      </section>
    </main>
  );
}
