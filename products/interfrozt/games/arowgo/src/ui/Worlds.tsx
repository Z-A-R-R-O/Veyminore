import { useState, useRef, type CSSProperties } from "react";
import { levelNames } from "../domain/campaign";
import { GameArt } from "./elements/GameArt";
import { Star } from "./elements/Star";

type Progress = { available: boolean; cleared: boolean; stars: number };
const worldNames = [
  "Bloom Valley",
  "Verdant Cove",
  "Frostfall Peaks",
  "Amber Dunes",
  "Amber Sanctum",
];
const amberStops = [
  [68, 79],
  [27, 70],
  [68, 62],
  [28, 55],
  [68, 47],
  [28, 40],
  [68, 34],
  [33, 30],
  [61, 25],
  [81, 23],
].map(([x, y]) => ({ x, y }));
const frostStops = [26, 73, 26, 73, 26, 73, 26, 73, 26, 73].map((x, i) => ({
  x,
  y: [78, 61, 47, 34, 22][Math.floor(i / 2)],
}));
const stops = [
  { x: 28, y: 78 },
  { x: 51, y: 76 },
  { x: 68, y: 63 },
  { x: 44, y: 61 },
  { x: 27, y: 51 },
  { x: 49, y: 49 },
  { x: 78, y: 40 },
  { x: 55, y: 38 },
  { x: 60, y: 29 },
  { x: 83, y: 28 },
];

