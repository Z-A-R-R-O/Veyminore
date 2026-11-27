# AROWGO delivery plan

Updated 27 November 2026. [Current implementation](docs/CURRENT-GAME-STATE.md) · [Open gaps](docs/GAME-EXPERIENCE-GAPS.md) · [Execution backlog](docs/execution-backlog.md).

## Product

A mobile-first snake-arrow puzzle game built around readable rules and deliberate removal order. The campaign now has 180 levels across seven chapters. Difficulty must be validated with people as well as solvers. Additional arrow density alone is not a substitute for meaningful choices.

## Delivered development baseline

Campaign authoring/solver pipeline, progressively combined mechanics, neutral hold inspection, local save migration and recovery, responsive game screens, profiles and collection. Google/PlayFab identity, revisioned legacy cloud snapshots and automatic completion upload exist. A separate reviewed SQLite wallet provides authoritative development rewards/purchases and completed-level restoration.

## Delivery order

1. Fix realistic full-history cloud capacity without dropping progress, currency or recovery history.
2. Establish production account/ledger hosting, sessions, backup/restore and operating ownership.
3. Complete cross-device continuity requirements and account conflict UX.
4. Validate difficulty with human playtests and the app on physical mobile devices.
5. Complete release regression, performance, accessibility and asset/privacy review.
6. Expand skins/chests only after the proposed catalog and earning model are reviewed. Multiplayer and other live services require their own milestones.

## Architecture and release boundaries

Keep domain rules/solver independent of React/Phaser. Ship reviewed static level JSON, retain historical versions for save compatibility, and keep provider credentials server-side. Preserve legacy saves during account migration and never merge balances using max/addition or last-write-wins.

Localhost account services are not production infrastructure. Compact cloud fixtures do not prove large-history support. Automated solving does not prove fun or fairness, and browser mobile emulation does not prove native acceptance. Record each gate with dated evidence and explicit scope; [latest record](docs/AUDIT-2026-11-20.md).
