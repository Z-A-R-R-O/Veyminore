# Delivery phases, team and backlog

Imported baseline · Source masterplan 2.1 · Organized 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page preserves source sections 14, 15, 22, 24, 27. Original section numbers are retained for traceability. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 14. Team organization and execution model

## 14.1 Team of four

| Person | Role | Ownership |
|---|---|---|
| Founder | Product Director / Technical Lead | Product scope, code integration, AI-assisted implementation, release decisions |
| Teammate 1 | Game Systems Engineer | Path geometry, move engine, generator and solver |
| Teammate 2 | UI / Visual Designer | Level UI, menus, animations, cosmetics and assets |
| Teammate 3 | QA / Growth Lead | Device testing, tester recruitment, content and feedback analysis |

As the online backend grows, Founder and Teammate 1 share server-domain work. Do not add live multiplayer responsibilities until the core product is validated.

## 14.2 Daily rhythm

Suggested focused workday:

| Block | Work |
|---|---|
| 20 min | Stand-up and blockers |
| 2 hours | Deep implementation |
| 90 min | Assigned feature work |
| 60 min | Integration and review |
| 60 min | Testing, content or growth |
| 30 min | Commits, issue updates and plan |

Adapt around college and personal obligations. Sustainable output is more valuable than short bursts followed by burnout.

## 14.3 Daily demonstration rule

Every contributor should show one of:

- A working feature.
- A tested code change.
- A completed design asset.
- A reproducible bug report.
- A user-test observation.
- A published content experiment.

"Worked on it" is not a deliverable.

## 14.4 Git workflow

- `main` is protected.
- Feature branches use short descriptive names.
- Changes use pull requests.
- At least one review for core gameplay changes.
- CI runs lint, type-check and tests.
- Versioned level data is reviewed like code.
- No API keys, service keys or personal credentials committed.
- Tag playable builds.

## 14.5 Definition of done

A task is not done until:

- Acceptance criteria pass.
- Code/design is merged.
- Relevant tests exist.
- Device or browser behaviour is checked.
- Analytics are added only where useful.
- Documentation is updated.
- No critical regression remains.

# 15. Development roadmap and release gates

The product is developed through evidence gates, not a feature-count race. Dates are estimates only; no phase starts because a calendar date has arrived.

## Phase 0 — Rule proof and technical spike — P0

**Goal:** prove that the core puzzle rule is fun, unambiguous and technically reliable.

Deliverables:

- One-page illustrated rule contract, including blocked and clear examples.
- 5–10 hand-authored test boards that exercise every arrow direction and multiple bends.
- Whole-path rigid-translation prototype, compared against the supplied gameplay reference.
- Independent slow collision checker and optimized dependency model.
- Tests for a clear arrowhead ray but blocked path body, multiple blockers, boundary exits and simultaneous-looking touch events.
- Phaser 4.2.1 / React-shell / Capacitor 8 proof-of-concept, or a documented alternative.
- Physical-device build and touch/resize/lifecycle measurements.

**Exit gate:** team agrees on one deterministic rule; all test boards pass; no collision behaviour depends on rendered pixels.

## Phase 1 — Playable vertical slice — P0

**Goal:** one fully playable level from launch to result.

Deliverables:

- Board renderer and scaling.
- Bent-path data model and arrowhead direction.
- Clear / blocked validation and blocker feedback.
- Atomic move resolver and exit animation.
- Win and retry states.
- Restart and local save/resume.
- One tutorial level plus three varied test levels.
- Unit tests and one physical-device run.

**Exit gate:** a new tester can solve the level without developer coaching; app interruption does not corrupt the board.

## Phase 2 — Single-player MVP — P1

**Goal:** deliver a coherent, polished AROWGO experience without online or monetization dependencies.

Deliverables:

- Home, Story/World, Modes, Gameplay and Results screens.
- Profile screen with local progression and basic statistics.
- 30–40 reviewed campaign levels (not a rushed 100).
- Tutorial and gradual mechanic/difficulty introduction.
- Hearts, Hint, Analyze and Erase with documented behaviour.
- Local-first save, resume, restart and safe migration version.
- Earn-only soft coins and direct cosmetic unlocks if they do not threaten the schedule; otherwise defer the Shop transaction system and show an honest collection preview.
- Sound, haptics, reduced-motion setting and basic accessibility checks.
- Crash/error logging with privacy review; a small, documented analytics event set.
- Android test build and web prototype.

