# Measurement and distribution

Imported baseline · Source masterplan 2.1 · Organized 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page preserves source sections 12, 17. Original section numbers are retained for traceability. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 12. Analytics and experiment framework

## 12.1 Event taxonomy

### Lifecycle
- `app_open`
- `session_start`
- `session_end`
- `app_crash`

### Tutorial
- `tutorial_start`
- `tutorial_step_complete`
- `tutorial_complete`
- `tutorial_skip`

### Puzzle
- `level_view`
- `level_start`
- `arrow_selected`
- `arrow_blocked`
- `arrow_removed`
- `level_complete`
- `level_restart`
- `level_exit`

### Tools
- `hint_requested`
- `hint_delivered`
- `analyze_requested`
- `analyze_delivered`
- `erase_requested`
- `erase_completed`

### Progression
- `world_open`
- `level_unlock`
- `star_awarded`
- `daily_challenge_start`
- `daily_challenge_complete`
- `endless_run_start`
- `endless_stage_complete`
- `endless_run_end`

### Collection
- `skin_preview`
- `skin_equipped`
- `skin_unlocked`
- `cosmetic_purchase`

### Multiplayer
- `challenge_created`
- `challenge_shared`
- `challenge_joined`
- `challenge_result_submitted`
- `leaderboard_view`
- `match_started`
- `match_completed`
- `match_abandoned`

### Monetization
- `rewarded_ad_offered`
- `rewarded_ad_started`
- `rewarded_ad_completed`
- `interstitial_shown`
- `purchase_started`
- `purchase_completed`
- `purchase_failed`

Do not collect unnecessary personal information. Use pseudonymous IDs and a disclosed analytics policy.

## 12.2 Initial product targets

These are initial internal hypotheses, not industry benchmarks or automatic ship/no-ship thresholds. Recalibrate them from actual cohorts and report sample size, acquisition source and measurement window.

| Metric | Initial target |
|---|---:|
| Tutorial completion | 80%+ |
| Day-1 retention | 20%+ |
| Day-7 retention | 5%+ |
| Crash-free sessions | 99.5%+ |
| Tutorial starters reaching level 5 | 50%+ |
| Generated levels passing validation | 100% |
| Ranked results accepted without replay validation | 0% |

Report cohort size and sample window alongside every retention number.

## 12.3 A/B testing

Potential experiments:

- Tutorial length.
- Heart/mistake rules.
- Hint availability.
- Board density.
- Level completion animation length.
- World page layout.
- Daily challenge placement.
- Rewarded-ad prompt timing.
- Interstitial cooldown.
- Skin unlock pacing.

Change one major variable at a time when possible. Do not declare a winner from tiny samples.

# 17. Growth and distribution system

## 17.1 Distribution principle

Do not wait until the game is finished to build distribution.

The growth lead should document real gameplay and recruit testers during development.

## 17.2 Content formats

- "Which arrow can escape first?"
- A satisfying full-board clear.
- A close-up of a tricky bend.
- A short tutorial explaining one rule.
- A daily puzzle challenge.
- A before/after difficulty comparison.
- A skin collection reveal.
- A player-versus-player challenge when multiplayer exists.

## 17.3 Content cadence hypothesis

Start with:

- Two short-form videos per day on active posting days.
- One clear hook in the first seconds.
- One puzzle per video.
- A visible AROWGO identity.
- A clear play/test invitation.
- Track views, watch time, profile visits, link clicks and installs when measurable.

Do not buy views or reviews. Do not misrepresent gameplay with impossible or edited levels.

## 17.4 Beta recruitment

Target:

- Friends and college circles.
- Casual puzzle players.
- Small gaming communities that allow beta requests.
- People who do not know the developers.

Use a feedback form that asks about:

- Rule clarity.
- First-level difficulty.
- Satisfaction of clearing an arrow.
- Confusing paths.
- Tool usefulness.
- Reason for stopping.
- Willingness to play another level.
