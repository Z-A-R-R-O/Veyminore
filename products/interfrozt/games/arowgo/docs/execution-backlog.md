# Execution backlog

Updated 16 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Audit](AUDIT-2026-11-16.md) · [Account plan](BACKEND-ACCOUNT-PLAN.md). Owner labels below are responsibilities to assign, not named staff or delivery commitments.

## Implemented baseline

| Work                        | State                                                         | Remaining acceptance                                              |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Rules, controller and board | Implemented: snake rules 2, keys, anchors, deadlines          | Human comprehension and physical-device input                     |
| Campaign                    | 40 levels, content 5/8/9, staged generation and planning pass | External playtesting and per-level tuning                         |
| Local saves/rewards         | Versioned validation, migration, first-clear protection       | Native process-kill matrix; future cloud authority                |
| Hub/results/profile         | Functional responsive browser flows                           | Assistive technology and physical devices                         |
| Economy/collection          | Local gems, Time Boost, three crates, 15 skins                | Trusted backend, balance and purchase integration before payments |
| Android wrapper             | Current sync and debug assembly pass with Java 21             | Physical-device matrix, release signing and acceptance            |

## Active sequence

| ID  | Priority              | Work / owner role                                                                          | Depends on                                          | Exit evidence                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D01 | P1                    | Current documentation and audit / engineering                                              | Checkout inspection                                 | Canonical status, dated checks, classified historical docs, valid local links       |
| B01 | P0 in progress        | Account contracts/transport/capture implemented; provider spike pending / backend + native | Approved implementation scope and dev configuration | Guest + Google credential, link collision, recovery flow                            |
| B02 | P0                    | Trusted API and durable command ledger / backend                                           | B01                                                 | Authorization, sessions, idempotency, concurrency and secret isolation tests        |
| B03 | P0                    | Account UI and legacy import / client + backend                                            | B01–B02; product import policy                      | Local progress preserved; no fabricated paid entitlements or duplicated claims      |
| B04 | P0                    | Cloud sync and offline queue / client + backend                                            | B02–B03                                             | Two-device conflicts, interrupted upload, revision handling and accurate sync state |
| B05 | P0 for online economy | Server-owned rewards/chests/boosts / backend                                               | B02–B04                                             | Replay validation, unique first-clear receipts, concurrent purchase/recovery tests  |
| B06 | Release gate          | Account beta operations / engineering + product                                            | B03–B05                                             | Recovery/deletion, monitoring, support, rollback and physical-device tests          |
| Q01 | P1                    | Formatting and automation debt / engineering                                               | Current audit                                       | Explicit clean checks or documented remaining failures                              |
| Q02 | P1                    | Native/device acceptance / native + QA                                                     | Toolchain setup                                     | Signed build, resume/kill, offline, sound, keyboard/touch and performance report    |
| Q03 | P1                    | Player comprehension / design + QA                                                         | Current campaign                                    | Observed mistakes/solve times, lesson understanding and tuning decisions            |
| W03 | P2 after foundation   | Frostfall Peaks / game systems + art                                                       | Backend priority complete; mechanic prototype       | Three gate puzzles first, six representative puzzles, then 20 reviewed levels       |
| C01 | P2                    | 100-skin/five-chest collection / art + economy                                             | Trusted economy and pricing review                  | Distinct assets, readability, published odds and migration tests                    |
| L01 | Later                 | Additional providers/rankings/PGS / backend + native                                       | B06                                                 | Separate acceptance and trusted score policy                                        |
| L02 | Later                 | Daily/endless/social/multiplayer                                                           | Product and operations design                       | No placeholder feature advertised as live                                           |

No backend resources, credentials or external accounts were created by this documentation update. World 3 stays planned. Historical A01–A15 tasks are superseded by this status-based backlog rather than retained as misleading Not started entries.
