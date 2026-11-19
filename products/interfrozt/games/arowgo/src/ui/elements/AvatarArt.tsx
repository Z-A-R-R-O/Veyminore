import { avatarFrames, type AvatarFrame } from "../../storage/avatar-frames";
import {
  avatarBackgrounds,
  type AvatarBackground,
} from "../../storage/avatar-backgrounds";
import { adventureAvatars, type Avatar } from "../../storage/avatars";
import { GameArt } from "./GameArt";
export function AvatarArt({
  avatar,
  background = "none",
  frame = "none",
}: {
  avatar: Avatar;
  background?: AvatarBackground;
  frame?: AvatarFrame;
}) {
  const rim = avatarFrames.find((f) => f.id === frame);
  if (rim)
    return (
      <span className="game-art framed-avatar">
        <span className="framed-avatar-face">
          <AvatarArt avatar={avatar} background={background} />
        </span>
        <img
          className="avatar-frame-overlay"
          src={rim.src}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </span>
    );
  const bg = avatarBackgrounds.find((b) => b.id === background);
  const style = bg
    ? {
        backgroundImage: `url("${bg.src}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;
  if (avatar === "world" || avatar === "modes" || avatar === "trophy")
    return (
      <span className="game-art avatar-composite" style={style}>
        <GameArt kind={avatar} />
      </span>
    );
  const asset = adventureAvatars.find((a) => a.id === avatar)!;
  return (
    <img
      className="game-art adventure-avatar"
      style={style}
      src={asset.src}
      alt={asset.name}
      width={229}
      height={229}
      draggable={false}
    />
  );
}
