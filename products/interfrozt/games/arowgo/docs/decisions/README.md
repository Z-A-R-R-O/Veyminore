# Working decision register

[Index](../README.md) · [Imported decisions](../specs/source-decisions.md)

Updated 10 November 2026. “Implemented” below means repository organization only. “Provisional” is a recommended design default, not player validation or user sign-off. Source D-01–D-21 statuses remain historical; this register controls working amendments.

| ID | State | Decision / amendment | Owner | Closure evidence |
| --- | --- | --- | --- | --- |
| IF-001 | Implemented per user request | InterFrozt under products, reserved for games; AROWGO nested beneath games | Veyminore | Directory and navigation links |
| AW-001 | Validate / P0 | Whole bent path translates rigidly; animation must match swept collision | Game systems role, unassigned | Rule boards and observed prototype |
| AW-002 | Provisional | Blocked action preserves occupancy but increments attempt/mistake counters exactly once | Game systems role, unassigned | State transition tests |
| AW-003 | Provisional | Erase can remove any active arrow; confirm, spend one charge, mark assisted | Product role, unassigned | Tool state tests and playtest |
| AW-004 | Provisional | Hearts are per-level mistakes; no global 5/5 energy/refill HUD | Product/design role, unassigned | Screen consistency review |
| AW-005 | Proposed | Star experiment uses completion, mistakes and assists; successful removals are not an optimization target | Product role, unassigned | Scoring version and playtest |
| AW-006 | Provisional | MVP navigation exposes only functioning destinations; earned collection optional | Design role, unassigned | Route/state audit |
| AW-007 | Provisional | One-level slice, then tutorial alpha, then 30–40-level campaign | Delivery role, unassigned | Build evidence for each stage |
| AW-008 | Open / P0 | Framework and wrapper versions require independent verification and physical-device spike | Engineering role, unassigned | ADR with sources, versions and measurements |
| AW-009 | Deferred | Backend, online ranking, paid economy, live services | Product role, unassigned | Retention evidence plus service-specific gate |

## Additional build decisions — 2.3

| ID | State | Decision | Closure evidence |
| --- | --- | --- | --- |
| AW-010 | Provisional | One game package, web-first iteration and Android packaging during first slice | A04 device spike and package setup |
| AW-011 | Provisional | Application controller is the only state mutation entry point; UI frameworks render results | Domain isolation and lifecycle tests |
| AW-012 | Proposed | First-clear campaign reward ledger plus per-attempt completion receipts; practice has no campaign rewards | A06 crash/replay/duplicate tests and product review |
| IF-002 | Implemented | Use existing Veyminore Git repository; no nested repository for game docs | Local repository and scoped documentation commit |

## Implemented prototype ADR

[AW-013 — First playable](0001-first-playable.md) records the implemented defaults and evidence. Earlier provisional choices remain hypotheses for product/native validation; implemented behavior does not imply an external playtest has passed.

## Change procedure

Assign a named owner before a task starts. Record rationale, evidence, affected specs, rules/content version impact and review date using the [decision template](../templates/decision.md). A rule change must update collision, renderer, solver, content and tests together. Preserve superseded rationale; do not rewrite the original 2.1 source.
