import { ProfileIcon } from "./elements/ProfileIcon";
import { BadgeCollection } from "./BadgeCollection";
import { AvatarArt } from "./elements/AvatarArt";
import { useEffect, useState } from "react";
import { ProfileEditor } from "./ProfileShop";
import { ArrowPreview } from "./Shop";
import { skins, type Profile } from "../storage/profile";
import "./profile.css";
import { ProfileAccount } from "./ProfileAccount";
import { WebAccountApi } from "../account/web-api";
import { developmentAccountConfig } from "../account/development-config";
import type { AccountIdentity } from "../account/contracts";

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
  const isAccountEnabled =
    import.meta.env.DEV &&
    (location.origin === developmentAccountConfig.webOrigin ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");
  const [account, setAccount] = useState<AccountIdentity | null>(null);

  useEffect(() => {
    let alive = true;
    if (isAccountEnabled) {
      new WebAccountApi(true)
        .session()
        .then((s) => {
          if (alive) setAccount(s.account);
        })
        .catch(() => {});
    }
    const onFocus = () => {
      if (isAccountEnabled) {
        new WebAccountApi(true)
          .session()
          .then((s) => {
            if (alive) setAccount(s.account);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [isAccountEnabled]);

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
              <ProfileIcon kind="pencil" />
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
        <button
          className="player-local"
          title="Account & saves"
          aria-label="Account & saves"
          onClick={() => setTab("account")}
        >
          <ProfileIcon kind="account" /> Account & saves{" "}
          <span aria-hidden="true">↗</span>
        </button>
      </header>
      <section className="profile-links-bar" aria-label="Account and link options">
        {account ? (
          <div className="profile-link-card is-connected">
            <span className="profile-link-icon google-mark">
              <img
                src="/assets/google-signin.svg"
                width="20"
                height="20"
                alt=""
              />
            </span>
            <div className="profile-link-info">
              <span className="profile-link-title">Google Account</span>
              <span className="profile-link-status">
                <span className="status-dot" aria-hidden="true" />
                Connected ({account.id.slice(0, 8)}…)
              </span>
            </div>
            <button
              type="button"
              className="profile-link-action"
              onClick={() => {
                setTab("account");
                setNotice("");
              }}
              aria-label="Manage Google Account"
            >
              Manage
            </button>
          </div>
        ) : (
          <a
            className="profile-link-card google-link"
            href="/account-test.html"
            aria-label="Connect Google Account"
          >
            <span className="profile-link-icon google-mark">
              <img
                src="/assets/google-signin.svg"
                width="20"
                height="20"
                alt=""
              />
            </span>
            <div className="profile-link-info">
              <span className="profile-link-title">Google Account</span>
              <span className="profile-link-desc">Sign in to sync & backup</span>
            </div>
            <span className="profile-link-badge">Connect</span>
          </a>
        )}

        <a
          className="profile-link-card cloud-link"
          href="/cloud-save.html"
          aria-label="Cloud Save & Snapshots"
        >
          <span className="profile-link-icon">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
          </span>
          <div className="profile-link-info">
            <span className="profile-link-title">Cloud Save</span>
            <span className="profile-link-desc">Snapshot backup</span>
          </div>
          <span className="profile-link-badge">Open ↗</span>
        </a>

        <a
          className="profile-link-card device-link"
          href="/economy.html"
          aria-label="Device Link and Recovery"
        >
          <span className="profile-link-icon">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="3" />
              <path d="M2 10h20M7 15h2" />
            </svg>
          </span>
          <div className="profile-link-info">
            <span className="profile-link-title">Device Link</span>
            <span className="profile-link-desc">Wallet & recovery</span>
          </div>
          <span className="profile-link-badge">Sync ↗</span>
        </a>
      </section>
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
                  <ProfileIcon kind="levels" />
                </span>
                <strong>
                  {completed}
                  <small>/{total}</small>
                </strong>
                <span>Levels cleared</span>
              </div>
              <div>
                <span className="stat-symbol" aria-hidden="true">
                  <ProfileIcon kind="star" />
                </span>
                <strong>
                  {stars}
                  <small>/{total * 3}</small>
                </strong>
                <span>Stars earned</span>
              </div>
              <div>
                <span className="stat-symbol" aria-hidden="true">
                  <ProfileIcon kind="perfect" />
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
