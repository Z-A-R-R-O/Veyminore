/** Generated transparent atlas. Keep semantic labels on the parent control. */
export function GameArt({
  kind,
}: {
  kind: "world" | "modes" | "trophy" | "flag" | "infinity" | "hint" | "erase";
}) {
  return (
    <span className={`game-art generated-art art-${kind}`} aria-hidden="true" />
  );
}
