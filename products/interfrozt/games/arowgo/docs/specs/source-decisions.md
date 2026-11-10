# Imported 2.1 decisions

Imported baseline · Source masterplan 2.1 · Organized 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page preserves source sections 21. Original section numbers are retained for traceability. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 21. Product decision log

Change decisions through a written entry with date, rationale, owner and affected systems.

| ID | Decision | Status |
|---|---|---|
| D-01 | AROWGO is the working product name | Pending legal/store/domain clearance |
| D-02 | The six supplied screens define the current visual direction | Accepted as visual references |
| D-03 | Gameplay uses bent orthogonal arrow paths | Locked for prototype |
| D-04 | Path coordinates are integer board cells; points run tail-to-head | Provisional |
| D-05 | The whole path translates rigidly in the arrowhead direction | Validate against reference in Phase 0 |
| D-06 | Collision checks the entire swept footprint, not only the arrowhead ray | Provisional; P0 test |
| D-07 | Direction is derived from the final segment | Provisional |
| D-08 | Standard Story starts with three mistake hearts; blocked tap costs one | Validate with playtest |
| D-09 | Hint reveals one legal arrow; Analyze reveals all legal arrows | Provisional |
| D-10 | Erase removes a selected blocked arrow and marks the run assisted | Validate; P1 |
| D-11 | Story is the first single-player mode | Locked |
| D-12 | Endless generation comes after curated content and quality validation | Locked |
| D-13 | No paid randomized crates in first release | Locked |
| D-14 | Cosmetics do not alter rules, hitboxes or path readability | Locked |
| D-15 | Async competition precedes live multiplayer | Locked |
| D-16 | Phaser 4.2.1 is the code-first engine spike candidate | Spike required |
| D-17 | Capacitor 8.x is the Android packaging candidate | Spike required |
| D-18 | React app shell + Phaser gameplay canvas is the preferred UI split | Spike required; Phaser-only shell is fallback |
| D-19 | Supabase is the first online-backend candidate | Deferred |
| D-20 | Colyseus is a candidate for live authoritative matches | Deferred |
| D-21 | Android portrait is the primary layout target; web is a prototype target | Locked for MVP |

### Decisions that must be closed in Phase 0

1. Does the reference mechanic move the entire bent path rigidly, or does it use a different extraction rule?
2. Does collision use a one-cell footprint only, or a larger clearance envelope matching the rendered stroke width?
3. Does a blocked tap consume one heart, and does this penalty improve or harm the intended puzzle tension?
4. Does Erase remove any selected arrow, or only a selected blocked arrow? The current provisional rule allows any selected arrow and marks the level assisted.
5. What exact move/assist thresholds award one, two and three stars?
6. Are Classic and Infinity sufficiently different to justify two mode cards? Do not ship both until answered.

No level batch beyond the test set should be authored against unresolved collision semantics.
