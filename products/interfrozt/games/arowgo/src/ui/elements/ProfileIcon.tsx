type Kind =
  | "account"
  | "pencil"
  | "avatar"
  | "frame"
  | "levels"
  | "star"
  | "perfect";
export function ProfileIcon({ kind }: { kind: Kind }) {
  return (
    <img
      className={`profile-icon profile-icon-${kind}`}
      src={`/assets/profile-icons/${kind}.webp`}
      width={32}
      height={32}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
