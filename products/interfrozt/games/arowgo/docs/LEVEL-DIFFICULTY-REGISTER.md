# Level difficulty register (100 campaign levels)

Current level register and measurements. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Sanctum](AMBER-SANCTUM.md) · [Dense campaign](DENSE-CAMPAIGN.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## 1. Campaign summary

The AROWGO campaign contains 100 canonical levels divided into five thematic worlds of 20 levels each. All levels are statically defined in `content/levels/` and referenced by `src/domain/campaign.ts`.

- **Total Campaign Levels**: 100
- **Total Available Stars**: 300 (up to 3 stars per level)
- **First-Clear Coins**: 2,500 total (25 coins awarded once per level on first clear)
- **Rules Version**: Version 2 (Snake-movement exit rules)

---

## 2. World breakdown and mechanic progression

| Chapter | World Name | Levels | Grid | Arrows | Primary Mechanics | Content Ver |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Bloom Valley** | 1–20 | 6×6 to 8×8 | 4–20 | Straight & bent snakes; Keys & Locks (Lv 11, 14, 17, 19, 20) | 1, 4, 9 |
| 2 | **Verdant Cove** | 21–40 | 8×8 to 10×10 | 18–24 | Structural Anchors (`anchorRequires`) + Keys | 7, 11 |
| 3 | **Frostfall Peaks** | 41–60 | 10×10 | 22–26 | Ice Seals (`thawAfter`), Phase Gates (`phase`), Deadlines (`deadline`) | 10, 11 |
| 4 | **Amber Dunes** | 61–80 | 10×10 | 24–28 | Dense blocking networks, multi-anchor keys, parity gates | 11, 12 |
| 5 | **Amber Sanctum** | 81–100 | 10×10 | 28 | Combined mechanics (Keys, Anchors, Ice, Phase, Deadlines) | 12 |

---

## 3. Structural metrics across campaign chapters

### Chapter 1: Bloom Valley (Levels 1–20)

- **Onboarding (Levels 1–5)**: Handcrafted tutorials introducing snake direction, head ray exits, and non-blocking body slithers. 4 to 8 arrows. Difficulty score: 25–45. Random legal win rate: >95%.
- **Progression (Levels 6–10)**: Generated candidates with 11–15 arrows, scores 59–91. Teaches comparing bent footprints and working through multi-arrow dependencies.
- **Keys Introduction (Levels 11–20)**: First encounter with `requires` padlock/key mechanic on Levels 11, 14, 17, 19, and 20. 16–20 arrows, scores 91–125.

### Chapter 2: Verdant Cove (Levels 21–40)

- Introduces **Structural Anchors** (`anchorRequires`) identified by the inverted gold anchor symbol.
- Levels 21–30: Single anchor pinning 1–2 dependent arrows. Arrow counts 18–22. Depth 8–14.
- Levels 31–40: Density pass (content 11). Multi-anchor chains where freeing an anchor requires coordinating key collection first. Score: 140–190.

### Chapter 3: Frostfall Peaks (Levels 41–60)

- Introduces timing mechanics:
  - **Ice Seals** (`thawAfter`): Frozen until a specific removal threshold is reached.
  - **Phase Gates** (`phase`): Parity-based gates alternating every removal.
  - **Removal Deadlines / Keg Countdowns** (`deadline`): Explosive fuses counting successful removals.
- Arrow count: 22–26. Graph scores: 185–240. Random legal win rate drops to 10%–25%.

### Chapter 4: Amber Dunes (Levels 61–80)

- Hardening and densification pass (content 11/12).
- Arrow count: 24–28. Occupied cells: 55–65 on 10×10 boards.
- Heavy branching: initial legal choices range from 3 to 6, but premature extraction leads to frozen locks or missed deadlines. Random legal win rate: 2%–8%.

### Chapter 5: Amber Sanctum (Levels 81–100)

- Climax world: exactly 28 arrows per level on 10×10 boards, minimum 68 occupied cells.
- Content Version: 12. Target graph scores: 260 to 380.
- Strict monotonic decrease in random legal win rate:
  - Level 81: Win rate ~1.8%
  - Level 90: Win rate ~0.45%
  - Level 99: Win rate ~0.08%
  - Level 100 (Finale): Win rate <0.02%
- Full mechanic synthesis: boards require synchronizing key collection, melting ice barriers, calculating phase parity, clearing anchor tethers, and racing against removal deadlines before unlocking the finale celebration.

---

## 4. Human playtest findings and open validation gaps

While algorithmic solvers confirm that all 100 levels have valid, complete, and replayable solutions:

1. **Cognitive Load & Readability**:
   - On dense 28-arrow boards (Levels 81–100), arrow bodies frequently turn multiple times. On mobile phone viewports (390×844), identifying head rays amidst overlapping bodies requires hold inspection.
2. **Level 100 Difficulty Jump**:
   - The drop in random legal win rate (<0.02%) makes unassisted clearing very demanding. Human playtesting is required to determine whether this creates satisfying triumph or player attrition.
3. **Erase Tool Strategy**:
   - Erase increments the removal count, which can strategically thaw an ice seal or change phase parity without removing a required prerequisite arrow. This interaction needs further player observation.
4. **Physical Device Verification Needed**:
   - Tap targets on 10×10 boards must be playtested on physical Android devices to measure mis-tap rates.
