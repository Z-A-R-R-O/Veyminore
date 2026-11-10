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
