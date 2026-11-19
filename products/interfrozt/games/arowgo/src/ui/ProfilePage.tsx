import { BadgeCollection } from "./BadgeCollection";
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
  bloom,
  cove,
  onNavigate,
}: {
  profile: Profile;
  onSave: (p: Profile) => boolean;
  completed: number;
  stars: number;
  total: number;
  perfect: number;
  bloom: number;
  cove: number;
  onNavigate: (path: string) => void;
}) {
  const [tab, setTab] = useState<
    "journey" | "collection" | "edit" | "account" | "badges"
  >(
    location.hash === "#profile/edit"
      ? "edit"
      : new URLSearchParams(location.search).get("account") === "1"
        ? "account"
        : "journey",
  );
  const [notice, setNotice] = useState("");
  const equipped = skins.find((s) => s.id === profile.equipped)!;
  const milestones = [
    { name: "First bloom", target: 1 },
    { name: "Pathfinder", target: 10 },
    { name: "World wanderer", target: 40 },
  ];
  const next = milestones.find((m) => completed < m.target);
  return (
    <section
      className="player-profile"
      data-section={tab}
      aria-label="Player profile"
    >
      <header className="player-card">
        <div className="player-avatar">
          <AvatarArt
            avatar={profile.avatar}
            background={profile.avatarBackground}
            frame={profile.avatarFrame}
          />
          <button
            type="button"
            className="profile-pencil"
            aria-label="Edit portrait"
            title="Edit profile"
            onClick={() => {
              setTab("edit");
              setNotice("");
            }}
          >
            <span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z" />
              </svg>
            </span>
          </button>
        </div>
        <div className="player-name">
          <span className="eyebrow">YOUR PROFILE</span>
          <h1>{profile.name}</h1>
          <p>
            {completed === total
              ? "World explorer"
              : completed >= 3
                ? "Pathfinder"
                : completed
                  ? "Explorer"
                  : "A new adventure"}
          </p>
        </div>
        <button className="player-local" onClick={() => setTab("account")}>
          <span aria-hidden="true">◎</span> Account & saves{" "}
          <span aria-hidden="true">↗</span>
        </button>
      </header>
      <nav className="player-tabs" aria-label="Profile sections">
        {(["journey", "badges", "collection", "edit", "account"] as const).map(
          (t) => (
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
                    : t === "badges"
                      ? "Badges"
                      : "Account"}
            </button>
          ),
        )}
      </nav>
      <div className="player-panel" key={tab}>
        {tab === "journey" && (
          <>
            <div className="player-section-title journey-heading">
              <div>
                <span className="eyebrow">MAKE YOUR MARK</span>
                <h2>Your adventure</h2>
              </div>
              <span>
                {completed === total ? "Journey complete" : "Every move counts"}
              </span>
            </div>
            <div className="player-stats">
              <div>
                <span className="stat-symbol" aria-hidden="true">
                  ⚑
                </span>
                <strong>
                  {completed}
                  <small>/{total}</small>
                </strong>
                <span>Levels cleared</span>
              </div>
              <div>
                <span className="stat-symbol" aria-hidden="true">
                  ★
                </span>
                <strong>
                  {stars}
                  <small>/{total * 3}</small>
                </strong>
                <span>Stars earned</span>
              </div>
              <div>
                <span className="stat-symbol" aria-hidden="true">
                  ✦
                </span>
                <strong>{perfect}</strong>
                <span>3-star levels</span>
              </div>
            </div>
            <section className="player-progress">
              <div>
                <h2>Adventure progress</h2>
                <span>
                  {Math.round((completed / Math.max(1, total)) * 100)}%
                </span>
              </div>
              <progress
                aria-label="Campaign completion"
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
                  <img
                    src={`/assets/badges/badge-${["01", "03", "18"][i]}.webp`}
                    alt=""
                  />
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
              {skins.map((s) => {
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
        {tab === "badges" && (
          <BadgeCollection
            stats={{
              completed,
              stars,
              perfect,
              bloom,
              cove,
              owned: profile.owned.length,
              styled: profile.avatarFrame !== "none" ? 1 : 0,
            }}
          />
        )}
      </div>
      {notice && (
        <p className="player-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
