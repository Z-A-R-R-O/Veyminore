# Execution backlog

[Index](README.md) · [Release gates](specs/quality-and-release.md)

Implementation items below are **not started**. The [build guide](build-guide.md) defines the shared architecture, save contract and first-slice evidence requirements. Owners below are roles to assign, not confirmed staff. No application implementation was performed in this documentation task.

| ID | Priority | Work / owner role | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| A01 | P0 | Define tiny rule boards / game systems | AW-001 review | 5–10 cases: each direction, bent body blocker, multiple blockers, boundary, invalid geometry |
| A02 | P0 | Prototype independent checker and domain / engineering | A01 | Deterministic path expansion, occupancy and swept checks; no UI imports |
| A03 | P0 | Demonstrate and select movement / product + engineering | A02 | Renderer matches checker; rule recorded in ADR; still-image uncertainty closed |
| A04 | P0 | Verify runtime candidates / engineering | A03 | Dated primary sources, versions and device lifecycle/performance report |
| A05 | P0 | One-level playable slice / engineering + design | A03, A04 | Load → interact → result → restart; rapid taps commit once |
| A06 | P1 | Persistence and rewards / engineering | A05 | Save migration, corrupted snapshot fallback, kill/resume and duplicate reward tests |
| A07 | P1 | Hearts, scoring, tools / product + engineering | A03, A06 | Published provisional semantics; cancel/no-charge/zero-hearts cases verified |
| A08 | P1 | Tutorial and ~10 levels / content | A03, A07 | Every board validated with no-assist solution; external rule comprehension notes |
| A09 | P1 | Home, World, Profile, Results, Settings / design + engineering | A05, A06 | Functional routes, selected-level consistency, empty/error/reset states and readable narrow layout |
| A10 | P1 | Minimal level preview and validation workflow / tools | A08 | Load, preview blockers, replay solution, export reviewed content |
| A11 | P1 | Expand to 30–40 levels / content + QA | A08, A10 | Stable IDs; per-level review record; independent replay and device review |
| A12 | P1 | Beta measurement and release readiness / QA + product | A09, A11 | Device/build report, consent/data inventory, actual publisher review, support owner, no blocking defects |
| A13 | P2 | Earned cosmetics / design | A12 | Equip persists; skin never alters hitbox or readability |
| A14 | P2 | Generator / game systems | A12 and repeat-play evidence | Versioned seed reproduction, cycle rejection, bounded fallback and human difficulty review |
| A15 | P2 | Daily and async services / backend | A14 and service owner | Canonical challenge, authenticated replay validation, idempotency and access tests |

## Evidence and release status

No gate has passed. Attach build/version, device, date, reviewer and actual results to each completed ticket. A checklist alone is not evidence. Apply only gates relevant to enabled systems: offline MVP does not require live multiplayer or billing implementation. Resolve current policy and publisher questions before public release rather than treating imported claims as clearance.
