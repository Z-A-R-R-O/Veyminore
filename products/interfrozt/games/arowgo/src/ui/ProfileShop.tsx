import { useState } from "react";
import { GameArt } from "./elements/GameArt";
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
