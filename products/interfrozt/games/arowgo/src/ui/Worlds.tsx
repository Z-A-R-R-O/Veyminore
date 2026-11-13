import { useState, type CSSProperties } from "react";
import { levelNames } from "../domain/campaign";
import { GameArt } from "./elements/GameArt";

type Progress = { available: boolean; cleared: boolean; stars: number };
const stops = [
  { x: 25, y: 84 },
  { x: 65, y: 67 },
  { x: 35, y: 49 },
  { x: 70, y: 31 },
  { x: 49, y: 12 },
];

export function Worlds({
  next,
  stars,
  progress,
  onPlay,
}: {
  next: number;
  stars: number;
  progress: Progress[];
  onPlay: (index: number) => void;
}) {
  const [selected, setSelected] = useState(next);
  const cleared = progress.filter((p) => p.cleared).length;
  return (
    <>
      <header className="valley-heading">
        <span className="valley-kicker">WORLD 01</span>
        <h1>Bloom Valley</h1>
        <div className="valley-progress">
          <span>
            {cleared === 5 ? "Valley complete" : `${cleared} / 5 cleared`}
          </span>
          <span className="valley-stars" aria-label={`${stars} of 15 stars`}>
            ★ {stars}
            <span> / 15</span>
          </span>
        </div>
      </header>
      <section className="valley-map" aria-label="Bloom Valley level map">
        <img
          className="valley-island"
          src="/assets/generated/bloom-island-v1.png"
          alt=""
        />
        <svg
          className="valley-trail"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="trail-shadow"
            d="M25 84 C25 75 65 78 65 67 S35 60 35 49 S70 43 70 31 S49 24 49 12"
          />
          <path
            className="trail-light"
            d="M25 84 C25 75 65 78 65 67 S35 60 35 49 S70 43 70 31 S49 24 49 12"
          />
        </svg>
        {progress.map((p, i) => (
          <button
            key={i}
            className={`valley-stop ${p.cleared ? "is-cleared" : ""} ${selected === i ? "is-selected" : ""}`}
            style={
              {
                "--x": `${stops[i].x}%`,
                "--y": `${stops[i].y}%`,
              } as CSSProperties
            }
            disabled={!p.available}
            aria-label={`Play level ${i + 1}: ${levelNames[i]}`}
            aria-pressed={selected === i}
            aria-describedby={`valley-state-${i}`}
            onClick={() => setSelected(i)}
          >
            {i === next && !p.cleared && (
              <span className="stop-spark" aria-hidden="true">
                ✦
              </span>
            )}
            <span className="stop-disc">{i + 1}</span>
            <span id={`valley-state-${i}`} className="stop-status">
              {!p.available ? (
                <>
                  <svg viewBox="0 0 20 22" aria-hidden="true">
                    <path d="M5 9V6a5 5 0 0 1 10 0v3M3 9h14v11H3Z" />
                    <circle cx="10" cy="14" r="1" />
                  </svg>
                  <span className="sr-only">Locked</span>
                </>
              ) : p.cleared ? (
                <>
                  <span aria-hidden="true">
                    {"★".repeat(p.stars)}
                    <span className="unearned-stars">
                      {"★".repeat(3 - p.stars)}
                    </span>
                  </span>
                  <span className="sr-only">{p.stars} stars earned</span>
                </>
              ) : (
                <span>{selected === i ? "PLAY" : "Ready"}</span>
              )}
            </span>
          </button>
        ))}
        <div className="valley-discovery" aria-hidden="true">
          <GameArt kind="trophy" />
          <span>{cleared === 5 ? "Beautifully done" : "A little further"}</span>
        </div>
      </section>
      <section className="valley-launch" aria-label="Selected level">
        <div className="valley-selection">
          <span>LEVEL {String(selected + 1).padStart(2, "0")}</span>
          <h2>{levelNames[selected]}</h2>
        </div>
        <button
          className="primary-button valley-play"
          onClick={() => onPlay(selected)}
        >
          <span aria-hidden="true">▶</span>{" "}
          {progress[selected].cleared ? "Replay" : "Play"} {selected + 1}
        </button>
      </section>
    </>
  );
}
