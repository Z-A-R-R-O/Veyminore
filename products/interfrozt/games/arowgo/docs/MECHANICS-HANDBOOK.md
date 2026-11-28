# Mechanics handbook

Current gameplay mechanics guide. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Snake movement](SNAKE-MOVEMENT.md) · [Hold preview](HOLD-PREVIEW.md) · [Keys and locks](KEYS-AND-LOCKS.md).

## 1. Overview and core rules

AROWGO is an extraction puzzle where arrows are routed off a grid board. In Story mode, players have three hearts; hitting a blocked arrow costs one heart. In Practice mode, mistakes are unlimited, but mechanic deadlines and constraints remain strictly enforced.

All mechanics evaluate removal order deterministically:
$$\text{removed} = \text{initial arrows} - \text{currently active arrows}$$

---

## 2. Snake movement (Rules Version 2)

In Rules Version 2, arrows are flexible snakes rather than rigid monolithic blocks.

### The Rule

1. The exit path originates from the **head cell** (`arrow.points.at(-1)`).
2. The exit ray extends infinitely along the head's facing direction (`direction(arrow)`).
3. If the head ray is unblocked to the board edge, the arrow exits by slithering forward: the body segments trail behind the head along the arrow's bend points.
4. Rigid translation across side obstacles does **not** block a snake arrow if its head path is clear.

### Example: Snake slither vs rigid translation

Consider a 4×4 grid with an L-shaped arrow **A** and a stationary arrow **B**:

```
Grid:
. . . .
. A1 A0 .    (A points: A2=(1,2) -> A1=(2,2) -> A0=(2,1), facing NORTH)
. A2 B  .    (B occupies (2,2))
. .  .  .
```

- **Rigid translation (Rules Version 1)**: Translating the entire shape of Arrow A upwards would sweep cell `A2` through `A1` and `B`'s column, causing a collision with side obstacles.
- **Snake movement (Rules Version 2)**: Arrow A's head at `(2,1)` faces North into row 0, which is completely empty. Arrow A slithers out Northwards; `A1` and `A2` follow the track of `A0`. The exit is **clear**.

---

## 3. Keys and locks (`requires`)

### The Rule

An arrow with `requires: "target_id"` is locked. It cannot exit until the target key arrow has been completely removed from the board.

```typescript
if (arrow.requires && active.includes(arrow.requires)) {
  return { clear: false, blocker: arrow.requires, reason: "locked" };
}
```

### Visual badge

- Locked arrow: Displays a glowing padlock badge.
- Key arrow: Displays a matching key badge.

### Example

```
Board with Arrow L (Lock) and Arrow K (Key):
L points East. K points South.
Even if L's exit ray to the East has no physical arrows blocking it:
- Tapping L while K is active: BLOCKED (costs 1 Story heart). Reason: "locked".
- Tapping K: K exits South.
- Tapping L now: L exits East cleanly.
```

---

## 4. Anchors (`anchorRequires`)

### The Rule

An anchored arrow (`anchorRequires: "anchor_id"`) is tethered to a structural anchor arrow. It cannot move until the anchor arrow is extracted.

```typescript
if (arrow.anchorRequires && active.includes(arrow.anchorRequires)) {
  return { clear: false, blocker: arrow.anchorRequires, reason: "anchored" };
}
```

### Distinction between Keys and Anchors

- **Key/Lock**: Functional security pair (one-to-one). Key arrows can exist anywhere on the board.
- **Anchor**: Structural tether. A single anchor arrow can pin multiple dependent arrows simultaneously. Rendered with an inverted gold anchor symbol.

### Example

Anchor **M** tethers arrows **D1** and **D2**. Neither **D1** nor **D2** can leave until **M** is removed, forcing the player to prioritize unblocking the anchor route first.

---

## 5. Ice seals (`thawAfter`)

### The Rule

An arrow encased in frost cannot move until a minimum number of prior arrow removals have occurred:

$$\text{removed} \ge \text{arrow.thawAfter}$$

```typescript
if (removed < (arrow.thawAfter ?? 0)) {
  return { clear: false, reason: "frozen" };
}
```

### Visual presentation

- Enclosed in a crystalline frost shell.
- Displays a numeric countdown badge showing the remaining removals required:
  $$\text{remaining} = \text{arrow.thawAfter} - \text{removed}$$
- Once the threshold is met, the ice shatters with an audio cue and the arrow becomes extractable.

---

## 6. Phase gates (`phase: 0 | 1`)

### The Rule

An arrow bound to an Aurora phase barrier can only be extracted when the current removal count matches its assigned parity (even or odd):

$$\text{removed} \pmod 2 = \text{arrow.phase}$$

```typescript
if (arrow.phase !== undefined && removed % 2 !== arrow.phase) {
  return { clear: false, reason: "phase" };
}
```

### Strategic consequence (Parity Planning)

If Arrow **P** has `phase: 1` (odd parity), but the current board has 2 removals (even parity):
- Tapping **P** immediately: BLOCKED.
- The player must intentionally locate and extract an alternate legal arrow elsewhere on the board to increment `removed` to 3, switching parity to odd and opening the phase barrier for **P**.

---

## 7. Removal countdowns / Keg deadlines (`deadline`)

### The Rule

An explosive keg arrow has a removal deadline fuse. It must be cleared from the board before the total removal count reaches its deadline:

$$\text{removed} < \text{arrow.deadline}$$

If the board reaches `removed >= arrow.deadline` while the keg arrow is still present:
$$\text{expiredKeg}() \implies \text{FAILURE (Game Over / Retry)}$$

### Critical distinction: Removals vs Wall-Clock Seconds

Mechanic countdowns count **successful arrow removals**, **never elapsed clock seconds**:
- **Blocked tap**: Does **not** advance the countdown (costs 1 Story heart instead).
- **Hint**: Does **not** advance the countdown.
- **Erase tool**: **Does** advance the removal count by 1.
- **Time Boost**: Adds 30 seconds to the level star timer; does **not** alter mechanic removal countdowns.

### Example

Arrow **K** has `deadline: 4` (must be cleared before move 4).
- Move 0: Board start.
- Move 1: Player clears Arrow A. (`removed = 1`)
- Move 2: Player clears Arrow B. (`removed = 2`)
- Move 3: Player clears Arrow K. (`removed = 3` < 4, **SUCCESS**; countdown resolved).

If the player had cleared Arrow C on Move 3 instead of K:
- `removed` reaches 4 while K is still active $\implies$ Keg explodes, puzzle fails.

---

## 8. Inspection and tools

### Hold preview (400ms neutral inspection)

- Long-pressing any arrow for 400ms enters **neutral inspection mode**.
- Visual feedback: Highlights the arrow's head cell, exit ray, and immediate obstacle (e.g., highlighting the blocking arrow or active lock/ice badge).
- Does **not** compute or reveal a winning route.
- Releasing the hold cancels inspection with zero penalty.
- Committing a move requires a separate distinct tap.

### Assistance tools

- **Hint**: Identifies a solver-safe legal arrow that can be extracted without causing an irreversible dead end or deadline failure. Free in current prototype; does not cap stars.
- **Erase**: Instantly removes any single unblocked arrow from the board. Consumes 1 removal count.
