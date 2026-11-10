import { useEffect, useRef, useImperativeHandle, type Ref } from "react";
import Phaser from "phaser";
import { direction, type Level } from "../domain/rules";
import type { Outcome } from "../application/session";
export interface BoardHandle {
  animate: (outcome: Outcome) => void;
}

export function Board({
  level,
  active,
  hints,
  disabled,
  reduced,
  rich = true,
  apiRef,
  onSelect,
}: {
  level: Level;
  active: string[];
  hints: string[];
  disabled: boolean;
  reduced: boolean;
  rich?: boolean;
  apiRef?: Ref<BoardHandle>;
  onSelect: (id: string) => Outcome | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PuzzleScene | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ active, hints, disabled, reduced, onSelect });
  latest.current = { active, hints, disabled, reduced, onSelect };
  useImperativeHandle(
    apiRef,
    () => ({
      animate: (outcome) =>
        sceneRef.current?.animate(outcome, latest.current.reduced),
    }),
    [],
  );
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
    scene.setMotion(reduced, rich);
    const visibility = () => {
      if (document.hidden) game.loop.sleep();
      else game.loop.wake();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      sceneRef.current = null;
      document.removeEventListener("visibilitychange", visibility);
      game.destroy(true);
    };
  }, [level]);
  useEffect(() => {
    sceneRef.current?.sync(active, hints);
  }, [active, hints]);
  useEffect(() => {
    sceneRef.current?.setMotion(reduced, rich);
  }, [reduced, rich]);
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
  private reduced = false;
  private rich = true;
  private particles = new Set<Phaser.GameObjects.Graphics>();
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
    grid.fillStyle(0xb4a0d9, 0.23);
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
  setMotion(reduced: boolean, rich: boolean) {
    if (this.reduced === reduced && this.rich === rich) return;
    this.reduced = reduced;
    this.rich = rich;
    if (!this.ready) return;
    this.tweens.killAll();
    for (const p of this.particles) p.destroy();
    this.particles.clear();
    this.animating.clear();
    this.sync(this.active, this.hints);
  }
  private dispose(shape: Phaser.GameObjects.Container) {
    this.tweens.killTweensOf([shape, ...shape.list]);
    shape.destroy();
  }
  private burst(x: number, y: number, color: number, count: number) {
    if (this.reduced || !this.rich) return;
    for (let i = 0; i < count && this.particles.size < 36; i++) {
      const g = this.add.graphics().setPosition(x, y).setDepth(5);
      const size = 2 + (i % 3);
      g.fillStyle(color, 0.9);
      g.fillCircle(0, 0, size);
      g.lineStyle(1, 0xffffff, 0.9);
      g.lineBetween(-size * 2, 0, size * 2, 0);
      g.lineBetween(0, -size * 2, 0, size * 2);
      this.particles.add(g);
      const angle = i * 2.39996,
        distance = 24 + (i % 5) * 11;
      this.tweens.add({
        targets: g,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        duration: 420 + (i % 4) * 70,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.particles.delete(g);
          g.destroy();
        },
      });
    }
  }
  private ring(x: number, y: number, color: number) {
    if (this.reduced || this.particles.size >= 36) return;
    const ring = this.add.graphics().setPosition(x, y).setDepth(4);
    ring.lineStyle(3, color, 0.75);
    ring.strokeCircle(0, 0, 12);
    this.particles.add(ring);
    this.tweens.add({
      targets: ring,
      scale: 2.7,
      alpha: 0,
      duration: 420,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.particles.delete(ring);
        ring.destroy();
      },
    });
  }
  sync(active: string[], hints: string[]) {
    this.active = active;
    this.hints = hints;
    if (!this.ready) return;
    for (const [id, shape] of this.shapes)
      if (!this.animating.has(id)) {
        this.dispose(shape);
        this.shapes.delete(id);
      }
    for (const arrow of this.level.arrows) {
      if (!active.includes(arrow.id) || this.animating.has(arrow.id)) continue;
      const highlighted = hints.includes(arrow.id);
      const color = highlighted ? 0x8a44d4 : 0x3c2365;
      const g = this.add.graphics();
      const drawPath = (
        target: Phaser.GameObjects.Graphics,
        width: number,
        tint: number,
        alpha: number,
        offset = 0,
      ) => {
        target.lineStyle(width, tint, alpha);
        target.beginPath();
        arrow.points.forEach(([x, y], i) =>
          i
            ? target.lineTo(this.coord(x), this.coord(y) + offset)
            : target.moveTo(this.coord(x), this.coord(y) + offset),
        );
        target.strokePath();
        target.fillStyle(tint, alpha);
        for (const [x, y] of arrow.points)
          target.fillCircle(this.coord(x), this.coord(y) + offset, width / 2);
      };
      const glow = this.add.graphics();
      if (highlighted) {
        drawPath(glow, 34, 0xc78aff, 0.4);
        if (!this.reduced)
          this.tweens.add({
            targets: glow,
            alpha: 0.25,
            yoyo: true,
            repeat: -1,
            duration: 750,
          });
      }
      drawPath(g, 23, 0x735295, 0.13, 5);
      drawPath(g, 19, color, 1);
      drawPath(g, 5, 0xdbc6ff, 0.15, -3);
      g.fillStyle(color, 1);
      const [dx, dy] = direction(arrow),
        [hx, hy] = arrow.points.at(-1)!;
      const x = this.coord(hx),
        y = this.coord(hy);
      g.fillTriangle(
        x + dx * 18,
        y + dy * 18,
        x - dx * 10 - dy * 16,
        y - dy * 10 + dx * 16,
        x - dx * 10 + dy * 16,
        y - dy * 10 - dx * 16,
      );
      const [tx, ty] = arrow.points[0];
      const label = this.add
        .text(this.coord(tx) - 17, this.coord(ty) + 14, arrow.id, {
          fontFamily: "Arial",
          fontSize: "13px",
          color: "#806997",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const group = this.add.container(0, 0, [glow, g, label]);
      this.shapes.set(arrow.id, group);
    }
  }
  animate(result: Outcome, reduced: boolean) {
    if (!this.ready || !result.exit || !result.arrowId) return;
    const id = result.arrowId,
      shape = this.shapes.get(id);
    if (!shape) return;
    this.animating.add(id);
    const arrow = this.level.arrows.find((a) => a.id === id)!;
    const [hx, hy] = arrow.points.at(-1)!;
    if (result.erased) {
      this.burst(this.coord(hx), this.coord(hy), 0xf5a4d5, 16);
      this.tweens.add({
        targets: shape,
        alpha: 0,
        duration: reduced ? 0 : 300,
        onComplete: () => {
          this.dispose(shape);
          this.shapes.delete(id);
          this.animating.delete(id);
          this.sync(this.active, this.hints);
        },
      });
      return;
    }
    if (result.exit.clear) {
      const [dx, dy] = direction(arrow);
      this.ring(this.coord(hx), this.coord(hy), 0xbc8af3);
      this.burst(this.coord(hx), this.coord(hy), 0xd9b1ff, 8);
      let lastTrail = 0;
      this.tweens.add({
        targets: shape,
        x: dx * (result.exit.distance + 2) * this.cell,
        y: dy * (result.exit.distance + 2) * this.cell,
        duration: reduced ? 0 : 360,
        ease: "Cubic.easeIn",
        onUpdate: () => {
          if (reduced || !this.rich || this.time.now - lastTrail < 90) return;
          lastTrail = this.time.now;
          const [tx, ty] = arrow.points[0],
            x = this.coord(tx) + shape.x,
            y = this.coord(ty) + shape.y;
          if (x > 25 && x < 575 && y > 25 && y < 575)
            this.burst(x, y, 0xe4c9ff, 2);
        },
        onComplete: () => {
          this.dispose(shape);
          this.shapes.delete(id);
          this.animating.delete(id);
          this.sync(this.active, this.hints);
        },
      });
    } else {
      const blocker = this.shapes.get(result.exit.blocker);
      this.ring(
        this.coord(result.exit.cell[0]),
        this.coord(result.exit.cell[1]),
        0xe76d9c,
      );
      this.tweens.add({
        targets: [shape, ...(blocker ? [blocker] : [])],
        alpha: 0.5,
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
