import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from "react";
import Phaser from "phaser";
import { roundedPath, snake, length, type Point } from "./arrowGeometry";
import {
  timingOpen,
  hasTiming,
  checkExit,
  direction,
  solve,
  type Level,
} from "../domain/rules";
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
  const press = useRef<{
    x: number;
    y: number;
    pointer: number;
    arrow?: string;
    held: boolean;
  } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const cancelPreview = () => {
    clearTimeout(holdTimer.current);
    press.current = null;
    setPreview(null);
  };
  useEffect(() => {
    cancelPreview();
  }, [level, active, disabled]);
  useEffect(() => {
    const cancel = () => cancelPreview();
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      clearTimeout(holdTimer.current);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);
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
    const scene = new PuzzleScene(level);
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
    // The responsive board can acquire its size after Phaser boots.
    const sizing = new ResizeObserver(([entry]) => {
      if (
        entry.contentRect.width > 0 &&
        entry.contentRect.height > 0 &&
        game.isBooted
      )
        game.scale.refresh();
    });
    sizing.observe(host.current!);
    const visibility = () => {
      if (document.hidden) game.loop.sleep();
      else game.loop.wake();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      sizing.disconnect();
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
  useEffect(() => {
    if (reduced || disabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let animation: Animation | undefined;
    let index = 0;
    const reset = () => {
      clearTimeout(timer);
      animation?.cancel();
      if (!document.hidden) timer = setTimeout(nudge, 20000);
    };
    const nudge = () => {
      if (document.querySelector('[role="dialog"]')) {
        reset();
        return;
      }
      const arrows =
        host.current?.parentElement?.querySelectorAll<SVGGElement>(
          "[data-arrow]",
        );
      if (arrows?.length) {
        const arrow = arrows[index++ % arrows.length];
        animation = arrow.animate(
          [
            { transform: "translateY(0)" },
            { transform: "translateY(-3px)" },
            { transform: "translateY(0)" },
          ],
          { duration: 1200, easing: "ease-in-out" },
        );
      }
      timer = setTimeout(nudge, 20000);
    };
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("keydown", reset, true);
    document.addEventListener("visibilitychange", reset);
    reset();
    return () => {
      clearTimeout(timer);
      animation?.cancel();
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("keydown", reset, true);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [level, active, reduced, disabled]);
  return (
    <div
      className="board"
      data-testid="board"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0 || disabled) return;
        if (press.current) {
          cancelPreview();
          return;
        }
        const box = e.currentTarget.getBoundingClientRect();
        const arrow = sceneRef.current?.hitTest(
          ((e.clientX - box.left) * 600) / box.width,
          ((e.clientY - box.top) * 600) / box.height,
        );
        press.current = {
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
          arrow,
          held: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        holdTimer.current = setTimeout(() => {
          if (press.current?.arrow && !latest.current.disabled) {
            press.current.held = true;
            setPreview(press.current.arrow);
          }
        }, 400);
      }}
      onPointerMove={(e) => {
        if (
          press.current &&
          Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) >
            10
        )
          cancelPreview();
      }}
      onPointerCancel={cancelPreview}
      onLostPointerCapture={cancelPreview}
      onPointerUp={(e) => {
        const start = press.current;
        cancelPreview();
        if (
          !start ||
          start.pointer !== e.pointerId ||
          start.held ||
          disabled ||
          !start.arrow
        )
          return;
        const result = onSelect(start.arrow);
        if (result) sceneRef.current?.animate(result, reduced);
      }}
    >
      <div ref={host} className="canvas-host" />
      {preview && !disabled && (
        <PathPreview level={level} active={active} id={preview} />
      )}
      <div
        className="accessible-arrows"
        role="group"
        aria-label="Puzzle arrows. Hold an arrow to preview. With keyboard, hold P to preview and press Enter to slide."
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
                aria-description={
                  a.thawAfter !== undefined
                    ? `Ice seal. ${Math.max(0, a.thawAfter - (level.arrows.length - active.length))} successful moves until thawed.`
                    : a.phase !== undefined
                      ? `Aurora gate. ${timingOpen(a, level.arrows.length - active.length) ? "Open" : "Closed"}. Toggles after each successful removal.`
                      : a.deadline !== undefined
                        ? `Powder keg. ${Math.max(0, a.deadline - (level.arrows.length - active.length))} successful moves remaining. Hold P to inspect.`
                        : a.anchorRequires && active.includes(a.anchorRequires)
                          ? "Anchored. Clear the matching anchor arrow first."
                          : a.requires && active.includes(a.requires)
                            ? "Locked. Clear its key arrow first."
                            : level.arrows.some(
                                  (other) => other.requires === a.id,
                                )
                              ? "Key arrow. Clear it to open the matching lock."
                              : undefined
                }
                disabled={disabled}
                style={{
                  left: `${(60 + (head[0] + 0.5) * cell) / 6}%`,
                  top: `${(60 + (head[1] + 0.5) * cell) / 6}%`,
                }}
                onKeyDown={(e) => {
                  if (e.key.toLowerCase() === "p" && !e.repeat) {
                    e.preventDefault();
                    setPreview(a.id);
                  }
                  if (e.key === "Escape") cancelPreview();
                }}
                onKeyUp={(e) => {
                  if (e.key.toLowerCase() === "p") cancelPreview();
                }}
                onBlur={() => setPreview(null)}
                onClick={(e) => {
                  if (e.detail !== 0 || preview) return;
                  const result = onSelect(a.id);
                  if (result) sceneRef.current?.animate(result, reduced);
                }}
              ></button>
            );
          })}
      </div>
    </div>
  );
}

