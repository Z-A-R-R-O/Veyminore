import { GameArt } from "./elements/GameArt";
import { Star } from "./elements/Star";
import { levelNames, levels } from "../domain/campaign";

export function Home({
  completed,
  stars,
  next,
  name,
  onPlay,
  onNavigate,
}: {
  completed: number;
  stars: number;
  next: number;
  name: string;
  onPlay: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="bloom-home">
      <section className="bloom-welcome">
        <span className="welcome-pill">
          {name === "Guest" ? "Your little escape" : `Welcome back, ${name}`}
        </span>
        <h1>AROWGO</h1>
        <p>A little play. A clearer path.</p>
      </section>
      <div className="bloom-stage" aria-hidden="true">
        <div className="island-halo" />
        <img
          src={
            next >= 40
              ? "/assets/generated/frostfall-home.webp"
              : next >= 20
                ? "/assets/generated/verdant-cove-home-v1.png"
                : "/assets/generated/bloom-island-v1.png"
          }
          alt=""
          className="bloom-home-island"
        />
        <span className="island-spark spark-a">✦</span>
        <span className="island-spark spark-b">✧</span>
      </div>
      <section className="bloom-play-panel" aria-label="Continue your journey">
        <div className="bloom-next">
          <span>
            {completed === levels.length
              ? "ADVENTURE COMPLETE"
              : `LEVEL ${String(next + 1).padStart(2, "0")}`}
          </span>
          <strong>
            {completed === levels.length
              ? "Beautifully done."
              : levelNames[next]}
          </strong>
        </div>
        <button className="primary-button bloom-play" onClick={onPlay}>
          <span aria-hidden="true">▶</span>
          {completed === levels.length ? "View your stars" : "Play"}
          <span className="play-glint" aria-hidden="true" />
        </button>
      </section>
      <div className="bloom-destinations">
        {(
          [
            { route: "worlds", title: "Worlds", kind: "world" },
            { route: "modes", title: "Modes", kind: "modes" },
            { route: "profile", title: "My journey", kind: "trophy" },
          ] as const
        ).map((item) => (
          <button key={item.route} onClick={() => onNavigate(item.route)}>
            <GameArt kind={item.kind} />
            <strong>{item.title}</strong>
          </button>
        ))}
      </div>
      <button className="bloom-journey" onClick={() => onNavigate("worlds")}>
        <span className="journey-text">
          <strong>Adventure · Journey</strong>
          <span>
            {completed === levels.length
              ? "Every path discovered"
              : `${completed} of ${levels.length} levels cleared`}
          </span>
          <span className="journey-track" aria-hidden="true">
            <span style={{ width: `${(completed / levels.length) * 100}%` }} />
          </span>
        </span>
        <span className="journey-stars">
          <Star /> {stars}
          <small>/{levels.length * 3}</small>
        </span>
        <span className="journey-arrow" aria-hidden="true">
          ↗
        </span>
      </button>
    </div>
  );
}
