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
      ) / 6,
    ),
  );
  return (
    <section className="profile-editor glass-panel">
      <div className="profile-identity">
        <AvatarArt avatar={avatar} />
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
        <div
          className="avatar-picker adventure-picker"
          aria-label="Choose avatar"
        >
          {choices.slice(page * 6, page * 6 + 6).map((a) => (
            <button
              type="button"
              key={a.id}
              aria-label={`Choose ${a.name} avatar`}
              aria-pressed={avatar === a.id}
              onClick={() => {
                setAvatar(a.id);
                setMessage("");
              }}
            >
              <AvatarArt avatar={a.id} />
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
            {page + 1} / {Math.ceil(choices.length / 6)}
          </span>
          <button
            type="button"
            aria-label="Next avatars"
            disabled={(page + 1) * 6 >= choices.length}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
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
