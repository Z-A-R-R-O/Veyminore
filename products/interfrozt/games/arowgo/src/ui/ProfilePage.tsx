import { AvatarArt } from "./elements/AvatarArt";
import { useState } from "react";
import { ProfileEditor } from "./ProfileShop";
import { ArrowPreview } from "./Shop";
import { skins, type Profile } from "../storage/profile";
import "./profile.css";
import { ProfileAccount } from "./ProfileAccount";

export function ProfilePage({
  profile,
  onSave,
  completed,
  stars,
  total,
  perfect,
  onNavigate,
}: {
  profile: Profile;
  onSave: (p: Profile) => boolean;
  completed: number;
  stars: number;
  total: number;
  perfect: number;
  onNavigate: (path: string) => void;
}) {
  const [tab, setTab] = useState<"journey" | "collection" | "edit" | "account">(
    new URLSearchParams(location.search).get("account") === "1"
      ? "account"
      : "journey",
  );
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState("");
  const equipped = skins.find((s) => s.id === profile.equipped)!;
  const milestones = [
    { name: "First bloom", target: 1 },
    { name: "Pathfinder", target: 3 },
    { name: "Cove captain", target: total },
  ];
  const next = milestones.find((m) => completed < m.target);
  return (
    <section className="player-profile" aria-label="Player profile">
      <header className="player-card">
        <div className="player-avatar">
          <AvatarArt avatar={profile.avatar} />
        </div>
        <div className="player-name">
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>{profile.name}</h1>
          <p>
            {completed === total
              ? "Valley keeper"
              : completed >= 3
                ? "Pathfinder"
                : completed
                  ? "Explorer"
                  : "A new adventure"}
          </p>
        </div>
        <span className="player-local">Saved on this device</span>
      </header>
      <nav className="player-tabs" aria-label="Profile sections">
        {(["journey", "collection", "edit", "account"] as const).map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setNotice("");
            }}
          >
            {t === "journey"
              ? "Journey"
              : t === "collection"
                ? "Arrows"
                : t === "edit"
                  ? "Edit profile"
                  : "Account"}
          </button>
        ))}
      </nav>
      <div className="player-panel">
        {tab === "journey" && (
          <>
            <div className="player-stats">
              <div>
                <strong>
                  {completed}
                  <small>/{total}</small>
                </strong>
                <span>Levels cleared</span>
              </div>
              <div>
                <strong>
                  {stars}
                  <small>/{total * 3}</small>
                </strong>
                <span>Stars earned</span>
              </div>
              <div>
                <strong>{perfect}</strong>
                <span>3-star levels</span>
              </div>
            </div>
            <section className="player-progress">
              <div>
                <h2>Adventure progress</h2>
                <span>{Math.round((completed / total) * 100)}%</span>
              </div>
              <progress
                aria-label="Bloom Valley completion"
                value={completed}
                max={total}
              />
              <p>
                {next
                  ? `${Math.max(0, next.target - completed)} more ${next.target - completed === 1 ? "level" : "levels"} to ${next.name}`
                  : "All levels cleared. Keep collecting stars!"}
              </p>
            </section>
            <div className="player-badges" aria-label="Milestones">
              {milestones.map((m, i) => (
                <div key={m.name} data-earned={completed >= m.target}>
                  <span aria-hidden="true">
                    {i === 0 ? "✦" : i === 1 ? "➤" : "♛"}
                  </span>
                  <strong>{m.name}</strong>
                  <small>
                    {completed >= m.target
                      ? "Earned"
                      : `${completed}/${m.target} levels`}
                  </small>
                </div>
              ))}
            </div>
            <button
              className="player-equipped"
              onClick={() => setTab("collection")}
            >
              <ArrowPreview skin={equipped} />
              <span>
                <small>YOUR EQUIPPED ARROW</small>
                <strong>{equipped.name}</strong>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button
              className="primary-button player-action"
              onClick={() => onNavigate("worlds")}
            >
              {completed === total
                ? "Revisit your worlds"
                : "Continue your journey"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </>
        )}
        {tab === "collection" && (
          <>
            <div className="player-section-title">
              <h2>Your arrows</h2>
              <span>
                {profile.owned.length} / {skins.length} owned
              </span>
            </div>
            <div className="player-collection">
              {skins.slice(page * 4, page * 4 + 4).map((s) => {
                const owned = profile.owned.includes(s.id),
                  active = profile.equipped === s.id;
                return (
                  <button
                    key={s.id}
                    className="player-skin"
                    disabled={!owned}
                    aria-pressed={active}
                    aria-label={`${s.name}: ${active ? "equipped" : owned ? "equip" : "locked"}`}
                    onClick={() => {
                      setNotice(
                        onSave({ ...profile, equipped: s.id })
                          ? `${s.name} equipped.`
                          : "Could not save. Try again.",
                      );
                    }}
                  >
                    <ArrowPreview skin={s} />
                    <strong>{s.name}</strong>
                    <small>
                      {active
                        ? "✓ Equipped"
                        : owned
                          ? "Tap to equip"
                          : "Locked"}{" "}
                      · {s.rarity}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="player-pagination">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous arrows"
              >
                ←
              </button>
              <span>
                {page + 1} / {Math.ceil(skins.length / 4)}
              </span>
              <button
                disabled={(page + 1) * 4 >= skins.length}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next arrows"
              >
                →
              </button>
            </div>
            <button
              className="primary-button player-action"
              onClick={() => onNavigate("shop")}
            >
              Discover arrows in the shop →
            </button>
          </>
        )}
        {tab === "edit" && <ProfileEditor profile={profile} onSave={onSave} />}
        {tab === "account" && <ProfileAccount />}
      </div>
      {notice && (
        <p className="player-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
