import { useState } from "react";
import { avatarFrames, type AvatarFrame } from "../storage/avatar-frames";
import { adventureAvatars } from "../storage/avatars";
import { type Profile, type Avatar } from "../storage/profile";
import { AvatarArt } from "./elements/AvatarArt";
const avatarChoices = [
  ...adventureAvatars,
  ...(["world", "modes", "trophy"] as const).map((id) => ({ id, name: id })),
];
const frames = [...avatarFrames, { id: "none" as const, name: "No frame" }];

type Category = "avatar" | "frame";
export function ProfileEditor({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (p: Profile) => boolean;
}) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<Avatar>(profile.avatar);
  const [frame, setFrame] = useState<AvatarFrame>(profile.avatarFrame);
  const [tab, setTab] = useState<Category>("avatar");
  const [message, setMessage] = useState("");
  const choices = tab === "avatar" ? avatarChoices : frames;
  const selected = tab === "avatar" ? avatar : frame;
  const select = (id: string) => {
    if (tab === "avatar") setAvatar(id as Avatar);
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
              avatarBackground: "none",
              avatarFrame: frame,
            })
              ? "Profile saved."
              : "Could not save. Please try again.",
          );
        }}
      >
        <div className="portrait-preview-row profile-identity">
          <div className="portrait-live-preview" aria-label="Portrait preview">
            <AvatarArt avatar={avatar} background="none" frame={frame} />
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
          {(["avatar", "frame"] as const).map((category, i) => (
            <button
              type="button"
              key={category}
              aria-pressed={tab === category}
              onClick={() => setTab(category)}
            >
              <span aria-hidden="true" className="portrait-tab-symbol">
                {["◉", "◇"][i]}
              </span>
              {["Avatar", "Frame"][i]}
            </button>
          ))}
        </div>
        <div className="portrait-choice-area">
          <div
            className="avatar-picker adventure-picker"
            aria-label={`Choose ${tab}`}
            key={tab}
          >
            {choices.map((item) => (
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
                    background="none"
                    frame={tab === "frame" ? (item.id as AvatarFrame) : frame}
                  />
                </span>
                <span className="portrait-tile-name">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="avatar-controls">
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
