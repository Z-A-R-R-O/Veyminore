import { useEffect, useState } from "react";
import { App } from "./App";
import { Worlds } from "./Worlds";
import { Home } from "./Home";
import { Shop } from "./Shop";
import { Controller } from "../application/controller";
import { SaveStore, SAVE_KEY } from "../storage/save";
import { levels } from "../domain/campaign";
import { Scenery } from "./Scenery";
import { Icon, type IconName } from "./Icons";
import { GameArt } from "./elements/GameArt";
import { Coin } from "./elements/Rewards";
import { ProfileEditor } from "./ProfileShop";
import {
  PROFILE_KEY,
  readProfile,
  guest,
  spentCoins,
  openCrate,
  randomUnit,
  type Profile,
} from "../storage/profile";
import { useMotion } from "./useMotion";
const store = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
const controllers = levels.map(
  (level, i) =>
    new Controller(
      level,
      new SaveStore(
        store,
        level,
        i === 0 ? SAVE_KEY : `arowgo.level.${level.levelId}.v1`,
      ),
    ),
);
const tabs: { id: string; name: string; icon: IconName }[] = [
  { id: "home", name: "Home", icon: "home" },
  { id: "worlds", name: "Worlds", icon: "leaf" },
  { id: "modes", name: "Modes", icon: "gamepad" },
  { id: "shop", name: "Shop", icon: "shop" },
  { id: "profile", name: "Profile", icon: "profile" },
];
export function Prototype() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "home");
  const [, refresh] = useState(0);
  const motion = useMotion();
  const [profile, setProfile] = useState(() => {
    try {
      return readProfile(localStorage.getItem(PROFILE_KEY));
    } catch {
      return guest();
    }
  });
  const [profileNotice, setProfileNotice] = useState("");
  function saveProfile(next: Profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      setProfile(next);
      setProfileNotice("");
      return true;
    } catch {
      setProfileNotice("Profile storage is unavailable. Purchases are paused.");
      return false;
    }
  }

  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1) || "home");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const unsub = controllers.map((c) =>
      c.subscribe(() => refresh((v) => v + 1)),
    );
    return () => unsub.forEach((fn) => fn());
  }, []);
  const go = (path: string) => {
    location.hash = path;
    setRoute(path);
  };
  const earnedCoins = controllers.reduce((v, c) => v + c.state.coins, 0);
  const coins = Math.max(0, earnedCoins - spentCoins(profile));
  const stars = controllers.reduce((v, c) => v + c.state.bestStars, 0);
  const completed = controllers.filter((c) => c.state.claimed).length;
  const available = (i: number) => i === 0 || controllers[i - 1].state.claimed;
  const next = Math.min(
    controllers.findIndex((c) => !c.state.claimed) === -1
      ? 4
      : controllers.findIndex((c) => !c.state.claimed),
    4,
  );
  function play(i: number, replay = false, mode?: "story" | "practice") {
    if (!available(i)) return;
    if (
      replay ||
      controllers[i].state.status !== "playing" ||
      (mode && controllers[i].state.mode !== mode)
    )
      controllers[i].restart(mode ?? "story");
    go(`play/${i + 1}`);
  }
  const match = /^play\/([1-5])$/.exec(route);
  if (match && available(Number(match[1]) - 1)) {
    const i = Number(match[1]) - 1;
    return (
      <App
        key={i}
        controller={controllers[i]}
        levelNumber={i + 1}
        skin={profile.equipped}
        otherCoins={coins - controllers[i].state.coins}
        onHome={() => go("home")}
        onNext={
          controllers[i].state.claimed
            ? () => (i < 4 ? play(i + 1) : go("worlds"))
            : undefined
        }
      />
    );
  }
  const page =
    route === "progress"
      ? "profile"
      : route === "settings" || tabs.some((t) => t.id === route)
        ? route
        : "home";
  return (
    <div
      className="hub-shell"
      data-paused={motion.hidden}
      data-motion={motion.reduced ? "reduced" : "full"}
      data-effects={motion.rich ? "rich" : "subtle"}
    >
      <Scenery rich={motion.rich} />
      <header className="hub-header">
        <a href="#home" className="wordmark">
          <span className="brand-icon">
            <Icon name="arrow" />
          </span>
          AROWGO
        </a>
        <div className="hub-coins" aria-label={`${coins} total coins`}>
          <Coin />
          <strong>{coins}</strong>
        </div>
        <a
          href="#settings"
          className="icon-button hub-settings"
          aria-label="Settings"
          aria-current={page === "settings" ? "page" : undefined}
        >
          <Icon name="settings" />
        </a>
      </header>
      <main
        className={`hub-content page-${page} ${page === "profile" ? "page-progress" : ""}`}
        key={page}
      >
        {page === "home" && (
          <Home
            completed={completed}
            stars={stars}
            next={next}
            name={profile.name}
            onPlay={() => play(next)}
            onNavigate={go}
          />
        )}
        {page === "worlds" && (
          <Worlds
            next={next}
            stars={stars}
            progress={controllers.map((c, i) => ({
              available: available(i),
              cleared: c.state.claimed,
              stars: c.state.bestStars,
            }))}
            onPlay={(i) => play(i)}
          />
        )}
        {page === "modes" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">FIND YOUR FLOW</span>
              <h1>Choose your pace.</h1>
              <p>A challenge, or a little room to explore.</p>
            </div>
            <section className="mode-card story-card glass-panel">
              <span className="mode-art">
                <GameArt kind="flag" />
              </span>
              <div>
                <span className="eyebrow">YOUR VALLEY JOURNEY</span>
                <h2>Story</h2>
                <p>Five levels. Three hearts.</p>
                <button
                  className="primary-button"
                  onClick={() => play(next, false, "story")}
                >
                  Continue Story <span aria-hidden="true">↗</span>
                </button>
              </div>
            </section>
            <section className="mode-card practice-card glass-panel">
              <span className="mode-art">
                <GameArt kind="infinity" />
              </span>
              <div>
                <span className="eyebrow">NO PRESSURE</span>
                <h2>Practice</h2>
                <p>Unlimited tries. No pressure.</p>
                <button
                  className="primary-button"
                  onClick={() => play(next, true, "practice")}
                >
                  Play Practice <span aria-hidden="true">↗</span>
                </button>
              </div>
            </section>
            <p className="hub-note">Take your time. There is no timer.</p>
          </>
        )}
        {page === "shop" && (
          <Shop
            profile={profile}
            coins={coins}
            onOpen={(id, welcome) => {
              const updated = openCrate(
                profile,
                id,
                earnedCoins,
                randomUnit(),
                randomUnit(),
                welcome,
              );
              return updated !== profile && saveProfile(updated)
                ? updated.lastReward
                : null;
            }}
            onEquip={(id) =>
              profile.owned.includes(id) &&
              saveProfile({ ...profile, equipped: id })
            }
          />
        )}
        {page === "profile" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">YOUR JOURNEY</span>
              <h1>Your profile</h1>
            </div>
            <ProfileEditor profile={profile} onSave={saveProfile} />
            {profileNotice && <p role="status">{profileNotice}</p>}
            <div className="progress-orbit">
              <strong>
                {completed}
                <small>/ 5</small>
              </strong>
              <span>levels cleared</span>
            </div>
            <div className="stat-grid">
              <section className="glass-panel">
                <span>★</span>
                <strong>{stars} / 15</strong>
                <p>Best stars</p>
              </section>
              <section className="glass-panel">
                <Coin />
                <strong>{coins}</strong>
                <p>Coins available</p>
              </section>
            </div>
            <div className="milestone-row" aria-label="Earned collection">
              {[
                { name: "First bloom", symbol: "✿", earned: completed > 0 },
                { name: "Pathfinder", symbol: "➤", earned: completed >= 3 },
                { name: "Valley keeper", symbol: "♛", earned: completed === 5 },
              ].map((b) => (
                <div
                  key={b.name}
                  className={`milestone glass-panel ${b.earned ? "earned" : ""}`}
                >
                  <span aria-hidden="true">{b.symbol}</span>
                  <strong>{b.name}</strong>
                  <small>
                    {b.earned
                      ? "Earned"
                      : b.name === "First bloom"
                        ? "Clear 1 level"
                        : b.name === "Pathfinder"
                          ? "Clear 3 levels"
                          : "Clear 5 levels"}
                  </small>
                </div>
              ))}
            </div>
            <p className="hub-note">
              First Story clear: 25 coins per level.
              <br />
              Practice is always free.
            </p>
          </>
        )}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">YOUR QUIET CORNER</span>
              <h1>Make it yours.</h1>
            </div>
            <section className="settings-panel glass-panel">
              <label className="setting">
                <span>
                  <strong>Reduce motion</strong>
                  <small>
                    {motion.systemReduced
                      ? "Your device has this enabled"
                      : "Gentler movement, fewer effects"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={motion.reduced}
                  disabled={motion.systemReduced}
                  onChange={(e) => motion.update({ reduced: e.target.checked })}
                />
              </label>
              <label className="setting">
                <span>
                  <strong>Visual effects</strong>
                  <small>A little sparkle, or keep it calm</small>
                </span>
                <select
                  value={motion.rich ? "rich" : "subtle"}
                  onChange={(e) =>
                    motion.update({ rich: e.target.value === "rich" })
                  }
                >
                  <option value="rich">Rich</option>
                  <option value="subtle">Subtle</option>
                </select>
              </label>
            </section>
            <section className="how-to glass-panel">
              <h2>A clear way out</h2>
              <p>
                Tap an arrow when its whole shape has room to leave. Clear every
                path to win.
              </p>
              <p>
                Story gives you three hearts. Practice lets you explore without
                limits. Hint and Erase are free; assisted clears earn one star.
              </p>
            </section>
            <p className="hub-note">
              AROWGO v0.1 · InterFrozt
              <br />
              Saved on this device. No account needed.
              <br />A little play. A little practice in thinking.
            </p>
          </>
        )}
      </main>
      <nav className="bottom-nav glass-panel" aria-label="Main navigation">
        {tabs.map((t) => (
          <a
            href={`#${t.id}`}
            key={t.id}
            aria-current={page === t.id ? "page" : undefined}
          >
            <Icon name={t.icon} />
            <span>{t.name}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
