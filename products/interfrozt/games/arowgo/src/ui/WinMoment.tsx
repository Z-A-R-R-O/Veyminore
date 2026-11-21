import { Coin, CountUp } from "./elements/Rewards";
import type { Session } from "../application/session";

export function WinMoment({
  state,
  animate,
}: {
  state: Session;
  animate: boolean;
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
      {state.mode === "story" && state.reward > 0 && (
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
