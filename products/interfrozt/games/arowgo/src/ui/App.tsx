import { TimingGuide } from "./TimingGuide";
import { rateMove, type MovePraise } from "../domain/movePraise";
import { MovePraiseBubble, FeedbackSymbol } from "./MovePraise";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { skins, type SkinId } from "../storage/profile";
import type { Controller } from "../application/controller";
import { stars, type Mode, type Outcome } from "../application/session";
import { Board, type BoardHandle } from "../game/Board";
import { checkExit } from "../domain/rules";
import { levels } from "../domain/campaign";
import { fixtures } from "../domain/fixtures";
import { WinMoment } from "./WinMoment";
import { Coin, CountUp, HeartToken, Encouragement } from "./elements/Rewards";
import { GameArt } from "./elements/GameArt";
import { Icon } from "./Icons";
import { Scenery, Celebration } from "./Scenery";
import { useMotion } from "./useMotion";
import { playSound, SoundSetting } from "./Sound";
import { Gem } from "./elements/Gem";
import { TIME_BOOST_COST } from "../storage/profile";
import { SaveStatus } from "./SaveStatus";

export function App({
  controller,
  onHome,
  onNext,
  levelNumber = 1,
  otherCoins = 0,
  skin = "classic",
  lesson = false,
  gems = 0,
  onTimeBoost,
  economyNotice,
  devSandbox = false,
}: {
  controller: Controller;
  onHome?: () => void;
  onNext?: () => void;
  levelNumber?: number;
  otherCoins?: number;
  skin?: SkinId;
  lesson?: boolean;
  gems?: number;
  onTimeBoost?: () => boolean | Promise<boolean>;
  economyNotice?: string;
  devSandbox?: boolean;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const motion = useMotion();
  const [praise, setPraise] = useState<{
    kind: MovePraise;
    x: number;
    y: number;
    id: number;
  } | null>(null);
  const lastPraise = useRef(-Infinity);
  useEffect(() => {
    setPraise(null);
    lastPraise.current = -Infinity;
  }, [state.attemptId]);
  const [lab, setLab] = useState(false),
    [fixture, setFixture] = useState(5);
  const [hints, setHints] = useState<string[]>([]);
  const [feedback, setFeedback] = useState(
    lesson
      ? "Clear a path for the gold key. Clear the key to open the lock."
      : "",
  );
  const [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false);
  const [restart, setRestart] = useState<Mode | null>(null);
  const [eraseMode, setEraseMode] = useState(false),
    [eraseTarget, setEraseTarget] = useState<string | null>(null);
  const [pulse, setPulse] = useState({ id: 0, kind: "idle" });
  const [celebrating, setCelebrating] = useState(false);
  const boardRef = useRef<BoardHandle | null>(null);
  const boardRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const region = boardRegion.current;
    if (!region) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      region.style.setProperty(
        "--board-size",
        `${Math.max(0, Math.min(width, height))}px`,
      );
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);
  const cooldown = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const level = controller.level;
  const cleared = level.arrows.length - state.active.length;
  const modalOpen = settings || restart !== null || eraseTarget !== null;
  const resultVisible = !lab && state.status !== "playing" && !busy;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(hintTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!resultVisible || !celebrating) return;
    const timeout = setTimeout(() => setCelebrating(false), 3600);
    return () => clearTimeout(timeout);
  }, [resultVisible, celebrating]);
  useEffect(() => {
    if (resultVisible)
      document
        .querySelector<HTMLButtonElement>(".result-layer .primary-button")
        ?.focus({ preventScroll: true });
  }, [resultVisible]);
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
    cooldown.current = performance.now() + (motion.reduced ? 140 : 680);
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setBusy(false),
      motion.reduced ? 140 : 680,
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
    void playSound("click");
    if (eraseMode) {
      setEraseTarget(id);
      return;
    }
    gate();
    clearHints();
    const before = controller.getSnapshot();
    const result = controller.select(id);
    const rating = rateMove(level, before, result);
    setPraise(null);
    if (
      rating &&
      rating !== "perfect" &&
      (rating === "mistake" ||
        rating === "blunder" ||
        (performance.now() - lastPraise.current >= 3500 && !hints.length))
    ) {
      const head = level.arrows.find((a) => a.id === id)!.points.at(-1)!;
      lastPraise.current = performance.now();
      setPraise({
        kind: rating,
        id: Date.now(),
        x: Math.max(
          22,
          Math.min(78, 10 + ((head[0] + 0.5) * 80) / level.board.columns),
        ),
        y: Math.max(
          12,
          Math.min(83, 10 + ((head[1] + 0.5) * 80) / level.board.rows - 10),
        ),
      });
    }
    if (result.state.status === "complete") void playSound("win");
    else if (result.state.status === "failed") void playSound("defeat");
    else if (result.exit && !result.exit.clear) void playSound("blocked");
    if (result.state.status === "complete") setCelebrating(true);
    if (result.exit?.clear) {
      setFeedback("");
      setPulse((p) => ({ id: p.id + 1, kind: "clear" }));
    } else if (result.exit) {
      setFeedback(
        result.exit.reason === "frozen"
          ? "Clear other arrows to thaw this ice seal."
          : result.exit.reason === "phase"
            ? "Gate closed. Clear another arrow to switch the aurora."
            : result.exit.reason === "anchored"
              ? "Clear the highlighted anchor arrow to release this arrow."
              : result.exit.reason === "locked"
                ? "Clear the gold key arrow to open this lock."
                : "The highlighted arrow blocks the path ahead of this head. Clear it first.",
      );
      setPulse((p) => ({ id: p.id + 1, kind: "blocked" }));
    }
    return result;
  }
  function reset(mode: Mode) {
    controller.restart(lesson ? "practice" : mode);
    setRestart(null);
    setEraseMode(false);
    setEraseTarget(null);
    clearHints();
    setCelebrating(false);
    setFeedback("A fresh start. Look for arrows near an open edge.");
  }
  function assist() {
    setEraseMode(false);
    const result = controller.hint();
    if (result.hints?.length)
      setPraise({ kind: "book", id: Date.now(), x: 50, y: 15 });
    if (result.hints?.length) void playSound("hint");
    setHints(result.hints ?? []);
    setPulse((p) => ({ id: p.id + 1, kind: "hint" }));
    setFeedback(
      motion.reduced
        ? "The highlighted arrow has a clear path."
        : "Follow the breathing ring.",
    );
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHints([]), 5000);
  }
  function confirmErase() {
    if (!eraseTarget) return;
    gate();
    const result = controller.erase(eraseTarget);
    if (result.state.status === "complete") void playSound("win");
    if (result.state.status === "complete") setCelebrating(true);
    boardRef.current?.animate(result);
    setFeedback("Arrow gently erased. This run is now assisted.");
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
      data-skin={skin}
      data-arrow-effect={skins.find((s) => s.id === skin)!.effect}
      style={
        {
          "--arrow-color": skins.find((s) => s.id === skin)!.color,
        } as React.CSSProperties
      }
      data-view={lab ? "lab" : "play"}
      data-status={state.status}
      data-motion={motion.reduced ? "reduced" : "full"}
      data-effects={motion.rich ? "rich" : "subtle"}
      data-paused={motion.hidden ? "true" : "false"}
    >
      <Scenery
        rich={motion.rich}
        cove={levelNumber > 20}
        frost={levelNumber > 40}
      />
      <header className="topbar" inert={modalOpen || resultVisible}>
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onHome ? onHome() : showLab(false);
          }}
        >
          <span className="brand-icon">
            <img src="/assets/brand/arowgo-arrow-v4-128.png" alt="" />
          </span>
          AROWGO
        </a>
        {!lab && (
          <SaveStatus
            compact
            failed={controller.notice.includes("memory only")}
          />
        )}
        <nav aria-label="Prototype navigation">
          {onHome && (
            <button
              className="icon-button home-button"
              onClick={onHome}
              aria-label="Leave puzzle"
              title="Home"
            >
              <Icon name="home" />
            </button>
          )}
          {lab && <button onClick={() => showLab(false)}>Play</button>}
        </nav>
        <button
          className="icon-button settings-button"
          aria-label="Settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main inert={modalOpen || resultVisible}>
        {!lab && (
          <p className="game-motto">
            A little play. A little practice in thinking.
          </p>
        )}
        <section className="level-heading">
          <div className="world-label">
            <span />{" "}
            {lab
              ? "Discover the mechanic"
              : levelNumber > 20
                ? levelNumber > 40
                  ? "World 3 · Frostfall Peaks"
                  : "World 2 · Verdant Cove"
                : "World 1 · Bloom Valley"}{" "}
            <span />
          </div>
          <h1>
            {lab
              ? "Rule lab"
              : lesson
                ? "Keys & locks"
                : `Level ${String(levelNumber).padStart(2, "0")}`}
          </h1>
          {!lab && !lesson && state.scoringVersion === 2 && (
            <small className="play-star-goals">
              ★ Finish · ★ No mistakes · ★ Within {(state.targetMs ?? 0) / 1000}
              s
            </small>
          )}
          {level.arrows.some(
            (a) => a.thawAfter !== undefined || a.phase !== undefined,
          ) ? (
            <TimingGuide
              key={level.levelId}
              level={level}
              removed={cleared}
              persist={!devSandbox}
            />
          ) : lab ? (
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
          <section
            className="game-card"
            aria-label={
              lab
                ? "Rule proof board"
                : `${levelNumber > 40 ? "Frostfall Peaks" : levelNumber > 20 ? "Verdant Cove" : "Bloom Valley"} level ${levelNumber}`
            }
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
                  aria-label={`${state.coins + otherCoins} earned coins`}
                >
                  <Coin />
                  <strong>
                    <CountUp
                      value={state.coins + otherCoins}
                      animate={!motion.reduced}
                    />
                  </strong>
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
                      <HeartToken
                        key={i}
                        filled={i < 3 - state.mistakes}
                        breaking={
                          !motion.reduced &&
                          pulse.kind === "blocked" &&
                          i === 3 - state.mistakes
                        }
                      />
                    ))
                  )}
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
            <div
              ref={boardRegion}
              className={`board-wrap ${eraseMode ? "erase-selection" : ""}`}
            >
              <div className="board-rim" />
              {praise && !modalOpen && !resultVisible && (
                <MovePraiseBubble
                  key={praise.id}
                  {...praise}
                  onDone={() => setPraise(null)}
                />
              )}
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
                  className="hint-wash"
                  aria-hidden="true"
                />
              )}
              {resultVisible &&
                createPortal(
                  <div
                    className="result-layer"
                    data-motion={motion.reduced ? "reduced" : "full"}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Level result"
                    onKeyDown={(e) => {
                      if (e.key !== "Tab") return;
                      const buttons = Array.from(
                        e.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button",
                        ),
                      );
                      if (e.shiftKey && document.activeElement === buttons[0]) {
                        e.preventDefault();
                        buttons.at(-1)?.focus();
                      } else if (
                        !e.shiftKey &&
                        document.activeElement === buttons.at(-1)
                      ) {
                        e.preventDefault();
                        buttons[0]?.focus();
                      }
                    }}
                  >
                    <div
                      className={`result-overlay ${state.status === "complete" ? "win-result" : ""} ${celebrating && !motion.reduced ? "fresh-win" : ""}`}
                      role="status"
                    >
                      {celebrating && !motion.reduced && motion.rich && (
                        <Celebration />
                      )}
                      {state.status === "complete" && (
                        <div className="victory-halo" aria-hidden="true" />
                      )}
                      <div className="result-level">
                        {lesson
                          ? "PRACTICE LESSON"
                          : `LEVEL ${String(levelNumber).padStart(2, "0")}`}
                        <SaveStatus
                          compact
                          failed={controller.notice.includes("memory only")}
                        />
                      </div>
                      <img
                        className="result-title-art"
                        src={`/assets/results/${state.status === "complete" ? "victory" : "try-again"}.png`}
                        alt=""
                        aria-hidden="true"
                      />
                      <h2 className="sr-only">
                        {state.status === "complete"
                          ? "Beautifully cleared."
                          : "Take a fresh look."}
                      </h2>
                      {state.status === "failed" && (
                        <div className="retry-summary">
                          <strong>A fresh start awaits</strong>
                          <span>
                            {cleared} / {level.arrows.length} arrows cleared
                          </span>
                          <span>
                            {state.failureReason === "keg"
                              ? "A powder keg ran out of moves. Clear its arrow before the counter reaches zero."
                              : state.failureReason === "stranded"
                                ? "No winning route remains. Plan the timing and try a different order."
                                : "Look for an open path, then try again."}
                          </span>
                        </div>
                      )}
                      {state.status === "complete" &&
                        state.mode === "story" && (
                          <div className="result-stars" aria-hidden="true">
                            {[1, 2, 3].map((n) => (
                              <span
                                key={n}
                                className={n <= stars(state) ? "earned" : ""}
                                style={{
                                  animationDelay: `${0.75 + n * 0.22}s`,
                                }}
                              >
                                <img
                                  className={`game-star ${n <= stars(state) ? "is-earned" : "is-empty"}`}
                                  src="/assets/results/star-gold.png"
                                  alt=""
                                />
                              </span>
                            ))}
                          </div>
                        )}
                      <p
                        className={
                          state.status === "complete" && state.mode === "story"
                            ? "sr-only"
                            : "result-detail"
                        }
                      >
                        {state.status === "complete"
                          ? state.mode === "practice"
                            ? "Practice complete. No stars or coins are awarded."
                            : `${stars(state)} of 3 stars · ${state.mistakes} mistakes${state.assisted ? " · Assisted" : ""}`
                          : "Your coins and best stars are safe."}
                      </p>
                      {state.status === "complete" &&
                        state.mode === "story" && (
                          <p
                            className={
                              economyNotice !== undefined
                                ? "reward"
                                : state.reward
                                  ? "sr-only"
                                  : "reward"
                            }
                          >
                            {economyNotice ??
                              (state.reward
                                ? "+25 coins · First clear reward"
                                : "First-clear reward already collected")}
                          </p>
                        )}
                      {state.status === "complete" && (
                        <>
                          <WinMoment
                            state={
                              economyNotice === undefined
                                ? state
                                : { ...state, reward: 0 }
                            }
                            animate={celebrating && !motion.reduced}
                          />
                        </>
                      )}
                      <div
                        className="result-feedback"
                        aria-label="Feedback counts for this attempt"
                      >
                        {(
                          [
                            "brilliant",
                            "great",
                            "good",
                            "book",
                            "mistake",
                            "blunder",
                          ] as const
                        )
                          .filter(
                            (kind) =>
                              (state.feedbackCounts?.[kind] ?? 0) +
                                (kind === "good"
                                  ? (state.feedbackCounts?.perfect ?? 0)
                                  : 0) >
                              0,
                          )
                          .map((kind) => (
                            <div key={kind} title={kind}>
                              <FeedbackSymbol kind={kind} />
                              <strong>
                                {(state.feedbackCounts?.[kind] ?? 0) +
                                  (kind === "good"
                                    ? (state.feedbackCounts?.perfect ?? 0)
                                    : 0)}
                              </strong>
                            </div>
                          ))}
                      </div>
                      {!state.feedbackCounts && (
                        <small>
                          Feedback counts unavailable for this older attempt.
                        </small>
                      )}
                      <Encouragement
                        kind={state.status === "complete" ? "win" : "retry"}
                      />
                      <button
                        className="primary-button"
                        onClick={() =>
                          state.status === "complete" &&
                          onNext &&
                          (lesson || state.claimed)
                            ? onNext()
                            : reset(state.mode)
                        }
                      >
                        {state.status === "complete"
                          ? lesson
                            ? "Back to Modes"
                            : onNext && state.claimed
                              ? levelNumber === 20
                                ? "Valley complete"
                                : levelNumber < levels.length
                                  ? "Next level"
                                  : "Adventure complete"
                              : "Play again"
                          : "Try again"}{" "}
                        <span aria-hidden="true">↗</span>
                      </button>
                      <div className="result-secondary-actions">
                        {state.status === "complete" &&
                          onNext &&
                          (lesson || state.claimed) && (
                            <button
                              className="text-button"
                              onClick={() => reset(state.mode)}
                            >
                              Play again
                            </button>
                          )}
                        {state.status === "failed" && (
                          <button
                            className="text-button"
                            onClick={() => reset("practice")}
                          >
                            Try Practice
                          </button>
                        )}
                        {onHome && !lesson && (
                          <button
                            className="text-button result-menu"
                            onClick={onHome}
                          >
                            <Icon name="home" /> Main menu
                          </button>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
            <div className={lab ? "play-support lab-support" : "play-support"}>
              <div
                className={`feedback ${eraseMode ? "choosing" : ""}`}
                aria-live="polite"
                hidden={!lab && !eraseMode && !feedback}
              >
                <span className="feedback-icon">
                  {eraseMode ? "◇" : pulse.kind === "blocked" ? "!" : "✧"}
                </span>
                {lab
                  ? labMessage
                  : eraseMode
                    ? "Choose an arrow to erase."
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
                    Remove blockers and test again. The lab never changes
                    campaign progress.
                  </small>
                </div>
              ) : (
                <>
                  <div className="tool-tray" aria-label="Puzzle tools">
                    <button
                      key={`hint-${pulse.kind === "hint" ? pulse.id : 0}`}
                      className={`tool-card hint-tool ${pulse.kind === "hint" ? "tool-used" : ""}`}
                      aria-label="A little hint"
                      disabled={busy || state.status !== "playing"}
                      onClick={assist}
                    >
                      <span className="tool-badge" aria-hidden="true">
                        ∞
                      </span>
                      <span className="tool-art bulb-art">
                        <GameArt kind="hint" />
                        <i />
                      </span>
                      <strong>Hint</strong>
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
                        <GameArt kind="erase" />
                      </span>
                      <strong>Erase</strong>
                    </button>
                  </div>
                  <div
                    className="card-footer"
                    hidden={lesson}
                    style={lesson ? { display: "none" } : undefined}
                  >
                    {controller.notice && (
                      <span role="status">{controller.notice}</span>
                    )}
                    <button
                      className="mode-switch"
                      onClick={() =>
                        setRestart(
                          state.mode === "story" ? "practice" : "story",
                        )
                      }
                    >
                      <Icon
                        name={state.mode === "story" ? "leaf" : "gamepad"}
                      />
                      <span>
                        {state.mode === "story"
                          ? "Switch to Practice"
                          : "Switch to Story"}
                      </span>
                      <span className="mode-switch-chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
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
                <SoundSetting />
                {onTimeBoost &&
                  state.mode === "story" &&
                  state.scoringVersion === 2 && (
                    <div className="gem-booster">
                      <strong>Time Boost · +30 seconds</strong>
                      <p>
                        Extends this attempt’s speed-star target once. Balance:{" "}
                        {gems} gems.
                      </p>
                      <button
                        className="gem-button"
                        disabled={
                          state.timeBoost ||
                          gems < TIME_BOOST_COST ||
                          state.status !== "playing"
                        }
                        onClick={async () => {
                          if (await onTimeBoost()) {
                            setSettings(false);
                            setFeedback(
                              "Time Boost added 30 seconds to your speed-star target.",
                            );
                          } else
                            setFeedback(
                              "Time Boost could not be confirmed. Retry to recover its saved receipt.",
                            );
                        }}
                      >
                        <Gem />
                        {state.timeBoost
                          ? "Boost active"
                          : `Use Time Boost · ${TIME_BOOST_COST} gems`}
                      </button>
                    </div>
                  )}
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
                  mistakes and no campaign rewards. Both tools are free in this
                  prototype. New runs award stars for completion, zero mistakes,
                  and the time target. Timing starts on your first action and
                  includes time away.
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    setSettings(false);
                    showLab(true);
                  }}
                >
                  Rule lab
                </button>
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
