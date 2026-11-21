import { beforeDensityLevels } from "../domain/campaignBeforeDensity";
import { beforeHardeningLevels } from "../domain/campaignBeforeHardening";
import { AvatarArt } from "./elements/AvatarArt";
import {
  hasBoostReceipt,
  gameStorage,
  economyOwner,
  economyState,
  economyMessage,
  subscribeEconomy,
  accountProfile,
  walletAction,
  timeBoost,
  flushCompletions,
  equipSkin,
  updateAppearance,
} from "../account/economy-runtime";
import { beforeTimingLevels } from "../domain/campaignBeforeTiming";
import { beforePlanningLevels } from "../domain/campaignBeforePlanning";
import { beforeChallengeLevels } from "../domain/campaignBeforeChallenge";
import { CoveLesson } from "./CoveLesson";
import { useEffect, useState, useSyncExternalStore } from "react";
import { App } from "./App";
import { SnakeTutorial } from "./SnakeTutorial";
import { MechanicPreview } from "./MechanicPreview";
import { keyLesson, previousKeyLesson } from "../domain/keyLesson";
import { Finale } from "./Finale";
import { Worlds } from "./Worlds";
import { Home } from "./Home";
import { Shop } from "./Shop";
import { Controller } from "../application/controller";
import { SaveStore, SAVE_KEY } from "../storage/save";
import { levels } from "../domain/campaign";
import { levels as legacyLevels } from "../domain/legacyCampaign";
import { previousGeneratedLevels } from "../domain/campaignV2";
import { previousPlainLevels } from "../domain/campaignV3";
import { previousMildLevels } from "../domain/campaignV5";
import { beforeSnakeLevels } from "../domain/campaignBeforeSnake";
import { Scenery } from "./Scenery";
import { Icon, type IconName } from "./Icons";
import { GameArt } from "./elements/GameArt";
import { Coin } from "./elements/Rewards";
import { Gem } from "./elements/Gem";
import { claimGemGift, buyTimeBoost } from "../storage/profile";
import { ProfilePage } from "./ProfilePage";
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
import { SoundSetting } from "./Sound";
const store = {
  getItem: (key: string) => gameStorage.getItem(key),
  setItem: (key: string, value: string) => gameStorage.setItem(key, value),
};
const controllers = levels.map(
  (level, i) =>
    new Controller(
      level,
      new SaveStore(
        store,
        level,
        i === 0 ? SAVE_KEY : `arowgo.level.${level.levelId}.v1`,
        [
          ...beforeDensityLevels.filter((p) => p.levelId === level.levelId),
          ...beforeHardeningLevels.filter((p) => p.levelId === level.levelId),
          ...beforeTimingLevels.filter((p) => p.levelId === level.levelId),
          ...(beforePlanningLevels[i] ? [beforePlanningLevels[i]] : []),
          ...(beforeChallengeLevels[i] ? [beforeChallengeLevels[i]] : []),
          ...(beforeSnakeLevels[i] ? [beforeSnakeLevels[i]] : []),
          ...previousMildLevels.filter(
            (previous) => previous.levelId === level.levelId,
          ),
          ...(i >= 10
            ? previousPlainLevels.filter(
                (previous) => previous.levelId === level.levelId,
              )
            : i < 5
              ? [legacyLevels[i]]
              : [legacyLevels[i], previousGeneratedLevels[i - 5]]),
        ],
      ),
    ),
);
const lessonController = new Controller(
  keyLesson,
  new SaveStore(store, keyLesson, "arowgo.lesson.keys.v1", previousKeyLesson),
);
const tabs: { id: string; name: string; icon: IconName }[] = [
  { id: "home", name: "Home", icon: "home" },
  { id: "worlds", name: "Worlds", icon: "leaf" },
  { id: "modes", name: "Modes", icon: "gamepad" },
  { id: "shop", name: "Shop", icon: "shop" },
  { id: "profile", name: "Profile", icon: "profile" },
];
export function Prototype() {
  const [coveLessons, setCoveLessons] = useState<string[]>(() => {
    try {
      return ["anchors", "kegs"].filter(
        (k) => localStorage.getItem("arowgo.lesson." + k) === "seen",
      );
    } catch {
      return [];
    }
  });
  const [keysSeen, setKeysSeen] = useState(() => {
    try {
      return localStorage.getItem("arowgo.tutorial.keys.v1") === "seen";
    } catch {
      return false;
    }
  });
  const [route, setRoute] = useState(() => location.hash.slice(1) || "home");
  const [, refresh] = useState(0);
  const motion = useMotion();
  const [localProfile, setProfile] = useState(() => {
    try {
      return readProfile(gameStorage.getItem(PROFILE_KEY));
    } catch {
      return guest();
    }
  });
  const remote = useSyncExternalStore(subscribeEconomy, economyState);
  const walletMessage = useSyncExternalStore(subscribeEconomy, economyMessage);
  const profile = accountProfile(localProfile);
  const [profileNotice, setProfileNotice] = useState("");
  useEffect(() => {
    for (const c of controllers)
      if (
        profile.timeBoosts.includes(c.state.attemptId) ||
        hasBoostReceipt(c.state)
      )
        c.applyTimeBoost();
  }, [profile]);
  function saveProfile(next: Profile) {
    try {
      gameStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      setProfile(next);
      setProfileNotice("");
      if (economyOwner()) {
        void updateAppearance({
          avatar: next.avatar,
          frame: next.avatarFrame,
          name: next.name,
        });
      }
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
  const coins =
    remote?.wallet?.coins ?? Math.max(0, earnedCoins - spentCoins(profile));
  useEffect(() => {
    if (!economyOwner()) return;
    const sync = () => {
      void flushCompletions(controllers.map((c) => c.state));
    };
    window.addEventListener("online", sync);
    window.addEventListener("arowgo-level-saved", sync);
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("arowgo-level-saved", sync);
    };
  }, []);
  const stars = controllers.reduce((v, c) => v + c.state.bestStars, 0);
  const completed = controllers.filter((c) => c.state.claimed).length;
  const available = (i: number) => i === 0 || controllers[i - 1].state.claimed;
  const next = Math.min(
    controllers.findIndex((c) => !c.state.claimed) === -1
      ? controllers.length - 1
      : controllers.findIndex((c) => !c.state.claimed),
    controllers.length - 1,
  );
  function play(i: number, replay = false, mode?: "story" | "practice") {
    if (!available(i)) return;
    if (
      replay ||
      controllers[i].state.status !== "playing" ||
      (mode && controllers[i].state.mode !== mode)
    )
      controllers[i].restart(mode ?? "story");
    let learned = false;
    try {
      learned = localStorage.getItem("arowgo.tutorial.snake.v2") === "seen";
    } catch {}
    go(learned ? `play/${i + 1}` : `learn/snake/${i + 1}`);
  }
  if (route.startsWith("learn/snake/"))
    return (
      <SnakeTutorial
        onBack={() => go("home")}
        onDone={() => {
          try {
            localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
          } catch {}
          const target = Number(route.split("/")[2]);
          go(
            target >= 1 && target <= levels.length && available(target - 1)
              ? `play/${target}`
              : "home",
          );
        }}
      />
    );
  const match = /^play\/(\d+)$/.exec(route);
  if (route === "preview/keys")
    return (
      <MechanicPreview
        onStart={() => {
          lessonController.restart("practice");
          go("learn/keys");
        }}
        onBack={() => go("modes")}
      />
    );
  if (route === "learn/keys") {
    if (lessonController.state.mode !== "practice")
      lessonController.restart("practice");
    return (
      <App
        controller={lessonController}
        lesson
        economyNotice={economyOwner() ? walletMessage : undefined}
        skin={profile.equipped}
        otherCoins={coins}
        onHome={() => go("modes")}
        onNext={() => go("modes")}
      />
    );
  }
  const requested = match ? Number(match[1]) - 1 : -1;
  if (
    match &&
    requested >= 0 &&
    requested < controllers.length &&
    available(requested)
  ) {
    const i = requested;
    const mechanic =
      levels[i].arrows.some((a) => a.deadline !== undefined) &&
      !coveLessons.includes("kegs")
        ? "kegs"
        : levels[i].arrows.some((a) => a.anchorRequires) &&
            !coveLessons.includes("anchors")
          ? "anchors"
          : null;
    if (mechanic)
      return (
        <CoveLesson
          key={mechanic}
          kind={mechanic}
          onBack={() => go("worlds")}
          onDone={() => {
            try {
              localStorage.setItem("arowgo.lesson." + mechanic, "seen");
            } catch {}
            setCoveLessons((v) => [...v, mechanic]);
          }}
        />
      );
    if (!keysSeen && levels[i].arrows.some((arrow) => arrow.requires))
      return (
        <MechanicPreview
          startLabel={`Play Level ${i + 1}`}
          onBack={() => go("worlds")}
          onStart={() => {
            try {
              localStorage.setItem("arowgo.tutorial.keys.v1", "seen");
            } catch {
              /* Remember for this visit when storage is unavailable. */
            }
            setKeysSeen(true);
          }}
        />
      );
    return (
      <App
        key={i}
        controller={controllers[i]}
        levelNumber={i + 1}
        gems={profile.gems}
        onTimeBoost={async () => {
          const c = controllers[i];
          if (
            c.state.status !== "playing" ||
            c.state.mode !== "story" ||
            c.state.scoringVersion !== 2 ||
            c.state.timeBoost
          )
            return false;
          if (economyOwner()) {
            try {
              if (await timeBoost(c.state)) {
                c.applyTimeBoost();
                return true;
              }
            } catch {}
            return false;
          }
          const updated = buyTimeBoost(profile, c.state.attemptId);
          if (updated === profile || !saveProfile(updated)) return false;
          c.applyTimeBoost();
          return true;
        }}
        economyNotice={economyOwner() ? walletMessage : undefined}
        skin={profile.equipped}
        otherCoins={coins - controllers[i].state.coins}
        onHome={() => go("home")}
        onNext={() => {
          if (!controllers[i].state.claimed) return;
          if (i === 19) go("finale/bloom");
          else if (i < controllers.length - 1) play(i + 1);
          else go("finale");
        }}
      />
    );
  }
  const page =
    route === "finale/bloom" &&
    controllers.slice(0, 20).every((c) => c.state.claimed)
      ? "finale"
      : route === "progress" || route === "profile/edit"
        ? "profile"
        : (route === "finale" && completed === levels.length) ||
            route === "settings" ||
            tabs.some((t) => t.id === route)
          ? route
          : "home";
  return (
    <div
      className={`hub-shell ${page === "worlds" ? "worlds-screen" : ""}`}
      data-paused={motion.hidden}
      data-motion={motion.reduced ? "reduced" : "full"}
      data-effects={motion.rich ? "rich" : "subtle"}
    >
      <Scenery
        rich={motion.rich}
        amber={next >= 60 && page !== "worlds" && route !== "finale/bloom"}
        frost={next >= 40 && page !== "worlds" && route !== "finale/bloom"}
        cove={next >= 20 && page !== "worlds" && route !== "finale/bloom"}
      />
      <header className="hub-header">
        <a
          href="#profile"
          className="header-profile-link"
          aria-label={`Player profile: ${profile.name}`}
          title="Player profile"
          onClick={(e) => {
            e.preventDefault();
            go("profile");
          }}
        >
          <span className="header-profile-avatar">
            <AvatarArt
              avatar={profile.avatar}
              background={profile.avatarBackground}
              frame={profile.avatarFrame}
            />
          </span>
          <span className="header-profile-name">{profile.name}</span>
        </a>
        <div className="hub-coins" aria-label={`${coins} total coins`}>
          <Coin />
          <strong>{coins}</strong>
        </div>
        <div className="hub-gems" aria-label={`${profile.gems} total gems`}>
          <Gem />
          <strong>{profile.gems}</strong>
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
      {profileNotice && (
        <div className="storage-toast" role="alert">
          {profileNotice}
          <button
            aria-label="Dismiss storage notice"
            onClick={() => setProfileNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <main
        className={`hub-content page-${page} ${page === "profile" ? "page-progress" : ""}`}
        key={page}
      >
        {page === "finale" && (
          <Finale
            scores={(route === "finale/bloom"
              ? controllers.slice(0, 20)
              : controllers
            ).map((c) => c.state.bestStars)}
            world={route === "finale/bloom" ? "bloom" : "sanctum"}
            onContinue={route === "finale/bloom" ? () => play(20) : undefined}
            onReplay={(i) => play(i, true, "story")}
            onWorlds={() => go("worlds")}
          />
        )}
        {page === "home" && (
          <Home
            completed={completed}
            stars={stars}
            next={next}
            name={profile.name}
            onPlay={() =>
              completed === levels.length ? go("finale") : play(next)
            }
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
                <p>{levels.length} levels. Three hearts.</p>
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
            <section
              className="mode-card multiplayer-card glass-panel"
              aria-label="Multiplayer coming soon"
            >
              <span className="mode-art">
                <img src="/assets/multiplayer-mode.webp" alt="" />
              </span>
              <div>
                <span className="eyebrow">A NEW WAY TO PLAY</span>
                <h2>Multiplayer</h2>
                <p>A shared puzzle adventure is on the horizon.</p>
                <span className="mode-coming-soon">Coming soon</span>
              </div>
            </section>
            <div className="mechanic-lessons">
              <button
                className="text-button key-lesson-link"
                onClick={() => {
                  lessonController.restart("practice");
                  go("preview/keys");
                }}
              >
                Learn keys & locks
              </button>
              <button
                className="text-button"
                onClick={() => go("learn/snake/1")}
              >
                Learn snake movement
              </button>
            </div>
          </>
        )}
        {page === "shop" && (
          <Shop
            profile={profile}
            coins={coins}
            onClaimGems={async () => {
              if (economyOwner()) {
                try {
                  await walletAction({ action: "gift" });
                  return true;
                } catch {
                  return false;
                }
              }
              const updated = claimGemGift(profile);
              return updated !== profile && saveProfile(updated);
            }}
            onOpen={async (id, welcome, currency) => {
              if (economyOwner()) {
                try {
                  const r = await walletAction({
                    action: "chest",
                    crateId: id,
                    welcome,
                    currency,
                  });
                  return r.reward;
                } catch {
                  return null;
                }
              }
              const updated = openCrate(
                profile,
                id,
                earnedCoins,
                randomUnit(),
                randomUnit(),
                welcome,
                currency,
              );
              return updated !== profile && saveProfile(updated)
                ? updated.lastReward
                : null;
            }}
            onEquip={async (id) => {
              if (economyOwner()) return equipSkin(id);
              return (
                profile.owned.includes(id) &&
                saveProfile({ ...profile, equipped: id })
              );
            }}
          />
        )}
        {page === "profile" && (
          <ProfilePage
            key={route}
            profile={profile}
            onSave={saveProfile}
            completed={completed}
            stars={stars}
            total={levels.length}
            perfect={controllers.filter((c) => c.state.bestStars === 3).length}
            bloom={
              controllers.slice(0, 20).filter((c) => c.state.bestStars > 0)
                .length
            }
            cove={
              controllers.slice(20, 40).filter((c) => c.state.bestStars > 0)
                .length
            }
            onNavigate={go}
          />
        )}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <span className="eyebrow">YOUR QUIET CORNER</span>
              <h1>Make it yours.</h1>
            </div>
            <section className="settings-profile-row glass-panel">
              <div className="settings-profile-avatar">
                <AvatarArt
                  avatar={profile.avatar}
                  frame={profile.avatarFrame}
                />
              </div>
              <div>
                <strong>{profile.name}</strong>
                <small>Your profile</small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Edit profile"
                title="Edit profile"
                onClick={() => go("profile/edit")}
              >
                <svg
                  width="22"
                  height="22"
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
              </button>
            </section>
            <section className="settings-panel glass-panel">
              <SoundSetting />
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
                Tap an arrow when the path straight ahead of its head is clear.
                Its body follows like a snake. Clear every path to win.
              </p>
              <p>
                Story gives you three hearts. Practice lets you explore without
                limits. Earn stars for completion, zero mistakes and the time
                target. Hint and Erase are free.
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
