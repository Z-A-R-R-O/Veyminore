import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { direction, type Level } from "../domain/rules";
import type { Outcome } from "../application/session";

export function Board({
  level,
  active,
  hints,
  disabled,
  reduced,
  onSelect,
}: {
  level: Level;
  active: string[];
  hints: string[];
  disabled: boolean;
  reduced: boolean;
  onSelect: (id: string) => Outcome | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PuzzleScene | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ active, hints, disabled, reduced, onSelect });
  latest.current = { active, hints, disabled, reduced, onSelect };
  useEffect(() => {
    const scene = new PuzzleScene(level, (id) => {
      const props = latest.current;
      if (props.disabled) return;
      const result = props.onSelect(id);
      if (result) scene.animate(result, props.reduced);
    });
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      width: 600,
      height: 600,
      transparent: true,
      scene,
      banner: false,
      render: { antialias: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      callbacks: {
        postBoot: () => {
          game.canvas.setAttribute("aria-hidden", "true");
        },
      },
    });
    scene.sync(latest.current.active, latest.current.hints);
    return () => {
      sceneRef.current = null;
      game.destroy(true);
    };
  }, [level]);
  useEffect(() => {
    sceneRef.current?.sync(active, hints);
  }, [active, hints]);
  const cell = 480 / level.board.columns;
  return (
    <div
      className="board"
      data-testid="board"
      onPointerDown={(e) => {
        if (e.button === 0) press.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onPointerUp={(e) => {
        const start = press.current;
        press.current = null;
        if (
          !start ||
          Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10 ||
          disabled
        )
          return;
        const box = e.currentTarget.getBoundingClientRect();
        sceneRef.current?.pick(
          ((e.clientX - box.left) * 600) / box.width,
          ((e.clientY - box.top) * 600) / box.height,
        );
      }}
    >
      <div ref={host} className="canvas-host" />
      <div
        className="accessible-arrows"
        role="group"
        aria-label="Puzzle arrows. Tab to an arrow and press Enter to slide it."
      >
        {level.arrows
          .filter((a) => active.includes(a.id))
          .map((a) => {
            const head = a.points.at(-1)!;
            return (
              <button
                key={a.id}
                className="arrow-control"
                aria-label={`Slide arrow ${a.id}`}
                disabled={disabled}
                style={{
                  left: `${(60 + (head[0] + 0.5) * cell) / 6}%`,
                  top: `${(60 + (head[1] + 0.5) * cell) / 6}%`,
                }}
                onClick={() => {
                  const result = onSelect(a.id);
                  if (result) sceneRef.current?.animate(result, reduced);
                }}
              >
                {a.id}
              </button>
            );
          })}
      </div>
    </div>
  );
}

class PuzzleScene extends Phaser.Scene {
  private shapes = new Map<string, Phaser.GameObjects.Container>();
  private animating = new Set<string>();
  private active: string[] = [];
  private hints: string[] = [];
  private ready = false;
  private cell: number;
  constructor(
    private level: Level,
    private select: (id: string) => void,
  ) {
    super("puzzle");
    this.cell = 480 / level.board.columns;
  }
  create() {
    this.ready = true;
    const grid = this.add.graphics();
    grid.fillStyle(0xcfc5e3, 0.55);
    for (let x = 0; x < this.level.board.columns; x++)
      for (let y = 0; y < this.level.board.rows; y++)
        grid.fillCircle(this.coord(x), this.coord(y), 2);
    this.sync(this.active, this.hints);
    this.game.canvas.dataset.ready = "true";
  }
  // DOM pointer coordinates avoid dropping the first event during engine boot/resizing.
  // Continuous segment distance makes every point along a bent path tappable.
  pick(x: number, y: number) {
    if (!this.ready) return;
    let nearest: string | undefined,
      distance = Infinity;
    for (const arrow of this.level.arrows)
      if (this.active.includes(arrow.id))
        for (let i = 1; i < arrow.points.length; i++) {
          const [ax, ay] = arrow.points[i - 1].map((n) => this.coord(n));
          const [bx, by] = arrow.points[i].map((n) => this.coord(n));
          const dx = bx - ax,
            dy = by - ay;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)),
          );
          const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
          if (d < distance && d < this.cell * 0.45) {
            distance = d;
            nearest = arrow.id;
          }
        }
    if (nearest) this.select(nearest);
  }
  private coord(n: number) {
    return 60 + (n + 0.5) * this.cell;
  }
  sync(active: string[], hints: string[]) {
    this.active = active;
    this.hints = hints;
    if (!this.ready) return;
    for (const [id, shape] of this.shapes)
      if (!this.animating.has(id)) {
        shape.destroy();
        this.shapes.delete(id);
      }
    for (const arrow of this.level.arrows) {
      if (!active.includes(arrow.id) || this.animating.has(arrow.id)) continue;
      const color = hints.includes(arrow.id) ? 0x9c69df : 0x3d305b;
      const g = this.add.graphics();
      g.lineStyle(14, color, 1);
      g.beginPath();
      arrow.points.forEach(([x, y], i) =>
        i
          ? g.lineTo(this.coord(x), this.coord(y))
          : g.moveTo(this.coord(x), this.coord(y)),
      );
      g.strokePath();
      g.fillStyle(color);
      for (const [x, y] of arrow.points)
        g.fillCircle(this.coord(x), this.coord(y), 7);
      const [dx, dy] = direction(arrow),
        [hx, hy] = arrow.points.at(-1)!;
      const x = this.coord(hx),
        y = this.coord(hy);
      g.fillTriangle(
        x + dx * 15,
        y + dy * 15,
        x - dx * 9 - dy * 14,
        y - dy * 9 + dx * 14,
        x - dx * 9 + dy * 14,
        y - dy * 9 - dx * 14,
      );
      const [tx, ty] = arrow.points[0];
      const label = this.add
        .text(this.coord(tx) - 17, this.coord(ty) + 14, arrow.id, {
          fontFamily: "Arial",
          fontSize: "13px",
          color: "#8c7da5",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const group = this.add.container(0, 0, [g, label]);
      this.shapes.set(arrow.id, group);
    }
  }
  animate(result: Outcome, reduced: boolean) {
    if (!this.ready || !result.exit || !result.arrowId) return;
    const id = result.arrowId,
      shape = this.shapes.get(id);
    if (!shape) return;
    this.animating.add(id);
    if (result.exit.clear) {
      const arrow = this.level.arrows.find((a) => a.id === id)!;
      const [dx, dy] = direction(arrow);
      this.tweens.add({
        targets: shape,
        x: dx * (result.exit.distance + 2) * this.cell,
        y: dy * (result.exit.distance + 2) * this.cell,
        duration: reduced ? 0 : 360,
        ease: "Cubic.easeIn",
        onComplete: () => {
          shape.destroy();
          this.shapes.delete(id);
          this.animating.delete(id);
          this.sync(this.active, this.hints);
        },
      });
    } else {
      const blocker = this.shapes.get(result.exit.blocker);
      this.tweens.add({
        targets: [shape, ...(blocker ? [blocker] : [])],
        alpha: 0.35,
        duration: reduced ? 0 : 120,
        yoyo: true,
        repeat: reduced ? 0 : 1,
        onComplete: () => {
          this.animating.delete(id);
          this.sync(this.active, this.hints);
        },
      });
    }
  }
}
