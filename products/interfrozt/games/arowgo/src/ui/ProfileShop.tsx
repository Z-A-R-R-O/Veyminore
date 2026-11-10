import { useState } from "react";
import { GameArt } from "./elements/GameArt";
import { Coin } from "./elements/Rewards";
import {
  skins,
  type Profile,
  type Avatar,
  type SkinId,
} from "../storage/profile";
export function ProfileEditor({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => boolean;
}) {
  const [name, setName] = useState(profile.name),
    [avatar, setAvatar] = useState<Avatar>(profile.avatar),
    [message, setMessage] = useState("");
  return (
    <section className="profile-editor glass-panel">
      <div className="profile-identity">
        <GameArt kind={avatar} />
        <div>
          <h2>{profile.name}</h2>
          <p>Guest profile · this device</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onSave({ ...profile, name: name.trim() || "Guest", avatar }))
            setMessage("Profile saved.");
          else setMessage("Could not save. Please try again.");
        }}
      >
        <label className="name-field">
          Display name
          <input
            aria-label="Display name"
            maxLength={20}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMessage("");
            }}
          />
        </label>
        <div className="avatar-picker" aria-label="Choose avatar">
          {(["world", "modes", "trophy"] as const).map((a) => (
            <button
              type="button"
              key={a}
              aria-label={`Choose ${a} avatar`}
              aria-pressed={avatar === a}
              onClick={() => setAvatar(a)}
            >
              <GameArt kind={a} />
            </button>
          ))}
          <button className="primary-button" type="submit">
            Save
          </button>
        </div>
        <p role="status" className="profile-message">
          {message}
        </p>
      </form>
    </section>
  );
}
export function Shop({
  profile,
  coins,
  onBuy,
  onEquip,
}: {
  profile: Profile;
  coins: number;
  onBuy: (id: SkinId) => boolean;
  onEquip: (id: SkinId) => boolean;
}) {
  const [confirm, setConfirm] = useState<SkinId | null>(null),
    [message, setMessage] = useState("");
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">A LITTLE PERSONALITY</span>
        <h1>Arrow shop</h1>
        <p>Cosmetic colours. Same clear thinking.</p>
      </div>
      <div className="shop-balance">
        <Coin />
        <strong>{coins} coins available</strong>
      </div>
      <div className="shop-grid">
        {skins.map((s) => {
          const owned = profile.owned.includes(s.id),
            equipped = profile.equipped === s.id;
          return (
            <section
              key={s.id}
              className={`skin-card glass-panel ${equipped ? "equipped" : ""}`}
            >
              <svg viewBox="0 0 120 80" aria-hidden="true">
                <path
                  d="M15 63h26q10 0 10-10V33q0-10 10-10h32m-14-13 15 13-15 13"
                  fill="none"
                  stroke={s.color}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h2>{s.name}</h2>
              {confirm === s.id ? (
                <div className="purchase-confirm">
                  <p>Spend {s.price} coins?</p>
                  <button
                    onClick={() => {
                      setMessage(
                        onBuy(s.id)
                          ? `${s.name} purchased and equipped.`
                          : "Purchase could not be saved. No coins spent.",
                      );
                      setConfirm(null);
                    }}
                  >
                    Confirm purchase
                  </button>
                  <button onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <button
                  className="skin-action"
                  disabled={equipped || (!owned && coins < s.price)}
                  onClick={() => {
                    if (owned)
                      setMessage(
                        onEquip(s.id)
                          ? `${s.name} equipped.`
                          : "Could not save this selection.",
                      );
                    else setConfirm(s.id);
                  }}
                >
                  {equipped
                    ? "Equipped"
                    : owned
                      ? "Equip"
                      : coins < s.price
                        ? `Need ${s.price - coins} more`
                        : `Buy · ${s.price} coins`}
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p className="shop-message" role="status">
        {message || "Earn 25 coins on each first Story clear."}
      </p>
    </>
  );
}
