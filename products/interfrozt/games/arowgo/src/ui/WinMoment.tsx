import { Coin, CountUp } from "./elements/Rewards";
import { Gem } from "./elements/Gem";
import type { Session } from "../application/session";

export interface DailyWinContext {
  streak: number;
  isFirstClear: boolean;
  coins: number;
  gems: number;
}

export function WinMoment({
  state,
  animate,
  dailyContext,
}: {
  state: Session;
  animate: boolean;
  dailyContext?: DailyWinContext;
}) {
  const mastery =
    state.mode === "practice"
      ? "A little more confident."
      : state.assisted
        ? "A little help. A complete solve."
        : state.mistakes === 0
          ? "Perfect flow · No mistakes"
          : "You found your way.";
  return (
    <div className="win-moment">
      {dailyContext && (
        <div
          className="daily-victory-streak"
          aria-label={`${dailyContext.streak} day streak`}
        >
          <span className="streak-fire-anim" aria-hidden="true">
            🔥
          </span>
          <div className="streak-badge-text">
            <strong>{dailyContext.streak}-Day Streak!</strong>
            <small>
              {dailyContext.isFirstClear
                ? "Streak extended today"
                : "Streak preserved"}
            </small>
          </div>
        </div>
      )}
      {dailyContext && dailyContext.isFirstClear && dailyContext.coins > 0 && (
        <div className="daily-prize-reveal">
          <div className="daily-prize-item">
            <Coin variant="prize" />
            <strong>+{dailyContext.coins}</strong>
            <span>coins</span>
          </div>
          <div className="daily-prize-item">
            <Gem />
            <strong>+{dailyContext.gems}</strong>
            <span>gems</span>
          </div>
        </div>
      )}
      {state.mode === "story" && state.scoringVersion === 2 && (
        <div className="result-goals">
          <div className="achieved">
            <strong>★ Complete</strong>
            <span>Board cleared</span>
          </div>
          <div className={state.mistakes === 0 ? "achieved" : ""}>
            <strong>{state.mistakes === 0 ? "★" : "☆"} Accuracy</strong>
            <span>{state.mistakes} mistakes</span>
          </div>
          <div
            className={
              (state.elapsedMs ?? Infinity) <= (state.targetMs ?? 0)
                ? "achieved"
                : ""
            }
          >
            <strong>
              {(state.elapsedMs ?? Infinity) <= (state.targetMs ?? 0)
                ? "★"
                : "☆"}{" "}
              Speed
            </strong>
            <span>
              {Math.ceil((state.elapsedMs ?? 0) / 1000)}s /{" "}
              {(state.targetMs ?? 0) / 1000}s
            </span>
          </div>
        </div>
      )}
      <div className="mastery-ribbon">
        <span aria-hidden="true">✧</span> {mastery}
      </div>
      {!dailyContext && state.mode === "story" && state.reward > 0 && (
        <div className="coin-reveal" aria-hidden="true">
          <Coin variant="prize" />
          <strong>
            <CountUp
              value={state.reward}
              from={0}
              animate={animate}
              delay={1250}
              prefix="+"
            />
          </strong>
          <span>coins earned</span>
        </div>
      )}
    </div>
  );
}
