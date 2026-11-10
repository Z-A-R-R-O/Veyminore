# Product direction and scope

Working revision 2.3 · Derived from masterplan 2.1 · Updated 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page revises source sections 1, 4, 25, 28 under the working amendments. Original section numbers remain for traceability; consult the original reference for unchanged historical text. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 1. Executive direction

## 1.1 Product vision

AROWGO is a premium-feeling, easy-to-understand mobile puzzle game built around long, bent arrow paths. Players inspect a dense board, identify arrows whose exit is clear, remove them in a valid order, and gradually solve more complex arrangements.

The experience should feel:

- Soft, calm and polished.
- Immediately understandable.
- Deep enough to reward planning.
- Satisfying through movement, sound and feedback.
- Replayable through curated campaigns, daily puzzles and endless generation.
- Socially competitive without requiring real-time interaction in the first release.

## 1.2 Product pillars

| Pillar | Player promise | Business purpose |
|---|---|---|
| Puzzle | Read the board, find the safe exit, clear the paths | Core engagement |
| Progression | Move through worlds, levels, challenges and milestones | Long-term return |
| Collection | Personalize arrow appearances and trails | Cosmetic economy |
| Competition | Compare performance and challenge friends | Sharing and retention |

## 1.3 Business hypothesis

A small game can become a durable product if it combines:

1. A core puzzle loop that players genuinely enjoy.
2. A repeatable way to generate or curate good levels.
3. Reliable distribution through short-form content, communities and store discovery.
4. Respectful monetization that does not damage retention.
5. A content and live-ops system that gives players reasons to return.

The team must not assume that more features automatically produce more revenue. Retention, distribution and unit economics must be measured before scaling.

## 1.4 North-star metric

**Weekly engaged puzzle solvers:** unique players who complete at least three valid levels in a seven-day period.

Supporting metrics:

- New-player tutorial completion.
- First-session level completion.
- Day-1, Day-7 and Day-30 retention.
- Levels completed per active player.
- Endless-mode session completion.
- Daily challenge participation.
- Share-to-install conversion.
- Revenue per daily active user.
- Crash-free sessions.

Downloads and video views are acquisition signals, not proof of a healthy game.

# 4. Game modes

## 4.1 Story Mode / Campaign — P1

Story Mode is the main guided experience shown in the Modes reference. It is curated, sequential and organized into themed worlds.

Initial content target:

- Vertical slice: one complete level; tutorial alpha: about 10 reviewed levels.
- First external MVP: 30–40 curated levels that have been manually reviewed.
- Expansion target: 100 levels across five worlds after quality and retention evidence.

Do not delay the first playable build until 100 levels exist.

### Suggested world themes

| World | Name | Visual direction | Difficulty |
|---|---|---|---|
| 01 | Bloom Valley | Lavender, cherry blossom, waterfalls | Tutorial and easy |
| 02 | Azure Isles | Blue, pearl and clouds | Easy to medium |
| 03 | Rosewood Garden | Pink and violet flora | Medium |
| 04 | Twilight Labyrinth | Deep navy and lilac | Medium to hard |
| 05 | Golden Horizon | Warm gold and purple | Hard |

World themes may change scenery, ambient effects and reward styling. They must not change path contrast or collision rules.

## 4.2 Classic Mode — P2

Classic is the untimed repeat-play mode shown in the Modes reference. Before implementation, decide whether it is:

- a sequence of independent levels with no timer and no campaign unlock requirement; or
- an endless run that ends on a defined failure condition.

Do not ship both definitions under one name. The preferred first experiment is a simple endless sequence with no timer, a clear run-end rule and reproducible seeds. It must remain distinct from any future Infinity mode.

## 4.3 Daily Mode — P2

A daily puzzle uses one canonical board seed and rules/generator version per day.

- Same puzzle for all eligible players on that date.
- One clearly stated attempt policy.
- Result card and personal completion history.
- Streak tracking that does not punish timezone changes or app outages.
- Leaderboard only after server validation exists.
- A local fallback may offer a daily puzzle offline, but it must not be presented as the globally ranked puzzle unless the canonical daily data is available.

## 4.4 Time Attack — P2

Time Attack is a separate mode, not a timer added casually to Story levels.

Define before building:

- Whether the timer counts down or measures elapsed time.
- Whether the player gets one board or a sequence.
- Whether blocked moves cost time, hearts or both.
- Pause/background behaviour.
- Tie-break and result validation rules.

Campaign progression and accessibility must not depend on playing under time pressure.

## 4.5 Challenge Mode — P2

Challenge Mode uses curated objective modifiers such as a move limit, no-assist clear, fixed tool allowance or a specific board objective. Every challenge must state the objective before the player starts and provide a validated solution.

## 4.6 Multiplayer and Tournament — P3

The Modes reference shows these as locked / coming soon. Keep them visibly disabled until a real release date and server capability exist. Do not show fake queues, fake player counts or misleading unlock progress.

Build in this order: daily result validation, asynchronous friend challenge, ranked asynchronous competition, and only then live 1v1. Tournaments require a moderation, schedule, support and anti-cheat plan.

## 4.7 Infinity Mode — P3 / differentiation required

Infinity must not duplicate Classic. Keep it deferred until the team can describe a genuinely different loop, such as a high-difficulty survival run with escalating pressure and a finite failure budget. Validate the distinction with players before allocating art or engineering time.

## 4.8 Practice Mode — P1 utility

Practice is a no-pressure entry point rather than a major mode card. It should allow replay of unlocked campaign levels with relaxed mistake rules and no ranked result.

# 25. Final product doctrine

AROWGO 2.1 is not a promise to ship every advanced feature at once.

It is a plan to build the foundation correctly:

- A precise bent-path puzzle engine.
- A beautiful, readable experience consistent with the supplied Home, Modes, World, Shop, Profile and Gameplay references.
- Curated campaign progression.
- A tested solvable endless generator.
- A cosmetic collection system.
- Daily and asynchronous competition.
- Live multiplayer only when justified.
- Respectful monetization.
- Repeatable distribution and measurable retention.

The product must remain understandable and satisfying at every stage.

**Prove the movement rule. Make the puzzle satisfying. Ship a focused campaign. Prove that players return. Then expand content, competition and monetization in that order.**

---

# 28. Open risks and explicit non-goals

## 28.1 Highest-priority open risks

1. The exact bent-arrow movement rule may differ from the provisional rigid-translation interpretation.
2. The rendered stroke width may not match the logical collision width on small screens.
3. Three mistake hearts may create avoidable frustration for a calm puzzle game.
4. Erase may trivialize some levels if level difficulty and assisted scoring are not calibrated.
5. Classic and Infinity may be perceived as duplicate modes.
6. The visual mockups contain prices, crate rewards and stats that are placeholders; none are approved economy values or real player data.
7. AI-assisted asset generation may introduce inconsistent text, iconography or copyrighted similarity; all final assets require review and provenance records.
8. Current team capacity may not support simultaneous campaign, procedural generation, online services and monetization. Use the gates in Section 15.

## 28.2 Explicit non-goals for the first public-quality single-player MVP

- Real-time multiplayer, tournaments or open chat.
- User-generated levels or a public level marketplace.
- Paid random loot crates.
- Pay-to-win boosts, paid hearts or mandatory ad views.
- A complex season pass or subscription.
- Large-scale backend infrastructure before online features are needed.
- Procedural generation as a substitute for a well-designed first campaign.
- Artificial activity signals, fake leaderboard players or fake countdown offers.

The MVP succeeds when its core puzzle is understandable, fair, satisfying, technically stable and worth replaying—not when every future system is present.

---
