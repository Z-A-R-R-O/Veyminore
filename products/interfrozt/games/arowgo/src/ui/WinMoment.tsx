import { useEffect, useState } from "react";
import type { Session } from "../application/session";

export function WinMoment({
  state,
  animate,
}: {
  state: Session;
  animate: boolean;
}) {
  const [coins, setCoins] = useState(state.reward);
  useEffect(() => {
    if (!animate || !state.reward) {
      setCoins(state.reward);
      return;
    }
    setCoins(0);
    let frame = 0;
    const start = performance.now() + 1250;
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / 850));
      setCoins(Math.round(state.reward * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, state.reward]);
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
          <span className="prize-coin">✦</span>
          <strong>+{coins}</strong>
          <span>coins earned</span>
        </div>
      )}
      <span className="win-keepsake">
        Bloom Valley ·{" "}
        {state.active.length === 0 ? "10 / 10 paths cleared" : "Complete"}
      </span>
    </div>
  );
}
