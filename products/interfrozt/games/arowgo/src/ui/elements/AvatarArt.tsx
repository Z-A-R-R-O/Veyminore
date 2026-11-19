import { adventureAvatars, type Avatar } from "../../storage/avatars";
import { GameArt } from "./GameArt";
export function AvatarArt({ avatar }: { avatar: Avatar }) {
  if (avatar === "world" || avatar === "modes" || avatar === "trophy")
    return <GameArt kind={avatar} />;
  const asset = adventureAvatars.find((a) => a.id === avatar)!;
  return (
    <img
      className="game-art adventure-avatar"
      src={asset.src}
      alt={asset.name}
      width={229}
      height={229}
      draggable={false}
    />
  );
}
