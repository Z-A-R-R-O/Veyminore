# Working decision register

Updated 16 November 2026. Implemented means visible in this checkout; it does not imply public-release or human-playtest acceptance. [Current state](../CURRENT-GAME-STATE.md) · [Backlog](../execution-backlog.md).

| ID         | State                         | Decision / current interpretation                                                      | Evidence                                                      |
| ---------- | ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| IF-001/002 | Implemented                   | AROWGO is an InterFrozt game inside the existing Veyminore repository                  | Repository layout                                             |
| AW-001     | Superseded                    | Original rigid movement hypothesis replaced by snake head-ray rules 2                  | SNAKE-MOVEMENT.md and rules.ts                                |
| AW-002     | Implemented                   | Blocked taps preserve occupancy and count one mistake                                  | Session/rules tests                                           |
| AW-003     | Implemented prototype         | Confirmed Erase is free, assisted, and counts a removal for deadlines                  | App/session/tool tests                                        |
| AW-004     | Implemented                   | Per-attempt three Story hearts, unlimited Practice mistakes                            | Session tests                                                 |
| AW-005     | Implemented, tuning open      | Completion, accuracy and speed stars; assistance does not cap stars                    | Scoring tests                                                 |
| AW-006/007 | Implemented browser scope     | Functional hub and forty-level campaign                                                | Campaign/browser evidence                                     |
| AW-008/010 | Partial                       | React/Phaser/Vite/Capacitor stack installed; native acceptance open                    | package.json, audit                                           |
| AW-009     | Reprioritized                 | Accounts/cloud/backend now next; online features still absent                          | BACKEND-ACCOUNT-PLAN.md                                       |
| AW-011/012 | Implemented locally           | Controller transitions, versioned saves and first-clear claims                         | Controller/save/reward tests                                  |
| AW-013     | Historical                    | First-playable defaults describe the earlier slice                                     | [Original ADR](0001-first-playable.md)                        |
| AW-014     | Implemented                   | Content-9 planning from Level 10, two barrels from 25                                  | PLANNING-DIFFICULTY.md                                        |
| AW-015     | Proposed architecture         | Retain client stack; PlayFab identity/Economy v2 plus trusted API and durable receipts | BACKEND-ACCOUNT-PLAN.md; no provisioning                      |
| AW-016     | Open before import            | Preserve legacy local progress without asserting local gems are paid purchases         | Product import allowance and conflict policy required         |
| AW-017     | Planned, deferred by priority | Frostfall Peaks 41–60, crystal gates and frost seals                                   | FROSTFALL-PEAKS-PLAN.md                                       |
| AW-018     | Planned                       | Five chest tiers, Ethereal and 100 skins                                               | CHEST-AND-SKIN-LAUNCH-PLAN.md; current three crates unchanged |

Provider hosting, database, budget, release owner and import allowances remain decisions for implementation. Record source, evidence, versions and migration effects when changing rules. Preserve original references and dated verification; do not rewrite historical passing counts as current results.