class PuzzleScene extends Phaser.Scene {
  private vector!: SVGSVGElement;
  private retired = false;
  private unlockEffects = new Map<SVGGElement, ReturnType<typeof setTimeout>>();
  private clearUnlockEffects() {
    for (const [effect, timer] of this.unlockEffects) {
      clearTimeout(timer);
      effect.remove();
    }
    this.unlockEffects.clear();
  }
  private showUnlock(x: number, y: number) {
    const effect = document.createElementNS("http://www.w3.org/2000/svg", "g");
    effect.classList.add("unlock-bubble");
    effect.setAttribute("transform", `translate(${x} ${y})`);
    effect.setAttribute("pointer-events", "none");
    effect.setAttribute("role", "img");
    effect.setAttribute("aria-label", "Arrow unlocked");
    const size = Math.min(44, this.cell * 0.9);
    effect.innerHTML = `<image href="/assets/mechanics/unlocked-bubble.png" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}"/>`;
    this.vector.append(effect);
    const art = effect.firstElementChild as SVGImageElement;
    art.style.transformBox = "fill-box";
    art.style.transformOrigin = "center";
    art.style.clipPath = "circle(47% at 50% 50%)";
    if (!this.reduced)
      art.animate(
        [
          { opacity: 0, transform: "scale(.65) translateY(0)" },
          {
            opacity: 1,
            transform: "scale(1.12) translateY(-2px)",
            offset: 0.2,
          },
          { opacity: 1, transform: "scale(1) translateY(-3px)", offset: 0.55 },
          { opacity: 0, transform: "scale(1.05) translateY(-14px)" },
        ],
        { duration: 950, easing: "ease-out", fill: "forwards" },
      );
    this.unlockEffects.set(
      effect,
      setTimeout(
        () => {
          effect.remove();
          this.unlockEffects.delete(effect);
        },
        this.reduced ? 650 : 950,
      ),
    );
  }
  private blockerCue?: SVGGElement;
  private blockerTimer?: ReturnType<typeof setTimeout>;
  private clearBlockerCue() {
    clearTimeout(this.blockerTimer);
    this.blockerCue?.remove();
    this.blockerCue = undefined;
  }
  private showBlockerCue(id: string, reduced: boolean) {
    const source = this.shapes.get(id)?.getData("vector") as
      | SVGGElement
      | undefined;
    if (!source) return;
    const cue = document.createElementNS("http://www.w3.org/2000/svg", "g");
    cue.classList.add("blocker-cue");
    cue.dataset.blocker = id;
    cue.setAttribute("pointer-events", "none");
    cue.setAttribute("stroke-linecap", "round");
    cue.setAttribute("stroke-linejoin", "round");
    cue.setAttribute("aria-hidden", "true");
    for (const selector of [".arrow-body", ".arrow-head"]) {
      const path = source
        .querySelector(selector)
        ?.cloneNode(true) as SVGPathElement;
      if (!path) continue;
      path.removeAttribute("class");
      path.setAttribute("stroke", "#dc7800");
      path.setAttribute(
        "stroke-width",
        selector === ".arrow-body" ? "26" : "8",
      );
      path.setAttribute(
        "fill",
        selector === ".arrow-body" ? "none" : "#dc7800",
      );
      cue.append(path);
    }
    // Outline the whole obstacle without hiding its original silhouette.
    this.vector.prepend(cue);
    this.blockerCue = cue;
    if (!reduced)
      cue.animate(
        [{ opacity: 0.35 }, { opacity: 1 }, { opacity: 0.65 }, { opacity: 1 }],
        { duration: 600, easing: "ease-in-out" },
      );
    this.blockerTimer = setTimeout(() => this.clearBlockerCue(), 1400);
  }
  retire() {
    this.retired = true;
    this.clearUnlockEffects();
    this.clearBlockerCue();
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
  constructor(private level: Level) {
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
  hitTest(x: number, y: number) {
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
    return nearest;
  }
  private coord(n: number) {
    return 60 + (n + 0.5) * this.cell;
  }
  setMotion(reduced: boolean, rich: boolean) {
    if (this.reduced === reduced && this.rich === rich) return;
    this.reduced = reduced;
    this.rich = rich;
    this.clearUnlockEffects();
    this.clearBlockerCue();
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
    const previousActive = this.active;
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
      this.drawVector(element, points);
      const isKey = this.level.arrows.some(
        (other) => other.requires === arrow.id,
      );
      const locked = arrow.requires && active.includes(arrow.requires);
      const justUnlocked =
        arrow.requires && !locked && previousActive.includes(arrow.requires);
      if (justUnlocked) this.showUnlock(points[0][0], points[0][1]);
      if (isKey || locked) {
        const badge = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        badge.classList.add("mechanic-badge");
        badge.dataset.kind = isKey ? "key" : "lock";
        badge.setAttribute(
          "transform",
          `translate(${points[0][0]} ${points[0][1]})`,
        );
        // A compact socket fits inside one grid cell and keeps the arrow head visible.
        const diameter = Math.min(36, this.cell * 0.75);
        badge.setAttribute("data-size", String(diameter));
        badge.setAttribute("pointer-events", "none");
        badge.innerHTML = `<g transform="scale(${diameter / 36})">
          <circle cx="0" cy="1.5" r="17" fill="#503067" opacity=".16"/>
          <circle r="16" fill="#fff4d5" stroke="#9b6418" stroke-width="1.5"/>
          <circle r="13.5" fill="#f8d779" stroke="#fff9e8" stroke-width="1.5"/>
          ${
            isKey
              ? '<g transform="rotate(-35)"><circle cx="-5" cy="-3" r="4.5" fill="#fff7dd" stroke="#805019" stroke-width="2.7"/><path d="M-1-3H9M5-3V2M9-3V1" fill="none" stroke="#805019" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>'
              : '<path d="M-6-1V-5a6 6 0 0 1 12 0v4" fill="none" stroke="#674080" stroke-width="3.5"/><rect x="-9" y="-2" width="18" height="13" rx="4" fill="#7946ae" stroke="#4c256b" stroke-width="1.5"/><path d="M-6 1H5" stroke="#bd8de4" stroke-width="2" stroke-linecap="round"/><circle cy="4" r="2" fill="#fff0ac"/><path d="M0 5v3" stroke="#fff0ac" stroke-width="2"/>'
          }
        </g>`;
        element.appendChild(badge);
      }
      const isAnchor = this.level.arrows.some(
        (other) => other.anchorRequires === arrow.id,
      );
      const anchored =
        arrow.anchorRequires && active.includes(arrow.anchorRequires);
      if (arrow.thawAfter !== undefined || arrow.phase !== undefined) {
        const badge = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        const removed = this.level.arrows.length - active.length,
          open = timingOpen(arrow, removed);
        badge.classList.add("timing-badge");
        badge.dataset.kind = arrow.phase !== undefined ? "aurora" : "ice";
        badge.dataset.open = String(open);
        badge.setAttribute(
          "transform",
          `translate(${points[0][0]} ${points[0][1]})`,
        );
        const symbol =
          arrow.phase !== undefined
            ? arrow.phase === 0
              ? "☀"
              : "☾"
            : open
              ? "❄"
              : String(arrow.thawAfter! - removed);
        badge.innerHTML = `<circle r="21" fill="${open ? "#c9ffe8" : "#d8eaff"}" stroke="${open ? "#168060" : "#6562bb"}" stroke-width="3"/><circle r="17" fill="none" stroke="#fff" opacity=".7"/><text text-anchor="middle" y="8" font-family="Arial" font-weight="bold" font-size="25" fill="${open ? "#086148" : "#42417f"}">${symbol}</text>`;
        element.append(badge);
      }
      if (isAnchor || anchored || arrow.deadline !== undefined) {
        const badge = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        badge.classList.add("cove-mechanic");
        badge.dataset.kind =
          arrow.deadline !== undefined
            ? "keg"
            : anchored
              ? "anchored"
              : "anchor";
        // Compact tail attachments keep the arrow direction visible.
        badge.setAttribute(
          "transform",
          `translate(${points[0][0]} ${points[0][1]})`,
        );
        const remaining =
          arrow.deadline !== undefined
            ? arrow.deadline - (this.level.arrows.length - active.length)
            : 0;
        badge.innerHTML =
          arrow.deadline !== undefined
            ? `<g class="countdown-badge" data-urgent="${remaining <= 3}">
                <circle class="countdown-aura" r="25" fill="${remaining <= 3 ? '#ff647c' : '#ffc35c'}" opacity=".16"/>
                <circle cy="2" r="22" fill="${remaining <= 3 ? '#802341' : '#925020'}"/>
                <circle r="21" fill="${remaining <= 3 ? '#f0617e' : '#ffcc76'}" stroke="#fff7df" stroke-width="1.5"/>
                <circle r="17.5" fill="${remaining <= 3 ? '#c12d53' : '#b96320'}"/>
                <path d="M-14-7Q0-20 14-7Q8-15 0-15Q-8-15-14-7" fill="#fff" opacity=".45"/>
                <circle r="19" fill="none" stroke="${remaining <= 3 ? '#ffb2c0' : '#ffe8ad'}" stroke-width="2.5" stroke-dasharray="${Math.max(0, Math.min(1, remaining / arrow.deadline!)) * 119.4} 119.4" transform="rotate(-90)" stroke-linecap="round"/>
                <text text-anchor="middle" dominant-baseline="central" y="1" font-family="Arial, sans-serif" font-size="${remaining >= 10 ? 23 : 28}" font-weight="900" fill="#fffdf5" stroke="${remaining <= 3 ? '#8b173a' : '#844217'}" stroke-width="1" paint-order="stroke">${Math.max(0, remaining)}</text>
              </g>`
            : `<circle r="17" fill="${anchored ? "#e3e9e7" : "#fff0ae"}" stroke="${anchored ? "#708780" : "#bd821f"}" stroke-width="2.5"/><g class="anchor-symbol" transform="rotate(${anchored ? 0 : 180})" stroke="${anchored ? "#526c64" : "#875215"}"><circle cy="-8" r="3" fill="none" stroke-width="2.5"/><path d="M0-5V11M-6-1H6M-10 4Q-10 12 0 12Q10 12 10 4M-10 4l-2 5M10 4l2 5" fill="none" stroke-width="3" stroke-linecap="round"/></g>`;
        element.append(badge);
      }
      if (highlighted && !this.reduced) {
        const tip = points.at(-1)!;
        const spark = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        spark.setAttribute("cx", String(tip[0]));
        spark.setAttribute("cy", String(tip[1]));
        spark.setAttribute("r", "22");
        spark.setAttribute("fill", "none");
        spark.setAttribute("stroke", "#e6ae4f");
        spark.setAttribute("stroke-width", "2.5");
        spark.classList.add("hint-spark", "hint-beacon");
        element.appendChild(spark);
        const breath = { radius: 22, opacity: 1 };
        group.setData("travel", breath);
        this.tweens.add({
          targets: breath,
          radius: 38,
          opacity: 0.15,
          duration: 1100,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
          onUpdate: () => {
            spark.setAttribute("r", String(breath.radius));
            spark.setAttribute("opacity", String(breath.opacity));
          },
        });
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
  private drawVector(element: SVGGElement, points: Point[]) {
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
    text.textContent = "";
    text.setAttribute("x", String(points[0][0] - 17));
    text.setAttribute("y", String(points[0][1] + 19));
  }
  animate(result: Outcome, reduced: boolean) {
    if (!this.ready || !result.exit || !result.arrowId) return;
    this.clearBlockerCue();
    const id = result.arrowId,
      shape = this.shapes.get(id);
    if (!shape) return;
    const previousTravel = shape.getData("travel");
    if (previousTravel) this.tweens.killTweensOf(previousTravel);
    (shape.getData("vector") as SVGGElement)
      .querySelector(".hint-spark")
      ?.remove();
    this.animating.add(id);
    if (result.exit.clear || result.erased)
      (shape.getData("vector") as SVGGElement)
        .querySelectorAll(".mechanic-badge, .cove-mechanic, .timing-badge")
        .forEach((badge) => badge.remove());
    const arrow = this.level.arrows.find((a) => a.id === id)!;
    const [hx, hy] = arrow.points.at(-1)!;
    if (result.erased) {
      const element = shape.getData("vector") as SVGGElement;
      const body = element.querySelector(".arrow-body") as SVGPathElement;
      const total = body.getTotalLength();
      const wipe = { progress: 0 };
      shape.setData("travel", wipe);
      element.dataset.motion = "erase";
      element.querySelector("text")!.textContent = "";
      const paths = [
        ...element.querySelectorAll<SVGPathElement>("path:not(.arrow-head)"),
      ];
      paths.forEach((path) =>
        path.setAttribute("stroke-dasharray", `${total} ${total}`),
      );
      this.burst(this.coord(hx), this.coord(hy), 0xf5a4d5, 12);
      this.tweens.add({
        targets: wipe,
        progress: 1,
        duration: reduced ? 0 : 460,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          paths.forEach((path) =>
            path.setAttribute(
              "stroke-dashoffset",
              String(total * wipe.progress),
            ),
          );
          element
            .querySelector(".arrow-head")!
            .setAttribute("opacity", String(1 - wipe.progress));
        },
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
      this.showBlockerCue(blocked.blocker, reduced);
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
      const guide = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      if (this.level.rulesVersion === 2 && !blocked.reason) {
        guide.setAttribute(
          "d",
          `M ${this.coord(hx)} ${this.coord(hy)} L ${this.coord(blocked.cell[0])} ${this.coord(blocked.cell[1])}`,
        );
        guide.setAttribute("fill", "none");
        guide.setAttribute("stroke", "#d35383");
        guide.setAttribute("stroke-width", "4");
        guide.setAttribute("stroke-dasharray", "6 7");
        guide.setAttribute("opacity", ".7");
        guide.classList.add("blocked-path-guide");
        this.vector.prepend(guide);
      }
      const settle = () => {
        guide.remove();
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
      const points: Point[] = arrow.points.map(([x, y]) => [
        this.coord(x),
        this.coord(y),
      ]);
      const travel = { distance: 0 };
      shape.setData("travel", travel);
      const redraw = () =>
        this.drawVector(
          element,
          this.level.rulesVersion === 2
            ? snake(points, travel.distance)
            : points.map(([x, y]) => [
                x + dx * travel.distance,
                y + dy * travel.distance,
              ]),
        );
      element.dataset.motion = "blocked";
      if (blocker) this.animating.add(blocked.blocker);
      this.tweens.add({
        targets: travel,
        distance,
        onUpdate: redraw,
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
            targets: travel,
            distance: 0,
            onUpdate: redraw,
            duration: 360,
            ease: "Cubic.easeOut",
            onComplete: settle,
          });
        },
      });
    }
  }
}

function PathPreview({
  level,
  active,
  id,
}: {
  level: Level;
  active: string[];
  id: string;
}) {
  const arrow = level.arrows.find((a) => a.id === id)!;
  const exit = checkExit(level, active, id),
    [dx, dy] = direction(arrow);
  const cell = 480 / level.board.columns,
    coord = (n: number) => 60 + (n + 0.5) * cell;
  const head = arrow.points.at(-1)!,
    x = coord(head[0]),
    y = coord(head[1]);
  const target = exit.clear
    ? [dx > 0 ? 590 : dx < 0 ? 10 : x, dy > 0 ? 590 : dy < 0 ? 10 : y]
    : exit.reason
      ? null
      : [coord(exit.cell[0]), coord(exit.cell[1])];
  const blocker = !exit.clear
    ? level.arrows.find((a) => a.id === exit.blocker)
    : undefined;
  const message = exit.clear
    ? hasTiming(level) &&
      !solve(
        level,
        active.filter((a) => a !== id),
      )
      ? "Clear path, but no winning route remains after this move."
      : "Clear path. Release, then tap to move."
    : exit.reason === "frozen"
      ? "Clear other arrows to thaw this ice seal."
      : exit.reason === "phase"
        ? "Gate closed. Clear one other arrow to switch the aurora."
        : exit.reason === "anchored"
          ? "Clear the highlighted anchor first."
          : exit.reason === "locked"
            ? "Clear the highlighted key first."
            : "This arrow blocks the path.";
  return (
    <>
      <svg className="path-preview" viewBox="0 0 600 600" aria-hidden="true">
        <path
          d={roundedPath(
            arrow.points.map(([a, b]) => [coord(a), coord(b)] as Point),
          )}
          fill="none"
          stroke="#439dca"
          strokeWidth="25"
          opacity=".35"
          strokeLinecap="round"
        />
        {target && (
          <path
            d={`M ${x} ${y} L ${target[0]} ${target[1]}`}
            fill="none"
            stroke={exit.clear ? "#25896b" : "#ca6a31"}
            strokeWidth="5"
            strokeDasharray="7 7"
            strokeLinecap="round"
          />
        )}
        {blocker && (
          <path
            d={roundedPath(
              blocker.points.map(([a, b]) => [coord(a), coord(b)] as Point),
            )}
            fill="none"
            stroke="#e1a630"
            strokeWidth="27"
            opacity=".65"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="path-preview-label" role="status">
        {message}
      </div>
    </>
  );
}
