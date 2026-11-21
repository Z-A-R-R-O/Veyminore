import type { rateDifficulty } from "../domain/difficultyRating";
type Rating = ReturnType<typeof rateDifficulty>;
export function DifficultyCard({
  rating,
}: {
  rating?: Omit<Rating, "status"> & { status: string };
}) {
  if (!rating)
    return (
      <p role="status">Difficulty not measured for this content version.</p>
    );
  return (
    <details className="dev-difficulty">
      <summary>
        Difficulty <strong>{rating.score}</strong> / 1000
      </summary>
      <p>
        Structural rating v{rating.version}. Exact board analysis; not a human
        difficulty or IQ score.
      </p>
      <dl>
        <dt>Arrows / occupied cells</dt>
        <dd>
          {rating.arrows} / {rating.occupiedCells} of {rating.cells}
        </dd>
        <dt>Dependency depth</dt>
        <dd>{rating.dependencyDepth}</dd>
        <dt>Failure horizon</dt>
        <dd>{rating.failureHorizon} removals</dd>
        <dt>Opening legal / winning / losing</dt>
        <dd>
          {rating.openingLegal} / {rating.openingWinning} /{" "}
          {rating.openingLosing}
        </dd>
        <dt>Minimum structural countdown slack</dt>
        <dd>{rating.minimumSlack ?? "No countdown"}</dd>
        <dt>Random legal-play win rate</dt>
        <dd>{(rating.randomLegalWinRate * 100).toPrecision(3)}%</dd>
      </dl>
      <p>
        Failure horizon measures how long the earliest witnessed losing choice
        can survive. It is a proxy for delayed consequences, not proven required
        lookahead. Slack ignores ice/phase scheduling.
      </p>
      <p>
        Points: risk {rating.contributions.risk}; horizon{" "}
        {rating.contributions.horizon}; dependencies{" "}
        {rating.contributions.dependency}; timing {rating.contributions.timing};
        density {rating.contributions.density}.
      </p>
    </details>
  );
}
