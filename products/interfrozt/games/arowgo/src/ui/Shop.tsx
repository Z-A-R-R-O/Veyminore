import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  skins,
  crates,
  rarities,
  rollSkin,
  randomUnit,
  type Skin,
  type SkinId,
  type Profile,
  type CrateId,
  type Reward,
} from "../storage/profile";
import { useMotion } from "./useMotion";
import "./chests.css";
import { Gem } from "./elements/Gem";
import { gemPrices } from "../storage/profile";

export function ArrowPreview({ skin }: { skin: Skin }) {
  return (
    <svg
      className="collection-arrow"
      data-arrow-effect={skin.effect}
      style={{ "--arrow-color": skin.color } as CSSProperties}
      viewBox="0 0 120 80"
      aria-hidden="true"
    >
      <path className="preview-body" d="M18 62h24q9 0 9-9V33q0-10 10-10h33" />
      <path className="preview-light" d="M18 62h24q9 0 9-9V33q0-10 10-10h33" />
      <path className="preview-tip" d="m80 11 15 12-15 12" />
    </svg>
  );
}
function CrateArt({ kind }: { kind: CrateId }) {
  return (
    <img
      className={`crate-art crate-${kind}`}
      src="/assets/chests/treasure-chest.png"
      alt=""
      draggable={false}
    />
  );
}
function Odds({ id }: { id: CrateId }) {
  const crate = crates.find((c) => c.id === id)!;
  return (
    <div className="crate-odds" aria-label={`${crate.name} drop odds`}>
      {rarities.map((r, i) => (
        <span key={r} data-rarity={r}>
          <i />
          {r}
          <strong>{crate.odds[i]}%</strong>
        </span>
      ))}
    </div>
  );
}
export function Shop({
  profile,
  coins,
  onOpen,
  onEquip,
  onClaimGems,
}: {
  profile: Profile;
  coins: number;
  onClaimGems: () => boolean | Promise<boolean>;
  onOpen: (
    id: CrateId,
    welcome: boolean,
    currency: "coins" | "gems",
  ) => Reward | null | Promise<Reward | null>;
  onEquip: (id: SkinId) => boolean;
}) {
  const [tab, setTab] = useState<"crates" | "collection">("crates");
  const [selection, setSelection] = useState<{
    id: CrateId;
    welcome: boolean;
    currency: "coins" | "gems";
  } | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  const [phase, setPhase] = useState<
    "confirm" | "opening" | "spinning" | "reveal"
  >("confirm");
  const [items, setItems] = useState<SkinId[]>([]);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const motion = useMotion();
  useEffect(() => {
    if (selection) dialog.current?.showModal();
  }, [selection]);
  useEffect(() => {
    if (phase !== "spinning" && phase !== "opening") return;
    const timer = setTimeout(
      () =>
        setPhase(
          motion.reduced || phase === "spinning" ? "reveal" : "spinning",
        ),
      motion.reduced ? 0 : phase === "opening" ? 1200 : 5350,
    );
    return () => clearTimeout(timer);
  }, [phase, motion.reduced]);
  function close() {
    setSelection(null);
    setReward(null);
    busy.current = false;
  }
  function choose(
    id: CrateId,
    welcome = false,
    currency: "coins" | "gems" = "coins",
  ) {
    setMessage("");
    setPhase("confirm");
    setSelection({ id, welcome, currency });
  }
  async function open() {
    if (!selection || busy.current) return;
    busy.current = true;
    const result = await onOpen(
      selection.id,
      selection.welcome,
      selection.currency,
    );
    if (!result) {
      busy.current = false;
      setMessage(
        "Could not save this opening. Retry this same chest to recover any saved reward.",
      );
      return;
    }
    const strip = Array.from({ length: 34 }, () =>
      rollSkin(selection.id, randomUnit(), randomUnit()),
    );
    strip[28] = result.skin;
    setItems(strip);
    setReward(result);
    setPhase("opening");
  }
  const won = skins.find((s) => s.id === reward?.skin);
  const crate = crates.find((c) => c.id === selection?.id);
  const price = crate
    ? selection?.currency === "gems"
      ? gemPrices[crate.id]
      : crate.price
    : 0;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">DISCOVER YOUR SIGNATURE</span>
        <h1>The treasure room</h1>
        <p>New arrows. A little more magic.</p>
      </div>
      <div className="shop-switch" role="group" aria-label="Shop view">
        <button
          aria-pressed={tab === "crates"}
          onClick={() => setTab("crates")}
        >
          Crates
        </button>
        <button
          aria-pressed={tab === "collection"}
          onClick={() => setTab("collection")}
        >
          Collection · {profile.owned.length}/15
        </button>
      </div>
      <section className="gem-wallet">
        <Gem />
        <div>
          <strong>{profile.gems} gems</strong>
          <p>Open chests or use Time Boost in puzzle Settings.</p>
        </div>
        {!profile.gemGiftClaimed && (
          <button
            className="gem-button"
            onClick={async () =>
              setMessage(
                (await onClaimGems())
                  ? "20 starter gems added."
                  : "Could not save your gift. Please try again.",
              )
            }
          >
            Claim 20 gems
          </button>
        )}
      </section>
      {tab === "crates" ? (
        <>
          {!profile.welcomeClaimed && (
            <section className="welcome-crate">
              <div>
                <span className="eyebrow">A GIFT FOR YOU</span>
                <h2>Your first discovery</h2>
                <p>One Bloom Crate, on us.</p>
              </div>
              <button
                className="primary-button"
                onClick={() => choose("bloom", true)}
              >
                Open gift
              </button>
            </section>
          )}
          <div className="crate-list">
            {crates.map((c) => (
              <section className={`crate-card theme-${c.id}`} key={c.id}>
                <div className="crate-hero">
                  <CrateArt kind={c.id} />
                  <div>
                    <span className="eyebrow">{c.tag}</span>
                    <h2>{c.name}</h2>
                    <button
                      className="primary-button"
                      disabled={coins < c.price}
                      onClick={() => choose(c.id)}
                    >
                      {coins < c.price
                        ? `Need ${c.price - coins} more`
                        : `Open · ${c.price} coins`}
                    </button>
                    <button
                      className="gem-button"
                      disabled={profile.gems < gemPrices[c.id]}
                      onClick={() => choose(c.id, false, "gems")}
                    >
                      <Gem />
                      Open · {gemPrices[c.id]}{" "}
                      {gemPrices[c.id] === 1 ? "gem" : "gems"}
                    </button>
                  </div>
                </div>
                <details>
                  <summary>Drop odds & contents</summary>
                  <Odds id={c.id} />
                  <p>
                    Equal chance per arrow within each rarity. Classic never
                    drops. Duplicates return {Math.floor(c.price / 2)} coins.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setTab("collection")}
                  >
                    View all arrows
                  </button>
                </details>
              </section>
            ))}
          </div>
          <p className="crate-note">
            Earn 25 coins on each first Story clear. Coins or gems — no cash
            purchases. Effects never change puzzle rules.
          </p>
          {profile.lastReward && (
            <p className="last-discovery">
              Last discovery:{" "}
              <strong>
                {skins.find((s) => s.id === profile.lastReward!.skin)!.name}
              </strong>
              {profile.lastReward.duplicate
                ? ` · duplicate, ${profile.lastReward.refund} ${profile.lastReward.currency ?? "coins"} returned`
                : " · saved to Collection"}
            </p>
          )}
        </>
      ) : (
        <>
          <div
            className="collection-filters"
            role="group"
            aria-label="Filter arrows"
          >
            {["all", "owned", ...rarities].map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="collection-grid">
            {skins
              .filter(
                (s) =>
                  filter === "all" ||
                  (filter === "owned"
                    ? profile.owned.includes(s.id)
                    : s.rarity === filter),
              )
              .map((s) => (
                <section
                  key={s.id}
                  data-rarity={s.rarity}
                  className={`collectible ${profile.equipped === s.id ? "equipped" : ""}`}
                >
                  <span className="rarity-label">{s.rarity}</span>
                  <ArrowPreview skin={s} />
                  <h2>{s.name}</h2>
                  <p>{s.description}</p>
                  <button
                    disabled={
                      !profile.owned.includes(s.id) || profile.equipped === s.id
                    }
                    onClick={() =>
                      setMessage(
                        onEquip(s.id)
                          ? `${s.name} equipped.`
                          : "Could not save selection.",
                      )
                    }
                  >
                    {profile.equipped === s.id
                      ? "Equipped"
                      : profile.owned.includes(s.id)
                        ? "Equip"
                        : "Find in crates"}
                  </button>
                </section>
              ))}
          </div>
        </>
      )}
      <p role="status" className="shop-message">
        {message}
      </p>
      {selection &&
        createPortal(
          <dialog
            ref={dialog}
            className="crate-dialog"
            data-motion={motion.reduced ? "reduced" : "full"}
            data-effects={motion.rich ? "rich" : "subtle"}
            data-phase={phase}
            aria-label={phase === "confirm" ? "Open crate" : "Crate reward"}
            onCancel={(e) => {
              e.preventDefault();
              if (phase === "spinning" || phase === "opening")
                setPhase("reveal");
              else close();
            }}
          >
            {phase === "confirm" ? (
              <>
                <CrateArt kind={selection.id} />
                <h2>{selection.welcome ? "Your welcome gift" : crate!.name}</h2>
                <p>
                  {selection.welcome
                    ? "One free opening. Yours to keep."
                    : `Spend ${price} ${selection!.currency} to discover one arrow?`}
                </p>
                <Odds id={selection.id} />
                <p className="crate-note">
                  {selection.welcome
                    ? "Free gift duplicates return no coins."
                    : `Duplicates return ${Math.floor(price / 2)} ${selection!.currency}.`}{" "}
                  All rewards are cosmetic.
                </p>
                <p role="status">{message}</p>
                <div className="crate-actions">
                  <button className="primary-button" onClick={open}>
                    {selection.welcome ? "Open free crate" : "Confirm opening"}
                  </button>
                  <button className="text-button" onClick={close}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  {phase !== "reveal"
                    ? "A LITTLE MAGIC INSIDE"
                    : "YOUR DISCOVERY"}
                </span>
                <h2>{phase !== "reveal" ? crate!.name : won!.name}</h2>
                <div className="chest-stage" aria-hidden="true">
                  <span className="chest-aura" />
                  <CrateArt kind={selection.id} />
                  <span className="chest-flare" />
                  <img
                    className={`chest-open crate-${selection.id}`}
                    src="/assets/chests/treasure-chest-open.png"
                    alt=""
                  />
                </div>
                <div className="crate-reel" aria-hidden="true">
                  <span className="reel-pointer" />
                  <div
                    className={`reel-belt ${phase === "spinning" ? "is-spinning" : "is-settled"}`}
                  >
                    {items.map((id, i) => {
                      const s = skins.find((s) => s.id === id)!;
                      return (
                        <div
                          className={`reel-item ${i === 28 && phase === "reveal" ? "winning-item" : ""}`}
                          data-rarity={s.rarity}
                          key={i}
                        >
                          <ArrowPreview skin={s} />
                          <strong>{s.name}</strong>
                          <span>{s.rarity}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {phase !== "reveal" ? (
                  <>
                    <p role="status">Opening your discovery…</p>
                    <button
                      className="text-button"
                      onClick={() => setPhase("reveal")}
                    >
                      Skip animation
                    </button>
                  </>
                ) : (
                  <div className="reward-reveal" data-rarity={won!.rarity}>
                    <div className="reward-hero">
                      <ArrowPreview skin={won!} />
                    </div>
                    <span className="rarity-label">{won!.rarity}</span>
                    <p>{won!.description}</p>
                    <p role="status">
                      {reward!.duplicate
                        ? `Already in your collection. ${reward!.refund} ${reward!.currency ?? "coins"} returned.`
                        : "New arrow unlocked. Saved to your collection."}
                    </p>
                    <div className="crate-actions">
                      <button
                        className="primary-button"
                        onClick={() => {
                          if (onEquip(reward!.skin)) {
                            setMessage(`${won!.name} equipped.`);
                            close();
                          } else
                            setMessage(
                              "Could not save selection. Your arrow is still in Collection.",
                            );
                        }}
                      >
                        Equip arrow
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab("collection");
                          close();
                        }}
                      >
                        Keep in collection
                      </button>
                    </div>
                    <p role="status">{message}</p>
                  </div>
                )}
              </>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