// Coordinates are tied to the Cove artwork, rather than Bloom's terraces.
const coveStops = [
  { x: 42, y: 81 },
  { x: 60, y: 74 },
  { x: 42, y: 67 },
  { x: 58, y: 61 },
  { x: 43, y: 55 },
  { x: 65, y: 48 },
  { x: 49, y: 42 },
  { x: 71, y: 37 },
  { x: 53, y: 31 },
  { x: 77, y: 25 },
];
const coveWideStops = [
  { x: 12, y: 81 },
  { x: 31, y: 73 },
  { x: 24, y: 60 },
  { x: 49, y: 64 },
  { x: 43, y: 48 },
  { x: 68, y: 48 },
  { x: 39, y: 36 },
  { x: 54, y: 28 },
  { x: 73, y: 24 },
  { x: 90, y: 16 },
];
export function Worlds({
  next,

  progress,
  onPlay,
}: {
  next: number;
  stars: number;
  progress: Progress[];
  onPlay: (index: number) => void;
}) {
  const chooser = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(next);
  const [section, setSection] = useState(Math.floor(next / 10));
  const world = Math.floor(section / 2),
    offset = world * 20;
  const worldProgress = progress.slice(offset, offset + 20);
  const cleared = worldProgress.filter((p) => p.cleared).length;
  const stars = worldProgress.reduce((n, p) => n + p.stars, 0);
  const title = worldNames[world];
  return (
    <>
      <header className="valley-heading" data-world={world + 1}>
        <span className="valley-kicker">
          WORLD {String(world + 1).padStart(2, "0")}
        </span>
        <h1>{title}</h1>
        <div className="valley-progress">
          <span>
            {cleared === worldProgress.length
              ? world
                ? `${title} complete`
                : "Valley complete"
              : `${cleared} / ${worldProgress.length} cleared`}
          </span>
          <span
            className="valley-stars"
            aria-label={`${stars} of ${worldProgress.length * 3} stars`}
          >
            <Star /> {stars}
            <span> / {worldProgress.length * 3}</span>
          </span>
        </div>
      </header>
      <div className="valley-map-scroll" aria-label={`${title} scenery`}>
        <section
          className="valley-map"
          data-world={world + 1}
          aria-label={`${title} level map`}
        >
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
          {progress
            .slice(section * 10, section * 10 + 10)
            .map((p, localIndex) => {
              const i = section * 10 + localIndex;
              return (
                <button
                  key={i}
                  className={`valley-stop ${p.cleared ? "is-cleared" : ""} ${selected === i ? "is-selected" : ""}`}
                  style={
                    {
                      "--x": `${(world >= 3 ? amberStops : world === 2 ? frostStops : world ? coveStops : stops)[localIndex].x}%`,
                      "--y": `${(world >= 3 ? amberStops : world === 2 ? frostStops : world ? coveStops : stops)[localIndex].y}%`,
                      "--wide-x": `${coveWideStops[localIndex].x}%`,
                      "--wide-y": `${coveWideStops[localIndex].y}%`,
                    } as CSSProperties
                  }
                  disabled={!p.available}
                  aria-label={`Play level ${i + 1}: ${levelNames[i]}`}
                  aria-pressed={selected === i}
                  aria-describedby={`valley-state-${i}`}
                  onClick={() => onPlay(i)}
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
                          {[1, 2, 3].map((n) => (
                            <Star key={n} earned={n <= p.stars} />
                          ))}
                        </span>
                        <span className="sr-only">{p.stars} stars earned</span>
                      </>
                    ) : (
                      <span>{selected === i ? "PLAY" : "Ready"}</span>
                    )}
                  </span>
                </button>
              );
            })}
          <div className="valley-discovery" aria-hidden="true">
            <GameArt kind="trophy" />
            <span>
              {cleared === worldProgress.length
                ? "Beautifully done"
                : "A little further"}
            </span>
          </div>
        </section>
      </div>
      <section className="valley-launch" aria-label="Selected level">
        <div className="world-map-toolbar">
          <button
            className="worlds-chooser-button"
            aria-label="Choose world"
            onClick={() => chooser.current?.showModal()}
            aria-haspopup="dialog"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" />
            </svg>{" "}
            Worlds
          </button>
          <div className="map-pager" aria-label="Map section">
            <button
              aria-label="Previous levels"
              disabled={section === world * 2}
              onClick={() => {
                setSection(section - 1);
                setSelected((section - 1) * 10);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14 5-7 7 7 7" />
              </svg>
            </button>
            <span aria-live="polite">
              Levels {section * 10 + 1}–{section * 10 + 10}
            </span>
            <button
              aria-label="Next levels"
              disabled={section === world * 2 + 1}
              onClick={() => {
                setSection(section + 1);
                setSelected((section + 1) * 10);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m10 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
        <div className="valley-selection">
          <span>LEVEL {String(selected + 1).padStart(2, "0")}</span>
          <h2>{levelNames[selected]}</h2>
        </div>
        <button
          className="primary-button valley-play"
          disabled={!progress[selected].available}
          onClick={() => onPlay(selected)}
        >
          <span aria-hidden="true">▶</span>{" "}
          {progress[selected].cleared ? "Replay" : "Play"} {selected + 1}
        </button>
      </section>
      <dialog
        ref={chooser}
        className="worlds-dialog"
        aria-labelledby="worlds-dialog-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) chooser.current?.close();
        }}
      >
        <div className="worlds-dialog-heading">
          <div>
            <span>YOUR ADVENTURE</span>
            <h2 id="worlds-dialog-title">Choose a world</h2>
          </div>
          <button
            aria-label="Close worlds"
            onClick={() => chooser.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="world-name-list">
          {worldNames.map((name, w) => {
            const placeholder = w >= worldNames.length;
            const locked = placeholder || !progress[w * 20]?.available;
            return (
              <button
                key={w}
                className={"world-name-row" + (locked ? " is-locked" : "")}
                aria-current={world === w ? "true" : undefined}
                disabled={locked}
                aria-label={
                  locked
                    ? name +
                      (placeholder
                        ? " — coming soon, locked"
                        : ` — complete ${worldNames[w - 1]} to unlock`)
                    : "Explore " + name
                }
                onClick={() => {
                  const first = progress.findIndex(
                    (p, i) =>
                      i >= w * 20 &&
                      i < w * 20 + 20 &&
                      p.available &&
                      !p.cleared,
                  );
                  const target = first < 0 ? w * 20 : first;
                  setSelected(target);
                  setSection(Math.floor(target / 10));
                  chooser.current?.close();
                }}
              >
                <span>{name}</span>
                {locked ? (
                  <svg
                    className="world-row-lock"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z" />
                    <circle cx="12" cy="15" r="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={world === w ? "m5 12 4 4L19 6" : "m9 5 7 7-7 7"} />
                  </svg>
                )}
                {placeholder && <span className="sr-only">Coming soon</span>}
              </button>
            );
          })}
        </div>
      </dialog>
    </>
  );
}
