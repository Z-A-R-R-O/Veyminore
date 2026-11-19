import { useState } from "react";
import { avatarFrames, type AvatarFrame } from "../storage/avatar-frames";
import {
  avatarBackgrounds,
  type AvatarBackground,
} from "../storage/avatar-backgrounds";
import { adventureAvatars } from "../storage/avatars";
import { type Profile, type Avatar } from "../storage/profile";
import { AvatarArt } from "./elements/AvatarArt";
const avatarChoices = [
  ...adventureAvatars,
  ...(["world", "modes", "trophy"] as const).map((id) => ({ id, name: id })),
];
const backgrounds = [
  { id: "none" as const, name: "Original" },
  ...avatarBackgrounds,
];
const frames = [...avatarFrames, { id: "none" as const, name: "No frame" }];
const pageSize = 12;
type Category = "avatar" | "background" | "frame";
export function ProfileEditor({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => boolean;
}) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<Avatar>(profile.avatar);
  const [background, setBackground] = useState<AvatarBackground>(
    profile.avatarBackground,
  );
  const [frame, setFrame] = useState<AvatarFrame>(profile.avatarFrame);
  const [tab, setTab] = useState<Category>("avatar");
  const [message, setMessage] = useState("");
  const [pages, setPages] = useState({
    avatar: Math.floor(
      Math.max(
        0,
        adventureAvatars.findIndex((a) => a.id === profile.avatar),
      ) / pageSize,
    ),
    background: 0,
    frame: 0,
  });
  const choices =
    tab === "avatar"
      ? avatarChoices
      : tab === "background"
        ? backgrounds
        : frames;
  const selected =
    tab === "avatar" ? avatar : tab === "background" ? background : frame;
  const page = pages[tab];
  const total = Math.ceil(choices.length / pageSize);
  const label =
    tab === "avatar"
      ? "avatars"
      : tab === "background"
        ? "backgrounds"
        : "frames";
  const select = (id: string) => {
    if (tab === "avatar") setAvatar(id as Avatar);
    else if (tab === "background") setBackground(id as AvatarBackground);
    else setFrame(id as AvatarFrame);
    setMessage("");
  };
  return (
    <section className="profile-editor glass-panel portrait-studio">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(
            onSave({
              ...profile,
              name: name.trim() || "Guest",
              avatar,
              avatarBackground: background,
              avatarFrame: frame,
            })
              ? "Profile saved."
              : "Could not save. Please try again.",
          );
        }}
      >
        <div className="portrait-preview-row profile-identity">
          <div className="portrait-live-preview" aria-label="Portrait preview">
            <AvatarArt avatar={avatar} background={background} frame={frame} />
          </div>
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
        </div>
        <div className="avatar-category" aria-label="Customize portrait">
          {(["avatar", "background", "frame"] as const).map((category, i) => (
            <button
              type="button"
              key={category}
              aria-pressed={tab === category}
              onClick={() => setTab(category)}
            >
              <span aria-hidden="true" className="portrait-tab-symbol">
                {["◉", "▧", "◇"][i]}
              </span>
              {["Avatar", "Background", "Frame"][i]}
            </button>
          ))}
        </div>
        <div className="portrait-choice-area">
          <div
            className="avatar-picker adventure-picker"
            aria-label={`Choose ${tab}`}
            key={tab}
          >
            {choices
              .slice(page * pageSize, (page + 1) * pageSize)
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  title={item.name}
                  aria-label={`Choose ${item.name} ${tab}`}
                  aria-pressed={selected === item.id}
                  onClick={() => select(item.id)}
                >
                  <span className="portrait-tile-art">
                    <AvatarArt
                      avatar={tab === "avatar" ? (item.id as Avatar) : avatar}
                      background={
                        tab === "background"
                          ? (item.id as AvatarBackground)
                          : background
                      }
                      frame={tab === "frame" ? (item.id as AvatarFrame) : frame}
                    />
                  </span>
                  <span className="portrait-tile-name">{item.name}</span>
                </button>
              ))}
          </div>
        </div>
        <div className="avatar-controls">
          <div className="portrait-pager">
            <button
              type="button"
              aria-label={`Previous ${label}`}
              disabled={page === 0}
              onClick={() => setPages({ ...pages, [tab]: page - 1 })}
            >
              ‹
            </button>
            <span aria-live="polite">
              {page + 1} / {total}
            </span>
            <button
              type="button"
              aria-label={`Next ${label}`}
              disabled={page + 1 >= total}
              onClick={() => setPages({ ...pages, [tab]: page + 1 })}
            >
              ›
            </button>
          </div>
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
