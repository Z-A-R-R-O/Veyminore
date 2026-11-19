import { avatarFrames, type AvatarFrame } from "../storage/avatar-frames";
import {
  avatarBackgrounds,
  type AvatarBackground,
} from "../storage/avatar-backgrounds";
import { useState } from "react";
import { AvatarArt } from "./elements/AvatarArt";
import { adventureAvatars } from "../storage/avatars";
const choices = [
  ...adventureAvatars,
  ...(["world", "modes", "trophy"] as const).map((id) => ({ id, name: id })),
];
import { type Profile, type Avatar } from "../storage/profile";
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
  const [page, setPage] = useState(
    Math.floor(
      Math.max(
        0,
        adventureAvatars.findIndex((a) => a.id === profile.avatar),
      ) / 12,
    ),
  );
  const [background, setBackground] = useState<AvatarBackground>(
    profile.avatarBackground,
  );
  const [tab, setTab] = useState<"avatar" | "background" | "frame">("avatar");
  const [frame, setFrame] = useState<AvatarFrame>(profile.avatarFrame);
  const [framePage, setFramePage] = useState(0);
  const frameChoices = [
    ...avatarFrames,
    { id: "none" as const, name: "No frame" },
  ];
  const [bgPage, setBgPage] = useState(0);
  const bgChoices = [
    { id: "none" as const, name: "Original" },
    ...avatarBackgrounds,
  ];
  return (
    <section className="profile-editor glass-panel portrait-studio">
      <div className="profile-identity">
        <AvatarArt avatar={avatar} background={background} frame={frame} />
        <div>
          <h2>{profile.name}</h2>
          <p>Guest profile · this device</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            onSave({
              ...profile,
              name: name.trim() || "Guest",
              avatar,
              avatarBackground: background,
              avatarFrame: frame,
            })
          )
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
        <div className="avatar-category" aria-label="Customize portrait">
          <button
            type="button"
            aria-pressed={tab === "avatar"}
            onClick={() => setTab("avatar")}
          >
            <span className="portrait-tab-symbol" aria-hidden="true">
              ◉
            </span>{" "}
            Avatar
          </button>
          <button
            type="button"
            aria-pressed={tab === "background"}
            onClick={() => setTab("background")}
          >
            <span className="portrait-tab-symbol" aria-hidden="true">
              ▧
            </span>{" "}
            Background
          </button>
          <button
            type="button"
            aria-pressed={tab === "frame"}
            onClick={() => setTab("frame")}
          >
            <span className="portrait-tab-symbol" aria-hidden="true">
              ◇
            </span>{" "}
            Frame
          </button>
        </div>
        {tab === "avatar" ? (
          <>
            <div
              className="avatar-picker adventure-picker"
              aria-label="Choose avatar"
            >
              {choices.slice(page * 12, page * 12 + 12).map((a) => (
                <button
                  type="button"
                  key={a.id}
                  title={a.name}
                  aria-label={`Choose ${a.name} avatar`}
                  aria-pressed={avatar === a.id}
                  onClick={() => {
                    setAvatar(a.id);
                    setMessage("");
                  }}
                >
                  <AvatarArt
                    avatar={a.id}
                    background={background}
                    frame={frame}
                  />
                </button>
              ))}
            </div>
            <div className="avatar-controls">
              <button
                type="button"
                aria-label="Previous avatars"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>
              <span aria-live="polite">
                {page + 1} / {Math.ceil(choices.length / 12)}
              </span>
              <button
                type="button"
                aria-label="Next avatars"
                disabled={(page + 1) * 12 >= choices.length}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
              <button className="primary-button" type="submit">
                Save
              </button>
            </div>
          </>
        ) : tab === "background" ? (
          <>
            <div
              className="avatar-picker adventure-picker"
              aria-label="Choose background"
            >
              {bgChoices.slice(bgPage * 12, bgPage * 12 + 12).map((b) => (
                <button
                  type="button"
                  key={b.id}
                  title={b.name}
                  aria-label={`Choose ${b.name} background`}
                  aria-pressed={background === b.id}
                  onClick={() => {
                    setBackground(b.id);
                    setMessage("");
                  }}
                >
                  <AvatarArt avatar={avatar} background={b.id} frame={frame} />
                </button>
              ))}
            </div>
            <div className="avatar-controls">
              <button
                type="button"
                aria-label="Previous backgrounds"
                disabled={bgPage === 0}
                onClick={() => setBgPage(bgPage - 1)}
              >
                ‹
              </button>
              <span aria-live="polite">{bgPage + 1} / 2</span>
              <button
                type="button"
                aria-label="Next backgrounds"
                disabled={bgPage === 1}
                onClick={() => setBgPage(bgPage + 1)}
              >
                ›
              </button>
              <button className="primary-button" type="submit">
                Save
              </button>
            </div>
          </>
        ) : null}
        {tab === "frame" && (
          <>
            <div
              className="avatar-picker adventure-picker"
              aria-label="Choose frame"
            >
              {frameChoices
                .slice(framePage * 12, framePage * 12 + 12)
                .map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    title={f.name}
                    aria-label={`Choose ${f.name} frame`}
                    aria-pressed={frame === f.id}
                    onClick={() => {
                      setFrame(f.id);
                      setMessage("");
                    }}
                  >
                    <AvatarArt
                      avatar={avatar}
                      background={background}
                      frame={f.id}
                    />
                  </button>
                ))}
            </div>
            <div className="avatar-controls">
              <button
                type="button"
                aria-label="Previous frames"
                disabled={framePage === 0}
                onClick={() => setFramePage(framePage - 1)}
              >
                ‹
              </button>
              <span aria-live="polite">{framePage + 1} / 3</span>
              <button
                type="button"
                aria-label="Next frames"
                disabled={framePage === 2}
                onClick={() => setFramePage(framePage + 1)}
              >
                ›
              </button>
              <button className="primary-button" type="submit">
                Save
              </button>
            </div>
          </>
        )}
        <p role="status" className="profile-message">
          {message}
        </p>
      </form>
    </section>
  );
}
