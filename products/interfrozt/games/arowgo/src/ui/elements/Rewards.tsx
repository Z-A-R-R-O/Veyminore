import { useEffect, useRef, useState } from "react";
import { Heart } from "../Icons";

/** Presentation only. The parent owns the authoritative balance. */
export function CountUp({
  value,
  animate = true,
  from,
  delay = 0,
  prefix = "",
}: {
  value: number;
  animate?: boolean;
  from?: number;
  delay?: number;
  prefix?: string;
}) {
  const previous = useRef(from ?? value);
  const [display, setDisplay] = useState(() =>
    animate && from !== undefined ? from : value,
  );
  useEffect(() => {
    const startValue = from ?? previous.current;
    previous.current = value;
    if (!animate || startValue === value) {
      setDisplay(value);
      return;
    }
    setDisplay(startValue);
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / 850));
      setDisplay(
        Math.round(startValue + (value - startValue) * (1 - (1 - t) ** 3)),
      );
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, animate, from, delay]);
  return (
    <span className="count-up">
      {prefix}
      {display}
    </span>
  );
}

export function Coin({ variant = "hud" }: { variant?: "hud" | "prize" }) {
  return (
    <span
      className={
        variant === "hud" ? "coin generated-coin" : "prize-coin generated-coin"
      }
      aria-hidden="true"
    >
      <span>✦</span>
    </span>
  );
}

/** Empty slot remains while two clipped halves gently separate and fade. */
export function HeartToken({
  filled,
  breaking = false,
}: {
  filled: boolean;
  breaking?: boolean;
}) {
  return (
    <span
      className={`heart-token ${breaking ? "is-breaking" : ""}`}
      aria-hidden="true"
    >
      {filled ? <span className="heart-art" /> : <Heart filled={false} />}
      {breaking && (
        <>
          <span className="heart-fragment left">
            <span className="heart-art" />
          </span>
          <span className="heart-fragment right">
            <span className="heart-art" />
          </span>
        </>
      )}
    </span>
  );
}

export function Encouragement({ kind }: { kind: "welcome" | "win" | "retry" }) {
  const copy = {
    welcome: "A little pause, a fresh perspective. Glad you’re here.",
    win: "A little win. A brighter day.",
    retry: "Take a breath. Try a new order.",
  };
  return (
    <p className={`encouragement encouragement-${kind}`}>
      <span aria-hidden="true">✧</span> {copy[kind]}
    </p>
  );
}
