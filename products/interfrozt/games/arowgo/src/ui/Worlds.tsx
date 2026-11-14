import { useState, type CSSProperties } from "react";
import { levelNames } from "../domain/campaign";
import { GameArt } from "./elements/GameArt";

type Progress = { available: boolean; cleared: boolean; stars: number };
const stops = [
  { x: 21, y: 88 },
  { x: 53, y: 81 },
  { x: 75, y: 72 },
  { x: 47, y: 64 },
  { x: 28, y: 56 },
  { x: 55, y: 48 },
  { x: 76, y: 40 },
  { x: 51, y: 32 },
  { x: 31, y: 23 },
  { x: 58, y: 13 },
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
            {cleared === progress.length
              ? "Valley complete"
              : `${cleared} / ${progress.length} cleared`}
          </span>
          <span
            className="valley-stars"
            aria-label={`${stars} of ${progress.length * 3} stars`}
          >
            ★ {stars}
            <span> / {progress.length * 3}</span>
          </span>
        </div>
      </header>
      <section className="valley-map" aria-label="Bloom Valley level map">
        <svg
          className="valley-trail"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="trail-shadow"
            d="M21 88 C33 86 42 84 53 81 S71 75 75 72 S58 67 47 64 S33 59 28 56 S46 51 55 48 S71 43 76 40 S61 35 51 32 S37 27 31 23 S48 17 58 13"
          />
          <path
            className="trail-light"
            d="M21 88 C33 86 42 84 53 81 S71 75 75 72 S58 67 47 64 S33 59 28 56 S46 51 55 48 S71 43 76 40 S61 35 51 32 S37 27 31 23 S48 17 58 13"
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
          <span>
            {cleared === progress.length
              ? "Beautifully done"
              : "A little further"}
          </span>
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
