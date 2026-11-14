# AW-013 — First playable implementation

Status: Implemented for prototype; user feel validation and native acceptance remain open. Date: 10 November 2026. Implementation: Codex under the user's request to build the mechanic proof and one level. Product acceptance owner: user / Veyminore.

## Decisions

- Use the provisional rigid whole-path rule with integer geometry and derived head direction. Render translation, not retraction. Keep the slow swept checker and independent dependency solver.
- Build one package in the Veyminore workspace using the stack recorded in `package.json`. Phaser draws the board; React handles screens and keyboard controls. A DOM pointer bridge performs continuous nearest-segment hit testing in scene coordinates to avoid dropping the first pointer action during engine boot.
- Use a single localStorage snapshot for the prototype's small state. An atomic key replacement holds action outcome, completion and first-clear reward together. Retain one previous valid checkpoint and report recovery or write failure. Revisit IndexedDB when content/history size warrants it.
- Story permits three blocked attempts; Practice permits unlimited mistakes and awards no campaign rewards. Hint is free/unlimited and marks the attempt assisted. Other tools remain deferred.
- Story stars are 3 for unassisted zero mistakes, 2 for unassisted one mistake, otherwise 1 on completion. The first Story clear grants 25 prototype coins, once per level. These are testable balancing defaults, not approved production economy values.
- Briefly gate Story input for feedback; deduplicate domain commands and reject stale attempt IDs separately. Reward/state commits occur before animation, so animation interruption cannot issue a second reward.

## Evidence and consequences

See the [rule proof](../rule-proof.md) and [verification report](../verification/first-playable.md). The original screenshot cannot determine movement semantics. Keep this as a prototype decision until the user reviews Rule lab and actual play. Do not produce a campaign against an unaccepted movement change.

The generated Android project and asset sync exist. Native compilation is blocked by missing Java, and real-device testing is outstanding. No broader release gate is marked complete by this ADR.