**Exit gate:** external players understand the rules, finish the onboarding, can complete a meaningful session, and do not encounter progression loss or critical device issues.

## Phase 3 — Retention and content quality — P1/P2

**Goal:** prove that players want to return before adding online features.

Deliverables:

- More curated levels, expanding toward 100 only after quality review.
- Internal level editor/previewer and automated validator.
- Human difficulty calibration and level-drop analysis.
- Cosmetics, collection and achievements.
- Improved onboarding, feedback and accessibility.
- Cohort-based D1/D7/D30 retention review with sample sizes and confidence limits noted.

**Exit gate:** more than one external cohort shows repeat play and the team can produce/validate content without rewriting the engine.

## Phase 4 — Endless generator — P2

**Goal:** generate fair and reproducible puzzles on demand.

Deliverables:

- Seeded generator and versioned rules.
- Dependency graph construction and solver.
- Difficulty bands calibrated with human testers.
- Structural fingerprint and repetition controls.
- Seed/version bug reports and replay.
- Stress tests across a large seed sample.

**Exit gate:** every delivered board is structurally valid and solvable; generation failure safely falls back to a known-good curated board; human testers confirm that difficulty bands are meaningful.

## Phase 5 — Online foundation and Daily Mode — P2

**Goal:** add shared challenge identity and cloud continuity.

Deliverables:

- Optional account linking.
- Cloud-save conflict/merge behaviour.
- Canonical daily puzzle data and timezone policy.
- Server-validated daily results.
- Minimal leaderboard/profile exposure.
- RLS, access tests, rate limits and data-deletion/support flow.

**Exit gate:** clients cannot award themselves currency or write authoritative results; offline play remains available during network failure.

## Phase 6 — Async friend challenges and monetization experiments — P2/P3

**Goal:** test social competition and a respectful economy.

Deliverables:

- Shareable challenge code/link.
- Same canonical board and rules for both players.
- Server replay validation and idempotent result submission.
- Direct cosmetic offers only; no paid random crates.
- Optional rewarded ads and/or ad-free purchase only after account eligibility and Play policy review.
- Retention and revenue experiment report.

**Exit gate:** challenge fairness is demonstrated; monetization does not materially harm completion or return rates.

## Phase 7 — Live multiplayer, tournament and scale — P3

**Goal:** operate a real-time competitive service only if asynchronous play proves demand.

Deliverables:

- Authoritative room server, matchmaking and lifecycle.
- Reconnect, timeout, latency and abuse handling.
- Server-issued match result and anti-cheat review.
- Load/soak tests, monitoring, incident and support processes.
- Tournament schedule, rules and moderation process.

**Exit gate:** stable matches under simulated latency/disconnects, plus a team that can operate and support the service.

## Release-track definition

- **Prototype:** local web build; rules and touch feel only.
- **Internal alpha:** offline campaign slice on Android; no accounts, ads or purchases.
- **External MVP beta:** curated campaign and local save; testers recruited and issues triaged.
- **Public v1:** only after store age/account eligibility, target-audience declaration, privacy, billing/ads decisions, content rating, testing and support readiness are complete.

Do not promise a ten-week public release. A ten-week schedule may be used as a planning checkpoint, but phases remain gated by evidence and actual team capacity.

# 22. Immediate execution plan

## First working session — prove the mechanic

1. Create the repository, protected `main`, issue board and a minimal CI pipeline.
2. Write the rule contract and draw 5–10 tiny boards: clear arrow, blocked arrow, body-only obstruction, multiple blockers, each of four directions and a boundary exit.
3. Implement a pure TypeScript board/path model without Phaser imports.
4. Expand compressed path waypoints into occupied cells.
5. Implement the slow whole-path swept-volume checker.
6. Write expected-result tests for every board before implementing visual polish.
7. Render one bent path and one blocked/clear interaction in the target engine.
8. Capture the prototype and have every teammate explain the same rules.

