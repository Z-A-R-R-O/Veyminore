# AROWGO — Masterplan 2.3

**Edition:** Build-ready documentation and consistency corrections, 10 November 2026.\
**Parent:** InterFrozt / Veyminore.\
**Status:** First browser mechanic proof and one playable level implemented; campaign and native acceptance remain pending.\
**Source:** [Original 2.1](references/AROWGO_Advanced_Masterplan_2.1.md), preserved unchanged.

## Direction

Build a calm, readable bent-arrow logic puzzle. Preserve the blossom landscapes, floating islands, lavender panels and confident purple actions from the references, while keeping dark puzzle paths crisp. Android portrait is the source plan's primary target; a web prototype is the first validation surface.

## First release boundary

The working MVP is an offline Story campaign with 30–40 reviewed levels, tutorial, practice replay, local save/resume, results, basic profile and settings. Hint, Analyze and Erase need explicit charge and assisted-result semantics. Start with Home, World and Profile navigation; Modes can be a functional Story/practice entry. A small earned cosmetic collection is optional after the campaign is stable.

Online ranking, accounts, cloud saves, procedural endless content, real-money purchases, ads, events and live multiplayer remain deferred. No empty shop or ranking tab is required merely because it appears in the concept art.

## Rule proof before production

Prototype whole-path rigid translation using integer cells and an independent swept-footprint checker. A still screenshot cannot establish how arrows move. Validate that hypothesis before making a large campaign. Rendering must demonstrate the same movement model as collision; retraction is a different mechanic until proven otherwise.

Blocked taps preserve board occupancy but may change the mistake counter. Successful removals, tool spending and rewards need atomic, replay-safe state transitions. All shipped levels must have a verified no-assist solution.

## Documents and precedence

1. The user's games-only InterFrozt organization is implemented.
2. This masterplan and the [working amendments](docs/decisions/README.md) define the proposed 2.3 baseline. They distinguish implemented organization from provisional design choices.
3. [Focused specifications](docs/README.md) cover every numbered section from 2.1; revised pages are marked with their working revision. The original remains available for historical wording. Working amendments take precedence over unrevised imported detail.
4. The original source and screenshots are immutable reference evidence. UI prices, player data, locked labels and source “Locked” statuses do not establish actual production state.

When a conflict remains unresolved, record it in the decision register; do not infer approval. Technical choices and external policy claims from 2.1 still need dated verification at implementation/release.

## Delivery sequence

| Milestone | Output | Exit evidence |
| --- | --- | --- |
| Rule proof | 5–10 tiny boards and movement demonstration | Four directions, body-only blockers, geometry rejection and explicit rule selection |
| Vertical slice | One level from entry through results and resume | No duplicate actions/rewards; touch-device observation |
| Tutorial alpha | About 10 reviewed levels | New players can explain the rule without coaching |
| Campaign MVP | 30–40 reviewed levels and functional navigation | Automated validation, device matrix, no blocking defects, save migration tested |
| Retention learning | External cohort feedback | Cohort size, return-play signal and reasons for stopping documented |
| Expansion | Generator, daily and then asynchronous competition | Relevant content/server/operations gates passed before each feature |

This reconciles the source's one-level, 10–15-level and 30–40-level targets into distinct milestones. No delivery date or team capacity is assumed.

## Build approach

Follow the [build guide](docs/build-guide.md): one game package with TypeScript rules, a Phaser board, React screens and Vite tooling, packaged with Capacitor during the first Android slice. These are spike candidates, not validated dependencies. Keep state changes in an application controller and local persistence behind an adapter. Add backend services only when a validated feature requires them.

## Current implementation

The first playable implements rigid movement, a ten-arrow level, Story/Practice, Hint, restart/results, local progression and nine interactive rule examples. See the [rule proof](docs/rule-proof.md) and [build evidence](docs/verification/first-playable.md). Android asset sync succeeds; compilation and physical-device gates remain open.

## Start here

Assign owners to the [execution backlog](docs/execution-backlog.md), review the [recommendations](docs/review-and-recommendations.md), and produce evidence for Gate A. Use the [templates and maintenance workflow](docs/maintenance.md) for future changes. The browser prototype is now implemented. Next validate the feel and actual Android behavior before expanding content.
