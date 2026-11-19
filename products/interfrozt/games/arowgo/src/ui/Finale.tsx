import { useEffect, useRef } from "react";
import { Star } from "./elements/Star";
import { GameArt } from "./elements/GameArt";
import { levelNames } from "../domain/campaign";

export function Finale({
  world = "bloom",
  onContinue,
  scores,
  onReplay,
  onWorlds,
}: {
  world?: "bloom" | "cove" | "frost" | "amber";
  onContinue?: () => void;
  scores: number[];
  onReplay: (index: number) => void;
  onWorlds: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const total = scores.reduce((sum, score) => sum + score, 0);
  const target = scores.indexOf(Math.min(...scores));
  const mastered = total === scores.length * 3;
  return (
    <section
      className="campaign-finale glass-panel"
      aria-labelledby="finale-title"
    >
      <span className="eyebrow">
        {world === "bloom" ? "WORLD 01 · COMPLETE" : "ALL WORLDS · COMPLETE"}
      </span>
      <GameArt kind="trophy" />
      <h1 id="finale-title" ref={title} tabIndex={-1}>
        {world === "bloom"
          ? "Bloom Valley cleared!"
          : world === "amber"
            ? "Amber Dunes cleared!"
            : world === "frost"
              ? "Frostfall Peaks cleared!"
              : "Verdant Cove cleared!"}
      </h1>
      <p>Every path discovered. All {scores.length} levels complete.</p>
      <div
        className="finale-score"
        aria-label={`${total} of ${scores.length * 3} stars`}
      >
        <Star />
        <strong>
          {total}
          <small> / {scores.length * 3}</small>
        </strong>
      </div>
      <div className="finale-goal">
        <h2>{mastered ? "Perfect constellation" : "Your next challenge"}</h2>
        <p>
          {mastered
            ? "Every star is yours. Enjoy another run, or revisit your favourite puzzle."
            : `Find your missing stars. Start with Level ${target + 1}: ${levelNames[target]}.`}
        </p>
        {!mastered && (
          <span>Finish · Zero mistakes · Beat the time target</span>
        )}
      </div>
      <button
        className="primary-button"
        onClick={() => onReplay(mastered ? 0 : target)}
      >
        {mastered ? "Replay from Level 1" : `Improve Level ${target + 1}`}
      </button>
      {onContinue && (
        <button className="primary-button" onClick={onContinue}>
          Explore Verdant Cove →
        </button>
      )}
      <button className="text-button" onClick={onWorlds}>
        Choose a level
      </button>
      <p className="finale-note">
        Best stars stay saved. Coins are awarded only on each level’s first
        clear; replays do not add coins.
      </p>
    </section>
  );
}
