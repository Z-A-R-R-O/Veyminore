import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Controller } from "../application/controller";
import { stars, type Mode, type Outcome } from "../application/session";
import { Board } from "../game/Board";
import { checkExit } from "../domain/rules";
import { fixtures } from "../domain/fixtures";

function Icon({
  name,
}: {
  name: "arrow" | "reset" | "bulb" | "leaf" | "sound" | "close";
}) {
  const paths = {
    arrow: "M5 17V7h14m-5-5 5 5-5 5",
    reset: "M4 10a8 8 0 1 1 1 8M4 3v7h7",
    bulb: "M9 18h6m-5 4h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4",
    leaf: "M20 3C7 1 2 10 7 16s15 0 13-13ZM5 21 16 8",
    sound: "m4 10 4 0 5-5v14l-5-5H4Zm13-3c3 3 3 7 0 10",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function App({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [lab, setLab] = useState(false),
    [fixture, setFixture] = useState(5);
  const [hint, setHint] = useState<string[]>([]);
  const [feedback, setFeedback] = useState(
    "Find a path with room to leave. Tap anywhere along an arrow.",
  );
  const [busy, setBusy] = useState(false),
    [restart, setRestart] = useState<Mode | null>(null);
  const [settings, setSettings] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const cooldown = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!restart && !settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>("button:not(:disabled),input") ??
          [],
      );
    controls()[0]?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRestart(null);
        setSettings(false);
      }
      if (e.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [restart, settings]);
  const level = controller.level;
  const select = (id: string): Outcome | undefined => {
    if (
      lab ||
      performance.now() < cooldown.current ||
      state.status !== "playing" ||
      restart ||
      settings
    )
      return;
    cooldown.current = performance.now() + 520;
    setBusy(true);
    setHint([]);
    const outcome = controller.select(id);
    if (outcome.exit?.clear)
      setFeedback(`Arrow ${id} found its way. Keep going.`);
    else if (outcome.exit)
      setFeedback(
        `Arrow ${id} is blocked by ${outcome.exit.blocker}. The whole shape needs a clear path.`,
      );
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBusy(false), 520);
    return outcome;
  };
  const reset = (mode: Mode) => {
    controller.restart(mode);
    setRestart(null);
    setHint([]);
    setFeedback("A fresh start. Look for arrows near an open edge.");
  };
  const f = fixtures[fixture];
  const [labActive, setLabActive] = useState(f.level.arrows.map((a) => a.id));
  const [labMessage, setLabMessage] = useState(
    "Select A to test the expected result.",
  );
  function changeFixture(index: number) {
    setFixture(index);
    setLabActive(fixtures[index].level.arrows.map((a) => a.id));
    setLabMessage("Select A to test the expected result.");
  }
  const labSelect = (id: string): Outcome => {
    const exit = checkExit(f.level, labActive, id);
    if (exit.clear) {
      setLabActive(labActive.filter((a) => a !== id));
      setLabMessage(
        `${id}: clear. Entire shape exits in ${exit.distance} grid steps.`,
      );
    } else
      setLabMessage(
        `${id}: blocked by ${exit.blocker} at (${exit.cell.join(", ")}), step ${exit.step}.`,
      );
    return { state, exit, arrowId: id };
  };
  const cleared = level.arrows.length - state.active.length;
  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setLab(false);
          }}
        >
          <span className="brand-icon">
            <Icon name="arrow" />
          </span>
          AROWGO<span className="prototype">FIRST BLOOM</span>
        </a>
        <nav aria-label="Prototype navigation">
          <button
            className={lab ? "" : "nav-active"}
            onClick={() => setLab(false)}
          >
            Play
          </button>
          <button
            className={lab ? "nav-active" : ""}
            onClick={() => setLab(true)}
          >
            Rule lab <span>↗</span>
          </button>
        </nav>
        <button
          className="icon-button settings-button"
          aria-label="Settings"
          onClick={() => setSettings(true)}
        >
          ⚙
        </button>
      </header>
      <main>
        <section className="intro">
          <span className="eyebrow">
            <span /> {lab ? "EXPLORE THE MECHANIC" : "WORLD 01 · BLOOM VALLEY"}
          </span>
          <h1>
            {lab ? "A little room for proof." : "A little room to think."}
          </h1>
          <p>
            {lab
              ? "Small boards. Clear answers. See why the whole arrow matters."
              : "Follow the arrows. Find the quiet way out."}
          </p>
        </section>
        <div className="play-layout">
          <aside className="journey-card">
            <div className="island-art" aria-hidden="true">
              <div className="sun" />
              <div className="cloud cloud-one" />
              <div className="cloud cloud-two" />
              <div className="island">
                <div className="grass" />
                <div className="waterfall" />
                <div className="tree">
                  <i />
                  <b />
                  <span />
                  <em />
                </div>
                <div className="stone-arch" />
              </div>
              <span className="petal p1" />
              <span className="petal p2" />
              <span className="petal p3" />
            </div>
            <div className="journey-content">
              <span className="eyebrow">YOUR FIRST STEPS</span>
              <h2>
                Every path
                <br />
                has a way.
              </h2>
              <p>
                An arrow slides as one whole shape in the direction it points.
                Clear the ones in its way first.
              </p>
              <div className="lesson">
                <span>01</span>
                <div>
                  <strong>Look at the whole arrow</strong>
                  <small>A clear tip isn’t always a clear path.</small>
                </div>
              </div>
              <div className="lesson">
                <span>02</span>
                <div>
                  <strong>Make a little space</strong>
                  <small>Each exit opens new possibilities.</small>
                </div>
              </div>
              <div className="quiet-note">
                <Icon name="leaf" />
                <span>No timer. Take your time.</span>
              </div>
            </div>
          </aside>
          <section
            className="game-card"
            aria-label={lab ? "Rule proof board" : "Bloom Valley level 1"}
          >
            <div className="game-heading">
              <div>
                <span className="eyebrow">
                  {lab
                    ? "RULE LAB"
                    : state.mode === "practice"
                      ? "PRACTICE · UNLIMITED MISTAKES"
                      : "STORY · FIRST BLOOM"}
                </span>
                <h2>
                  {lab ? f.name : "Level 01"}
                  <span className="difficulty">{lab ? "PROOF" : "GENTLE"}</span>
                </h2>
              </div>
              {lab ? (
                <button
                  className="icon-button"
                  aria-label="Reset proof"
                  onClick={() => changeFixture(fixture)}
                >
                  <Icon name="reset" />
                </button>
              ) : (
                <div
                  className="balance"
                  aria-label={`${state.coins} earned coins`}
                >
                  <span>✦</span>
                  {state.coins}
                </div>
              )}
            </div>
            {lab ? (
              <div className="fixture-tabs" aria-label="Rule examples">
                {fixtures.map((item, i) => (
                  <button
                    key={item.name}
                    className={fixture === i ? "selected" : ""}
                    onClick={() => changeFixture(i)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="status-row">
                <div
                  className="hearts"
                  aria-label={
                    state.mode === "practice"
                      ? "Unlimited mistakes"
                      : `${Math.max(0, 3 - state.mistakes)} hearts remaining`
                  }
                >
                  {state.mode === "practice" ? (
                    <span className="infinity">∞</span>
                  ) : (
                    [0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={i < 3 - state.mistakes ? "" : "empty-heart"}
                      >
                        ♥
                      </span>
                    ))
                  )}
                  <small>
                    {state.mode === "practice" ? "Practice" : "Mistake hearts"}
                  </small>
                </div>
                <div className="progress-label">
                  <strong>
                    {cleared}
                    <span> / {level.arrows.length}</span>
                  </strong>
                  <small>paths cleared</small>
                </div>
              </div>
            )}
            <div className="board-wrap">
              <Board
                key={lab ? `proof-${fixture}` : "campaign"}
                level={lab ? f.level : level}
                active={lab ? labActive : state.active}
                hints={lab ? [] : hint}
                disabled={
                  !lab &&
                  (busy || state.status !== "playing" || !!restart || settings)
                }
                reduced={reduced}
                onSelect={lab ? labSelect : select}
              />
              {!lab && state.status !== "playing" && (
                <div className="result-overlay" role="status">
                  <div className="result-symbol">
                    {state.status === "complete" ? "✦" : "♡"}
                  </div>
                  <span className="eyebrow">
                    {state.status === "complete"
                      ? "A LITTLE MOMENT OF CLARITY"
                      : "THERE’S ALWAYS ANOTHER WAY"}
                  </span>
                  <h2>
                    {state.status === "complete"
                      ? "Beautifully cleared."
                      : "Take a fresh look."}
                  </h2>
                  <p>
                    {state.status === "complete"
                      ? state.mode === "practice"
                        ? "Practice complete. No stars or coins are awarded."
                        : `${stars(state)} of 3 stars · ${state.mistakes} mistakes${state.assisted ? " · Assisted" : ""}`
                      : "Three blocked moves. Try again, or explore with unlimited mistakes."}
                  </p>
                  {state.status === "complete" && state.mode === "story" && (
                    <p className="reward">
                      {state.reward
                        ? "+25 coins · First clear reward"
                        : "First-clear reward already collected"}
                    </p>
                  )}
                  <button
                    className="primary-button"
                    onClick={() => reset(state.mode)}
                  >
                    {state.status === "complete" ? "Play again" : "Try again"}{" "}
                    <span>↗</span>
                  </button>
                  {state.status === "failed" && (
                    <button
                      className="text-button"
                      onClick={() => reset("practice")}
                    >
                      Try Practice
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="feedback" aria-live="polite">
              <span className="feedback-dot" />
              {lab ? labMessage : feedback}
            </div>
            {lab ? (
              <div className="lab-explanation">
                <strong>
                  Expected: {f.clear ? "clear exit" : "blocked exit"}
                </strong>
                <p>{f.description}</p>
                <small>
                  Remove blockers and test again. The laboratory does not change
                  campaign progress.
                </small>
              </div>
            ) : (
              <div className="game-actions">
                <button
                  className="hint-button"
                  disabled={busy || state.status !== "playing"}
                  onClick={() => {
                    const r = controller.hint();
                    setHint(r.hints ?? []);
                    setFeedback(
                      `Try arrow ${r.hints?.[0]}. Hints mark this run as assisted.`,
                    );
                  }}
                >
                  <Icon name="bulb" />
                  <div>
                    <strong>A little hint</strong>
                    <small>Marks this run assisted</small>
                  </div>
                  <span>↗</span>
                </button>
                <button
                  className="restart-button"
                  disabled={busy}
                  onClick={() => setRestart(state.mode)}
                >
                  <Icon name="reset" />
                  <span>Restart</span>
                </button>
              </div>
            )}
            {!lab && (
              <div className="card-footer">
                <span>
                  {controller.notice || "Progress saved on this device"}
                </span>
                <button
                  onClick={() =>
                    setRestart(state.mode === "story" ? "practice" : "story")
                  }
                >
                  {state.mode === "story"
                    ? "Switch to Practice"
                    : "Switch to Story"}
                </button>
              </div>
            )}
          </section>
        </div>
        <footer className="page-footer">
          <span>
            INTERFROZT <i> / </i> A SMALL BEGINNING
          </span>
          <span>
            One level. A world of possibility.{" "}
            <span className="tiny-flower">✳</span>
          </span>
        </footer>
      </main>
      {(restart || settings) && (
        <div className="modal-shade">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setRestart(null);
                setSettings(false);
              }}
            >
              <Icon name="close" />
            </button>
            <h2 id="modal-title">
              {settings ? "Make yourself comfortable." : "A fresh beginning?"}
            </h2>
            {settings ? (
              <>
                <label className="setting">
                  <span>Reduce motion</span>
                  <input
                    type="checkbox"
                    checked={reduced}
                    onChange={(e) => setReduced(e.target.checked)}
                  />
                </label>
                <p>
                  Story has three mistake hearts. Practice has unlimited
                  mistakes and no campaign rewards. Hints are free in this
                  prototype.
                </p>
                <p className="muted">
                  Movement rule v1 · First playable · No account or network
                  required during play.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setSettings(false)}
                >
                  Back to the puzzle
                </button>
              </>
            ) : (
              <>
                <p>
                  {restart !== state.mode
                    ? `Switching to ${restart} starts a new run.`
                    : "This resets the current board."}{" "}
                  Your earned coins and best stars stay safe.
                </p>
                <button
                  className="primary-button"
                  onClick={() => reset(restart!)}
                >
                  Start fresh
                </button>
                <button
                  className="text-button"
                  onClick={() => setRestart(null)}
                >
                  Keep playing
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
