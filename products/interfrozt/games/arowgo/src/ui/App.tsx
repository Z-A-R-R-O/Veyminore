import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Controller } from "../application/controller";
import { stars, type Mode, type Outcome } from "../application/session";
import { Board, type BoardHandle } from "../game/Board";
import { checkExit } from "../domain/rules";
import { fixtures } from "../domain/fixtures";
import { Heart, Icon } from "./Icons";
import { Scenery, Celebration } from "./Scenery";
import { useMotion } from "./useMotion";

export function App({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const motion = useMotion();
  const [lab, setLab] = useState(false),
    [fixture, setFixture] = useState(5);
  const [hints, setHints] = useState<string[]>([]);
  const [feedback, setFeedback] = useState(
    "Tap an arrow with a clear path. The whole shape slides together.",
  );
  const [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false);
  const [restart, setRestart] = useState<Mode | null>(null);
  const [eraseMode, setEraseMode] = useState(false),
    [eraseTarget, setEraseTarget] = useState<string | null>(null);
  const [pulse, setPulse] = useState({ id: 0, kind: "idle" });
  const [celebrating, setCelebrating] = useState(false);
  const boardRef = useRef<BoardHandle | null>(null);
  const cooldown = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const previousStatus = useRef(state.status);
  const level = controller.level;
  const cleared = level.arrows.length - state.active.length;
  const modalOpen = settings || restart !== null || eraseTarget !== null;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(hintTimer.current);
    },
    [],
  );
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (previousStatus.current !== "complete" && state.status === "complete") {
      setCelebrating(true);
      timeout = setTimeout(() => setCelebrating(false), 2000);
    }
    previousStatus.current = state.status;
    return () => clearTimeout(timeout);
  }, [state.status]);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select",
        ) ?? [],
      );
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettings(false);
        setRestart(null);
        setEraseTarget(null);
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
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modalOpen]);

  function gate() {
    cooldown.current = performance.now() + (motion.reduced ? 140 : 520);
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setBusy(false),
      motion.reduced ? 140 : 520,
    );
  }
  function clearHints() {
    clearTimeout(hintTimer.current);
    setHints([]);
  }
  function select(id: string): Outcome | undefined {
    if (
      lab ||
      performance.now() < cooldown.current ||
      state.status !== "playing" ||
      modalOpen
    )
      return;
    if (eraseMode) {
      setEraseTarget(id);
      return;
    }
    gate();
    clearHints();
    const result = controller.select(id);
    if (result.exit?.clear) {
      setFeedback(`Arrow ${id} found its way. Keep going.`);
      setPulse((p) => ({ id: p.id + 1, kind: "clear" }));
    } else if (result.exit) {
      setFeedback(
        `Arrow ${id} is blocked by ${result.exit.blocker}. The whole shape needs a clear path.`,
      );
      setPulse((p) => ({ id: p.id + 1, kind: "blocked" }));
    }
    return result;
  }
  function reset(mode: Mode) {
    controller.restart(mode);
    setRestart(null);
    setEraseMode(false);
    setEraseTarget(null);
    clearHints();
    setCelebrating(false);
    setFeedback("A fresh start. Look for arrows near an open edge.");
  }
  function assist(type: "hint" | "analyze") {
    setEraseMode(false);
    const result = controller.hint(type);
    setHints(result.hints ?? []);
    setPulse((p) => ({ id: p.id + 1, kind: "hint" }));
    setFeedback(
      type === "hint"
        ? `Try arrow ${result.hints?.[0]}. This run is now assisted.`
        : `${result.hints?.length ?? 0} arrows can leave right now. This run is now assisted.`,
    );
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHints([]), 5000);
  }
  function confirmErase() {
    if (!eraseTarget) return;
    gate();
    const result = controller.erase(eraseTarget);
    boardRef.current?.animate(result);
    setFeedback(
      `Arrow ${eraseTarget} gently erased. This run is now assisted.`,
    );
    setEraseTarget(null);
    setEraseMode(false);
    clearHints();
    setPulse((p) => ({ id: p.id + 1, kind: "erase" }));
  }
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
  function labSelect(id: string): Outcome | undefined {
    if (modalOpen || !labActive.includes(id)) return;
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
  }
  function showLab(value: boolean) {
    setLab(value);
    setEraseMode(false);
    clearHints();
  }
  return (
    <div
      className="app-shell"
      data-motion={motion.reduced ? "reduced" : "full"}
      data-effects={motion.rich ? "rich" : "subtle"}
      data-paused={motion.hidden ? "true" : "false"}
    >
      <Scenery rich={motion.rich} />
      <header className="topbar" inert={modalOpen}>
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            showLab(false);
          }}
        >
          <span className="brand-icon">
            <Icon name="arrow" />
          </span>
          AROWGO <span className="prototype">FIRST BLOOM</span>
        </a>
        <nav aria-label="Prototype navigation">
          <button
            className={!lab ? "nav-active" : ""}
            onClick={() => showLab(false)}
          >
            Play
          </button>
          <button
            className={lab ? "nav-active" : ""}
            onClick={() => showLab(true)}
          >
            Rule lab <span>↗</span>
          </button>
        </nav>
        <button
          className="icon-button settings-button"
          aria-label="Settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main inert={modalOpen}>
        <section className="level-heading">
          <div className="world-label">
            <span /> {lab ? "Discover the mechanic" : "World 1 · Bloom Valley"}{" "}
            <span />
          </div>
          <h1>{lab ? "Rule lab" : "Level 01"}</h1>
          {lab ? (
            <p className="level-subtitle">A little room for proof.</p>
          ) : (
            <div
              className="progress-dots"
              aria-label={`${cleared} of ${level.arrows.length} paths cleared`}
            >
              {level.arrows.map((a, i) => (
                <span key={a.id} className={i < cleared ? "complete" : ""} />
              ))}
            </div>
          )}
        </section>
        <div className="play-layout">
          <aside className="journey-note">
            <span className="chapter-label">✧ FIRST BLOOM</span>
            <h2>
              A little room
              <br />
              to think.
            </h2>
            <p>
              Every arrow has a way out.
              <br />
              Sometimes, another path
              <br />
              needs to go first.
            </p>
            <div className="quiet-note">
              <Icon name="leaf" />
              No timer. Take your time.
            </div>
          </aside>
          <section
            className="game-card"
            aria-label={lab ? "Rule proof board" : "Bloom Valley level 1"}
          >
            {lab ? (
              <div className="lab-header glass-panel">
                <div>
                  <span className="eyebrow">
                    EXPERIMENT {fixture + 1} / {fixtures.length}
                  </span>
                  <h2>{f.name}</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Reset proof"
                  onClick={() => changeFixture(fixture)}
                >
                  <Icon name="reset" />
                </button>
              </div>
            ) : (
              <div className="hud glass-panel">
                <div
                  className="balance"
                  key={`coins-${state.coins}`}
                  aria-label={`${state.coins} earned coins`}
                >
                  <span className="coin">
                    <span>✦</span>
                  </span>
                  <strong>{state.coins}</strong>
                  <small>COINS</small>
                </div>
                <div className="hud-divider" />
                <div
                  className={`hearts ${pulse.kind === "blocked" ? "heart-loss" : ""}`}
                  key={`hearts-${state.mistakes}`}
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
                      <Heart key={i} filled={i < 3 - state.mistakes} />
                    ))
                  )}
                  <small>
                    {state.mode === "practice" ? "PRACTICE" : "MISTAKE HEARTS"}
                  </small>
                </div>
                <div className="hud-divider" />
                <button
                  className="icon-button restart-button"
                  disabled={busy}
                  aria-label="Restart"
                  onClick={() => setRestart(state.mode)}
                >
                  <Icon name="reset" />
                </button>
              </div>
            )}
            {lab && (
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
            )}
            <div className={`board-wrap ${eraseMode ? "erase-selection" : ""}`}>
              <div className="board-rim" />
              <Board
                apiRef={boardRef}
                key={lab ? `proof-${fixture}` : "campaign"}
                level={lab ? f.level : level}
                active={lab ? labActive : state.active}
                hints={lab ? [] : hints}
                disabled={
                  modalOpen || (!lab && (busy || state.status !== "playing"))
                }
                reduced={motion.reduced}
                rich={motion.rich}
                onSelect={lab ? labSelect : select}
              />
              {!lab && pulse.kind === "hint" && !motion.reduced && (
                <div
                  key={`scan-${pulse.id}`}
                  className="board-scan"
                  aria-hidden="true"
                />
              )}
              {!lab && state.status !== "playing" && (
                <div className="result-overlay" role="status">
                  {celebrating && !motion.reduced && motion.rich && (
                    <Celebration />
                  )}
                  <div className="result-symbol">
                    {state.status === "complete" ? "✦" : "♡"}
                  </div>
                  <span className="eyebrow">
                    {state.status === "complete"
                      ? "A MOMENT OF CLARITY"
                      : "THERE’S ALWAYS ANOTHER WAY"}
                  </span>
                  <h2>
                    {state.status === "complete"
                      ? "Beautifully cleared."
                      : "Take a fresh look."}
                  </h2>
                  {state.status === "complete" && state.mode === "story" && (
                    <div className="result-stars" aria-hidden="true">
                      {[1, 2, 3].map((n) => (
                        <span
                          key={n}
                          className={n <= stars(state) ? "earned" : ""}
                          style={{ animationDelay: `${n * 0.13}s` }}
                        >
                          ★
                        </span>
                      ))}
                    </div>
                  )}
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
            <div
              className={`feedback ${eraseMode ? "choosing" : ""}`}
              aria-live="polite"
            >
              <span className="feedback-icon">
                {eraseMode ? "◇" : pulse.kind === "blocked" ? "!" : "✧"}
              </span>
              {lab
                ? labMessage
                : eraseMode
                  ? "Choose an arrow to erase. You’ll confirm before it disappears."
                  : feedback}
              {eraseMode && (
                <button onClick={() => setEraseMode(false)}>Cancel</button>
              )}
            </div>
            {lab ? (
              <div className="lab-explanation glass-panel">
                <strong>
                  Expected: {f.clear ? "clear exit" : "blocked exit"}
                </strong>
                <p>{f.description}</p>
                <small>
                  Remove blockers and test again. The lab never changes campaign
                  progress.
                </small>
              </div>
            ) : (
              <>
                <div className="tool-tray" aria-label="Puzzle tools">
                  <button
                    className="tool-card hint-tool"
                    aria-label="A little hint"
                    disabled={busy || state.status !== "playing"}
                    onClick={() => assist("hint")}
                  >
                    <span className="tool-badge" aria-hidden="true">
                      ∞
                    </span>
                    <span className="tool-art bulb-art">
                      <Icon name="bulb" />
                      <i />
                    </span>
                    <strong>Hint</strong>
                    <small>Reveal one path</small>
                  </button>
                  <button
                    className="tool-card analyze-tool"
                    aria-label="Analyze"
                    disabled={busy || state.status !== "playing"}
                    onClick={() => assist("analyze")}
                  >
                    <span className="tool-badge" aria-hidden="true">
                      ∞
                    </span>
                    <span className="tool-art analyze-art">
                      <Icon name="analyze" />
                    </span>
                    <strong>Analyze</strong>
                    <small>Find every exit</small>
                  </button>
                  <button
                    className={`tool-card erase-tool ${eraseMode ? "selected" : ""}`}
                    aria-label="Erase"
                    aria-pressed={eraseMode}
                    disabled={busy || state.status !== "playing"}
                    onClick={() => {
                      clearHints();
                      setEraseMode(!eraseMode);
                    }}
                  >
                    <span className="tool-badge" aria-hidden="true">
                      ∞
                    </span>
                    <span className="tool-art erase-art">
                      <Icon name="erase" />
                    </span>
                    <strong>Erase</strong>
                    <small>Remove one arrow</small>
                  </button>
                </div>
                <p className="tool-policy">
                  Free tools in this prototype · Using a tool marks the run
                  assisted
                </p>
                <div className="card-footer">
                  <span>
                    {controller.notice || "✓ Progress saved on this device"}
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
              </>
            )}
          </section>
          <aside className="world-note">
            <span className="world-emblem">✿</span>
            <span className="chapter-label">BLOOM VALLEY</span>
            <p>
              Think.
              <br />
              Clear.
              <br />
              <em>Go.</em>
            </p>
            <span className="world-note-line" />
            <small>
              A little space.
              <br />A fresh perspective.
            </small>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            INTERFROZT <i> / </i> AROWGO
          </span>
          <span>
            A small beginning. <span className="tiny-flower">✳</span>
          </span>
        </footer>
      </main>
      {modalOpen && (
        <div className="modal-shade">
          <section
            className="modal glass-panel"
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
                setEraseTarget(null);
              }}
            >
              <Icon name="close" />
            </button>
            <span className="eyebrow">
              {settings
                ? "YOUR QUIET CORNER"
                : eraseTarget
                  ? "A LITTLE HELP"
                  : "BLOOM VALLEY"}
            </span>
            <h2 id="modal-title">
              {settings
                ? "Make yourself comfortable."
                : eraseTarget
                  ? `Erase arrow ${eraseTarget}?`
                  : "A fresh beginning?"}
            </h2>
            {settings ? (
              <>
                <label className="setting">
                  <span>
                    <strong>Reduce motion</strong>
                    <small>
                      {motion.systemReduced
                        ? "Enabled by your device preference"
                        : "Keep the scene still and skip particle effects"}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={motion.reduced}
                    disabled={motion.systemReduced}
                    onChange={(e) =>
                      motion.update({ reduced: e.target.checked })
                    }
                  />
                </label>
                <label className="setting">
                  <span>
                    <strong>Visual effects</strong>
                    <small>Choose how lively the valley feels</small>
                  </span>
                  <select
                    value={motion.rich ? "rich" : "subtle"}
                    onChange={(e) =>
                      motion.update({ rich: e.target.value === "rich" })
                    }
                  >
                    <option value="rich">Rich</option>
                    <option value="subtle">Subtle</option>
                  </select>
                </label>
                <p>
                  Story has three mistake hearts. Practice has unlimited
                  mistakes and no campaign rewards. All three tools are free in
                  this prototype and mark a run assisted.
                </p>
                <p className="muted">
                  Motion preferences stay on this device. Gameplay uses no
                  account or network after loading.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setSettings(false)}
                >
                  Back to the puzzle
                </button>
              </>
            ) : eraseTarget ? (
              <>
                <p>
                  This removes the whole arrow, even if its exit is blocked.
                  Your run will be marked assisted. No coins or hearts are
                  spent.
                </p>
                <button className="primary-button" onClick={confirmErase}>
                  Erase arrow {eraseTarget}
                </button>
                <button
                  className="text-button"
                  onClick={() => setEraseTarget(null)}
                >
                  Keep the arrow
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
