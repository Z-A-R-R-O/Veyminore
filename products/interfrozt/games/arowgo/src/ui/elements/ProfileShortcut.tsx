import type { Profile } from "../../storage/profile";
import { AvatarArt } from "./AvatarArt";
import "./profile-shortcut.css";

export function ProfileShortcut({
  profile,
  current = false,
}: {
  profile: Profile;
  current?: boolean;
}) {
  return (
    <a
      className="profile-shortcut"
      href="#profile"
      aria-label="Open profile"
      title="Your profile"
      aria-current={current ? "page" : undefined}
    >
      <AvatarArt avatar={profile.avatar} frame={profile.avatarFrame} />
    </a>
  );
}
