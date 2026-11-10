import { useEffect, useRef, useImperativeHandle, type Ref } from "react";
import Phaser from "phaser";
import { snake, roundedPath, length, type Point } from "./arrowGeometry";
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
      scene.retire();
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
  private vector!: SVGSVGElement;
  private retired = false;
  retire() {
    this.retired = true;
    this.vector?.remove();
  }
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
    if (this.retired) return;
    this.ready = true;
    this.vector = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.vector.setAttribute("viewBox", "0 0 600 600");
    this.vector.setAttribute("aria-hidden", "true");
    this.vector.classList.add("vector-arrows");
    // React hot reload can leave DOM owned by an older Phaser scene behind.
    // The current host owns exactly one vector layer, independent of old cleanup code.
    this.game.canvas
      .parentElement!.querySelectorAll(".vector-arrows")
      .forEach((layer) => layer.remove());
    this.game.canvas.parentElement!.appendChild(this.vector);
    this.events.once("shutdown", () => this.vector.remove());
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
    this.tweens.killTweensOf(
      [
        shape,
        ...shape.list,
        shape.getData("pulse"),
        shape.getData("travel"),
      ].filter(Boolean),
    );
    (shape.getData("vector") as SVGGElement | undefined)?.remove();
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
      const group = this.add.container(0, 0);
      const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g",
      );
      element.dataset.arrow = arrow.id;
      element.innerHTML = `<path class="arrow-halo" fill="none" stroke="#c78aff" stroke-width="32" opacity="${highlighted ? 0.32 : 0}"/><path class="arrow-shadow" fill="none" stroke="#735295" stroke-width="21" opacity=".14" transform="translate(0 4)"/><path class="arrow-body" fill="none" stroke="${highlighted ? "#914bd0" : "#422563"}" stroke-width="18"/><path class="arrow-sheen" fill="none" stroke="#ddcaff" stroke-width="3" opacity=".24" transform="translate(-1 -2)"/><path class="arrow-head" fill="${highlighted ? "#914bd0" : "#422563"}" stroke="${highlighted ? "#914bd0" : "#422563"}" stroke-width="3"/><text font-family="Arial" font-size="12" fill="#806997" text-anchor="middle"></text>`;
      element.querySelectorAll("path").forEach((path) => {
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
      });
      group.setData("vector", element);
      this.vector.appendChild(element);
      const points: Point[] = arrow.points.map(([x, y]) => [
        this.coord(x),
        this.coord(y),
      ]);
      this.drawVector(element, points, arrow.id);
      if (highlighted && !this.reduced) {
        const halo = element.querySelector(".arrow-halo")!;
        const pulse = { alpha: 0.32 };
        group.setData("pulse", pulse);
        this.tweens.add({
          targets: pulse,
          alpha: 0.12,
          yoyo: true,
          repeat: -1,
          duration: 750,
          onUpdate: () => halo.setAttribute("opacity", String(pulse.alpha)),
        });
      }
      this.shapes.set(arrow.id, group);
    }
  }
  update() {
    for (const shape of this.shapes.values()) {
      const element = shape.getData("vector") as SVGGElement;
      element.setAttribute("opacity", String(shape.alpha));
      element.setAttribute("transform", `translate(${shape.x} ${shape.y})`);
    }
  }
  private drawVector(element: SVGGElement, points: Point[], label = "") {
    const d = roundedPath(points);
    for (const selector of [
      ".arrow-halo",
      ".arrow-shadow",
      ".arrow-body",
      ".arrow-sheen",
    ])
      element.querySelector(selector)!.setAttribute("d", d);
    const [x, y] = points.at(-1)!,
      [px, py] = points.at(-2)!;
    const angle = (Math.atan2(y - py, x - px) * 180) / Math.PI;
    const head = element.querySelector(".arrow-head")!;
    head.setAttribute(
      "d",
      "M 16 0 Q 18 0 15 -2 L -8 -13 Q -11 -15 -10 -11 L -6 0 L -10 11 Q -11 15 -8 13 L 15 2 Q 18 0 16 0 Z",
    );
    head.setAttribute("transform", `translate(${x} ${y}) rotate(${angle})`);
    const text = element.querySelector("text")!;
    text.textContent = label;
    text.setAttribute("x", String(points[0][0] - 17));
    text.setAttribute("y", String(points[0][1] + 19));
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
      const points: Point[] = arrow.points.map(([x, y]) => [
        this.coord(x),
        this.coord(y),
      ]);
      const element = shape.getData("vector") as SVGGElement;
      const travel = { distance: 0 };
      shape.setData("travel", travel);
      element.dataset.motion = "snake";
      const [dx, dy] = direction(arrow);
      const head = points.at(-1)!;
      const boundary =
        dx > 0
          ? 640 - head[0]
          : dx < 0
            ? head[0] + 40
            : dy > 0
              ? 640 - head[1]
              : head[1] + 40;
      const finish = () => {
        this.dispose(shape);
        this.shapes.delete(id);
        this.animating.delete(id);
        this.sync(this.active, this.hints);
      };
      if (reduced) {
        finish();
        return;
      }
      this.ring(this.coord(hx), this.coord(hy), 0xbc8af3);
      this.burst(this.coord(hx), this.coord(hy), 0xd9b1ff, 6);
      this.tweens.add({
        targets: travel,
        distance: length(points) + boundary,
        duration: 620,
        ease: "Sine.easeInOut",
        onUpdate: () =>
          this.drawVector(element, snake(points, travel.distance)),
        onComplete: finish,
      });
    } else {
      const blocked = result.exit;
      const blocker = this.shapes.get(blocked.blocker);
      const element = shape.getData("vector") as SVGGElement;
      const [dx, dy] = direction(arrow);
      // Stop the visible stroke/head just before contact, not at overlapping centers.
      const movingHead =
        hx === blocked.cell[0] - dx * blocked.step &&
        hy === blocked.cell[1] - dy * blocked.step;
      const blockerHead = this.level.arrows
        .find((a) => a.id === blocked.blocker)!
        .points.at(-1)!;
      const hitsHead =
        blockerHead[0] === blocked.cell[0] &&
        blockerHead[1] === blocked.cell[1];
      const clearance = (movingHead ? 19 : 10) + (hitsHead ? 19 : 10) + 2;
      const distance = Math.max(0, blocked.step * this.cell - clearance);
      const settle = () => {
        shape.setPosition(0, 0).setAlpha(1);
        blocker?.setAlpha(1);
        this.animating.delete(id);
        this.animating.delete(blocked.blocker);
        this.sync(this.active, this.hints);
      };
      if (reduced) {
        settle();
        return;
      }
      element.dataset.motion = "blocked";
      if (blocker) this.animating.add(blocked.blocker);
      this.tweens.add({
        targets: shape,
        x: dx * distance,
        y: dy * distance,
        duration: 200,
        ease: "Sine.easeInOut",
        onComplete: () => {
          this.ring(
            this.coord(blocked.cell[0]),
            this.coord(blocked.cell[1]),
            0xe76d9c,
          );
          if (blocker)
            this.tweens.add({
              targets: blocker,
              alpha: 0.55,
              duration: 90,
              yoyo: true,
              ease: "Sine.easeInOut",
            });
          this.tweens.add({
            targets: shape,
            x: 0,
            y: 0,
            duration: 360,
            ease: "Cubic.easeOut",
            onComplete: settle,
          });
        },
      });
    }
  }
}
