/** Decorative reward token; the parent supplies the accessible score. */
export function Star({ earned = true }: { earned?: boolean }) {
  return (
    <img
      className={`game-star ${earned ? "is-earned" : "is-empty"}`}
      src="/assets/results/star-gold.png"
      alt=""
      aria-hidden="true"
    />
  );
}
