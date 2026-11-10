import { useEffect, useState } from "react";
import { App } from "./App";
import { Controller } from "../application/controller";
import { SaveStore, SAVE_KEY } from "../storage/save";
import { levels, levelNames } from "../domain/campaign";
import { Scenery } from "./Scenery";
import { Icon, type IconName } from "./Icons";
import { Coin } from "./elements/Rewards";
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
  { id: "progress", name: "Progress", icon: "arrow" },
  { id: "settings", name: "Settings", icon: "settings" },
];
export function Prototype() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "home");
  const [, refresh] = useState(0);
  const motion = useMotion();
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
  const coins = controllers.reduce((v, c) => v + c.state.coins, 0);
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
  const page = tabs.some((t) => t.id === route) ? route : "home";
  return (
    <div
      className="hub-shell"
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
      </header>
      <main className={`hub-content page-${page}`} key={page}>
        {page === "home" && (
          <>
            <div className="home-intro home-hero">
              <span className="hero-sigil" aria-hidden="true">
                ➤
              </span>
              <h1>AROWGO</h1>
              <p>A little play. A clearer path.</p>
            </div>
            <section className="continue-card glass-panel">
              <div>
                <span className="eyebrow">
                  {completed === 5
                    ? "VALLEY COMPLETE"
                    : `LEVEL ${next + 1} · ${levelNames[next]}`}
                </span>
                <h2>
                  {completed === 5
                    ? "Beautifully done."
                    : "Your next little win."}
                </h2>
              </div>
              <button className="primary-button" onClick={() => play(next)}>
                {completed === 5 ? "Play again" : "Play"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </section>
            <div className="home-shortcuts">
              <button className="glass-panel" onClick={() => go("worlds")}>
                <span className="shortcut-art">✿</span>
                <strong>Worlds</strong>
              </button>
              <button className="glass-panel" onClick={() => go("modes")}>
                <span className="shortcut-art">
                  <Icon name="gamepad" />
                </span>
                <strong>Modes</strong>
              </button>
              <button className="glass-panel" onClick={() => go("progress")}>
                <span className="shortcut-art golden">★</span>
                <strong>My journey</strong>
              </button>
            </div>
            <button
              className="world-banner glass-panel"
              onClick={() => go("worlds")}
            >
              <span>
                <strong>Bloom Valley</strong>
                <small>{completed} of 5 levels cleared</small>
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            <div className="home-summary">
              <span>★ {stars} / 15 stars</span>
              <span>Made for a quiet moment.</span>
            </div>
          </>
        )}
        {page === "worlds" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">WORLD 01</span>
              <h1>Bloom Valley</h1>
              <p>Five moments of clarity.</p>
            </div>
            <div className="level-list world-map">
              <svg
                className="map-trail"
                viewBox="0 0 400 500"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M100 450 C100 390 300 400 300 350 S100 300 100 250 S300 200 300 150 S160 90 160 50" />
              </svg>
              {levels.map((l, i) => (
                <button
                  key={l.levelId}
                  className={`level-tile glass-panel ${available(i) ? "" : "locked"} ${i === next ? "current-level" : ""}`}
                  style={{ "--stop": i } as React.CSSProperties}
                  disabled={!available(i)}
                  onClick={() => play(i)}
                  aria-label={`Play level ${i + 1}: ${levelNames[i]}`}
                >
                  <span className="level-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{levelNames[i]}</strong>
                    <small>
                      {controllers[i].state.claimed
                        ? "★".repeat(controllers[i].state.bestStars)
                        : available(i)
                          ? `${l.arrows.length} paths`
                          : "Locked"}
                    </small>
                  </span>
                  <span aria-hidden="true">{available(i) ? "↗" : "·"}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {page === "modes" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">FIND YOUR FLOW</span>
              <h1>Choose your pace.</h1>
              <p>A challenge, or a little room to explore.</p>
            </div>
            <section className="mode-card story-card glass-panel">
              <span className="mode-art" aria-hidden="true">
                ⚑
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
              <span className="mode-art" aria-hidden="true">
                ∞
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
        {page === "progress" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">YOUR JOURNEY</span>
              <h1>Your little victories.</h1>
              <p>Every clear path is progress.</p>
            </div>
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
                <p>Coins earned</p>
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
