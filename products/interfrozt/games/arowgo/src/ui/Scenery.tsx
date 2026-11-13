import type { CSSProperties } from "react";

export function Scenery({ rich }: { rich: boolean }) {
  return (
    <div className="scenery" aria-hidden="true">
      <picture>
        <source
          media="(max-width: 680px)"
          srcSet="./assets/bloom-valley-portrait.png"
        />
        <img
          src="./assets/bloom-valley-landscape.png"
          alt=""
          fetchPriority="high"
        />
      </picture>
      <div className="scenery-wash" />
      <div className="light-ray ray-one" />
      <div className="light-ray ray-two" />
      <div className="petals">
        {Array.from({ length: rich ? 14 : 5 }, (_, i) => (
          <i
            key={i}
            style={
              {
                "--x": `${(i * 37 + 7) % 100}%`,
                "--delay": `${-i * 2.7}s`,
                "--duration": `${16 + (i % 5) * 3}s`,
                "--size": `${8 + (i % 4) * 4}px`,
                "--drift": `${(i % 2 ? 1 : -1) * (35 + i * 9)}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      {rich && (
        <div className="fireflies">
          {Array.from({ length: 9 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 29 + 11) % 100}%`,
                top: `${(i * 19 + 20) % 100}%`,
                animationDelay: `${-i * 0.7}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="valley-mist" />
      {rich && (
        <div className="ambient-bloom">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
export function Celebration() {
  return (
    <div className="celebration" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--angle": `${(i * 360) / 22}deg`,
              "--travel": `${110 + (i % 5) * 27}px`,
              "--delay": `${(i % 4) * 0.05}s`,
            } as CSSProperties
          }
        >
          {i % 3 ? "✦" : "❀"}
        </i>
      ))}
    </div>
  );
}
