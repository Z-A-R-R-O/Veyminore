export type Point = readonly [number, number];
export function length(points: Point[]): number {
  return points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
      0,
    );
}
// Advance the tail along its original route, extending the head straight ahead.
// Presentation only: this function never decides whether an arrow may leave.
export function snake(points: Point[], distance: number): Point[] {
  let remaining = Math.max(0, distance);
  const end = points.at(-1)!,
    previous = points.at(-2)!;
  const size = Math.hypot(end[0] - previous[0], end[1] - previous[1]);
  const dx = (end[0] - previous[0]) / size,
    dy = (end[1] - previous[1]) / size;
  const route: Point[] = [
    ...points,
    [end[0] + dx * distance, end[1] + dy * distance],
  ];
  while (route.length > 1) {
    const a = route[0],
      b = route[1],
      segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining < segment) {
      route[0] = [
        a[0] + ((b[0] - a[0]) * remaining) / segment,
        a[1] + ((b[1] - a[1]) * remaining) / segment,
      ];
      break;
    }
    remaining -= segment;
    route.shift();
  }
  return route.filter(
    (p, i) => i === 0 || p[0] !== route[i - 1][0] || p[1] !== route[i - 1][1],
  );
}
export function roundedPath(points: Point[], radius = 13): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const incoming = Math.hypot(b[0] - a[0], b[1] - a[1]),
      outgoing = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(radius, incoming / 2, outgoing / 2);
    const x = b[0] - ((b[0] - a[0]) * r) / incoming,
      y = b[1] - ((b[1] - a[1]) * r) / incoming;
    const nx = b[0] + ((c[0] - b[0]) * r) / outgoing,
      ny = b[1] + ((c[1] - b[1]) * r) / outgoing;
    d += ` L ${x} ${y} Q ${b[0]} ${b[1]} ${nx} ${ny}`;
  }
  const end = points.at(-1)!;
  return d + ` L ${end[0]} ${end[1]}`;
}
