export type Point = { x: number; y: number };
export function clampDock(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(
      Math.max(8, Number.isFinite(point.x) ? point.x : 8),
      Math.max(8, width - 64),
    ),
    y: Math.min(
      Math.max(8, Number.isFinite(point.y) ? point.y : 8),
      Math.max(8, height - 64),
    ),
  };
}
export function safeRoute(hash: string) {
  const route = hash.replace(/^#\/?/, "");
  return /^(home|worlds|modes|shop|profile(?:\/(edit|account))?|settings|play\/\d{1,3}|finale(?:\/bloom)?|learn\/(keys|snake\/\d{1,3})|preview\/keys)$/.test(
    route,
  )
    ? route
    : "unrecognized";
}
export function reportText(input: {
  summary: string;
  details: string;
  severity: string;
  route: string;
  width: number;
  height: number;
  scale: number;
  reducedMotion: boolean;
  errors: number;
  sandboxLevel: number | null;
  levelId?: string;
  contentVersion?: number;
  active?: string[];
}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      app: "AROWGO",
      environment: "development",
      createdAt: new Date().toISOString(),
      summary: input.summary.trim().slice(0, 120),
      details: input.details.trim().slice(0, 4000),
      severity: ["minor", "major", "blocker"].includes(input.severity)
        ? input.severity
        : "minor",
      context: {
        route: safeRoute(input.route),
        viewport: {
          width: input.width,
          height: input.height,
          pixelRatio: input.scale,
        },
        reducedMotion: input.reducedMotion,
        runtimeErrorCount: input.errors,
        sandboxLevel: input.sandboxLevel,
        levelId: input.levelId,
        contentVersion: input.contentVersion,
        activeArrows: input.active,
      },
    },
    null,
    2,
  );
}
