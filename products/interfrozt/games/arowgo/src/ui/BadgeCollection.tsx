import { useState } from "react";
import { badges, badgeProgress, type BadgeStats } from "../storage/badges";
export function BadgeCollection({ stats }: { stats: BadgeStats }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(badges[0]);
  const state = badgeProgress(selected, stats);
  return (
    <section className="badge-collection" aria-label="Achievement badges">
      <div className="player-section-title">
        <h2>Your badges</h2>
        <span>
          {badges.filter((b) => badgeProgress(b, stats).earned).length} / 30
          earned
        </span>
      </div>
      <div className="badge-grid">
        {badges.slice(page * 6, page * 6 + 6).map((b) => {
          const p = badgeProgress(b, stats);
          return (
            <button
              key={b.id}
              aria-label={b.name}
              aria-pressed={selected.id === b.id}
              data-earned={p.earned}
              onClick={() => setSelected(b)}
            >
              <img src={b.src} alt="" draggable={false} />
              <strong>{b.name}</strong>
              <small>
                {p.earned ? "Earned" : p.available ? "Locked" : "Coming soon"}
              </small>
            </button>
          );
        })}
      </div>
      <div className="badge-detail" aria-live="polite">
        <strong>{selected.name}</strong>
        <p>{selected.requirement}</p>
        <small>
          {state.earned
            ? "Achievement earned"
            : state.available
              ? `${state.current} / ${selected.target}`
              : "Tracking coming soon — not awarded yet"}
        </small>
      </div>
      <div className="player-pagination">
        <button
          aria-label="Previous badges"
          disabled={page === 0}
          onClick={() => {
            setPage(page - 1);
            setSelected(badges[(page - 1) * 6]);
          }}
        >
          ←
        </button>
        <span>{page + 1} / 5</span>
        <button
          aria-label="Next badges"
          disabled={page === 4}
          onClick={() => {
            setPage(page + 1);
            setSelected(badges[(page + 1) * 6]);
          }}
        >
          →
        </button>
      </div>
    </section>
  );
}