## First vertical-slice milestone

- One complete level from load to result.
- Clear and blocked interaction.
- Whole-path removal animation.
- Restart and safe resume.
- One tutorial instruction.
- Tests prove that visuals and game logic cannot disagree.

## MVP milestone

- Home, World/Story, Mode, Gameplay, Results and Profile.
- 30–40 carefully reviewed levels.
- Three tools with stable semantics.
- Hearts, local progression, soft earned currency and a small cosmetic set only if time allows.
- Physical-device testing on at least one lower/mid-range Android phone and one higher-resolution phone.
- External usability test with players who did not help build the game.

## Do not start yet

- Live multiplayer or tournaments.
- Paid crates / randomized purchases.
- Complex account profiles or open chat.
- Cloud saves before local state and conflict rules are stable.
- A large procedural content system before the core rules and curated content are validated.
- Paid user acquisition before the game shows a repeat-play signal.

## Weekly operating rhythm

Plan against actual available hours, not ideal full-time estimates. Keep one visible owner per task, one reviewer for gameplay rules, a playable build at the end of each sprint, and a short changelog. Reserve capacity for integration, testing and bug fixing; do not allocate 100% of team time to new features.

# 24. Success milestones

These are evidence milestones, not guaranteed outcomes or fixed deadlines.

| Milestone | Proof required |
|---|---|
| First 10 external players | People outside the team can launch, understand and play without developer coaching |
| First 30–40 reviewed levels | Every level has automated validation and human review |
| First 50–100 beta players | Structured feedback, device coverage and cohort retention data |
| Repeat-play signal | Players voluntarily return and complete more levels across multiple cohorts |
| First public release | Store, privacy, age/account, content rating, policy and support gates passed |
| First genuine revenue | Platform-reported proceeds reconciled with fees, refunds, taxes and actual cash received |
| Sustainable contribution | Revenue exceeds attributable operating and service costs over a defined period |

Downloads, views and gross sales alone are not product-market fit. Report cohort size, acquisition source, time window, platform deductions and actual net proceeds.

# 27. First implementation backlog

Recommended execution order. Each item should become a ticket with an owner, acceptance criteria and a test/build link.

| Order | Task | Priority | Definition of done |
|---:|---|---|---|
| 1 | Write 5–10 rule-example boards | P0 | Each expected clear/blocked outcome is documented |
| 2 | Create pure `game-domain` package | P0 | No Phaser/UI imports; deterministic unit tests run in CI |
| 3 | Implement path expansion and validation | P0 | Invalid polylines are rejected with actionable errors |
| 4 | Implement swept-volume checker | P0 | Body-only and multi-blocker cases pass |
| 5 | Implement dependency masks and solver | P0 | Solver result is replayed by independent checker |
| 6 | Build one playable Phaser scene | P0 | Tap, blocked feedback and exit work on touch device |
| 7 | Decide React shell vs Phaser-only shell | P0 | Physical-device spike report records the trade-off |
| 8 | Implement local save/resume | P1 | Force-close/background test restores the same valid state |
| 9 | Create tutorial and 10 reviewed levels | P1 | External testers complete onboarding without coaching |
| 10 | Build Home / World / Modes / Results / Profile | P1 | Screens match navigation model and have empty/loading/error states |
| 11 | Build level editor/validator | P1/P2 | Designers can preview, validate and export levels |
| 12 | Expand to 30–40 levels | P1 | Every level passes automated and human review |
| 13 | Add cosmetics and Shop | P2 | All unlocks/prices are explicit; no paid random rewards |
| 14 | Add analytics and retention report | P1 | Events have documented properties and data minimization review |
| 15 | Add daily/online services | P2 | Only after repeat-play and server-security gates pass |

## 27.1 Required artifacts per sprint

Every sprint should produce:

- A playable build or a demonstrable tool.
- Merged code/design with review.
- Automated tests for changed game rules.
- A short test note covering real-device behaviour.
- Updated product decisions where behaviour changed.
- A known-issues list with severity and owner.
