import { checkExit, timingOpen, switchOpen, type Level } from "./rules";
/** Observable geometry and one-move effects only. Never consult the solution or solver. */
export function inspectArrow(
  level: Level,
  active: readonly string[],
  id: string,
) {
  const exit = checkExit(level, active, id);
  const removed = level.arrows.length - active.length;
  const arrow = level.arrows.find((a) => a.id === id)!;
  const sources = [
    arrow.requires,
    arrow.anchorRequires,
    ...level.arrows
      .filter((a) => arrow.gate && a.switchGroup === arrow.gate.group)
      .map((a) => a.id),
  ].filter((source): source is string => !!source && active.includes(source));
  const route =
    exit.clear || !exit.reason
      ? exit
      : checkExit(
          {
            ...level,
            arrows: level.arrows.map((a) =>
              a.id === id
                ? {
                    ...a,
                    requires: undefined,
                    anchorRequires: undefined,
                    thawAfter: undefined,
                    phase: undefined,
                    pulse: undefined,
                    window: undefined,
                    gate: undefined,
                  }
                : a,
            ),
          },
          active,
          id,
        );
  const linked = level.arrows.filter(
    (a) =>
      active.includes(a.id) &&
      (a.requires === id ||
        a.anchorRequires === id ||
        (arrow.switchGroup !== undefined &&
          a.gate?.group === arrow.switchGroup)),
  );
  const changes = exit.clear
    ? level.arrows
        .filter((a) => active.includes(a.id) && a.id !== id)
        .flatMap((a) => {
          const items: {
            id: string;
            kind: "keg" | "ice" | "phase" | "pulse" | "window" | "switch";
            before: number;
            after: number;
          }[] = [];
          if (a.deadline !== undefined)
            items.push({
              id: a.id,
              kind: "keg",
              before: Math.max(0, a.deadline - removed),
              after: Math.max(0, a.deadline - removed - 1),
            });
          if (a.thawAfter !== undefined && a.thawAfter > removed)
            items.push({
              id: a.id,
              kind: "ice",
              before: a.thawAfter - removed,
              after: Math.max(0, a.thawAfter - removed - 1),
            });
          if (a.phase !== undefined)
            items.push({
              id: a.id,
              kind: "phase",
              before: Number(timingOpen(a, removed)),
              after: Number(timingOpen(a, removed + 1)),
            });
          if (a.pulse !== undefined || a.window !== undefined)
            items.push({
              id: a.id,
              kind: a.pulse !== undefined ? "pulse" : "window",
              before: Number(timingOpen(a, removed)),
              after: Number(timingOpen(a, removed + 1)),
            });
          if (
            arrow.switchGroup !== undefined &&
            a.gate?.group === arrow.switchGroup
          )
            items.push({
              id: a.id,
              kind: "switch",
              before: Number(switchOpen(level, active, a.id)),
              after: Number(
                switchOpen(
                  level,
                  active.filter((x) => x !== id),
                  a.id,
                ),
              ),
            });
          return items;
        })
    : [];
  const title = exit.clear
    ? "Path open"
    : exit.reason === "switch"
      ? `Gate ${arrow.gate!.group} closed · remove a matching switch to toggle it`
      : exit.reason === "locked"
        ? "Locked · matching key highlighted"
        : exit.reason === "anchored"
          ? "Anchored · source highlighted"
          : exit.reason === "frozen"
            ? `Ice seal · ${Math.max(0, arrow.thawAfter! - removed)} moves to thaw`
            : exit.reason === "phase"
              ? arrow.pulse !== undefined
                ? `Beat ${arrow.pulse + 1}/3 gate · current beat ${(removed % 3) + 1}/3`
                : arrow.window
                  ? `Window ${arrow.window[0]}–${arrow.window[1]} removals · now ${removed}${removed > arrow.window[1] ? " · expired" : ""}`
                  : "Phase closed · switches after a removal"
              : "Path blocked · obstacle highlighted";
  const has = (kind: string) => changes.some((c) => c.kind === kind);
  const effects = [
    has("keg") && has("ice")
      ? "Kegs / ice −1"
      : has("keg")
        ? "Kegs −1"
        : has("ice")
          ? "Ice −1"
          : "",
    has("switch") ? `Group ${arrow.switchGroup} gates toggle` : "",
    has("phase") ? "Phases flip" : "",
    has("pulse") ? "Beat advances" : "",
    has("window") ? "Windows advance" : "",
    exit.clear && linked.length && arrow.switchGroup === undefined
      ? `${linked.length} link${linked.length === 1 ? "" : "s"} release`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    exit,
    route,
    sources,
    linked: linked.map((a) => a.id),
    changes,
    title,
    effects,
  };
}
