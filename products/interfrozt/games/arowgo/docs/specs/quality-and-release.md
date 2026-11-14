# Quality, acceptance and release operations

Working revision 2.3 · Derived from masterplan 2.1 · Updated 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page revises source sections 13, 23, 26 under the working amendments. Original section numbers remain for traceability; consult the original reference for unchanged historical text. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 13. QA, security and performance

## 13.1 Game-logic tests

Minimum automated cases:

- Straight path.
- One-bend path.
- Multi-bend path.
- Arrow facing each direction.
- Fully clear swept path.
- Arrowhead ray clear but bent body blocked.
- Swept path blocked by one arrow.
- Swept path blocked by multiple arrows.
- Blocker located near the final exit step.
- Dependency masks agree with the independent swept-volume checker.
- Path near each board boundary.
- Invalid path geometry.
- Self-intersection.
- Duplicate segment occupancy.
- Valid move updates state exactly once.
- Blocked move leaves board occupancy unchanged; permitted attempt/mistake counters update once.
- Final arrow triggers completion once.
- Restart resets state.
- App suspend/resume restores the last committed state.
- Hint returns a legal move.
- Analyze returns all legal moves.
- Erase removes exactly one eligible arrow.
- Save/load restores a valid board.

## 13.2 Generator tests

- Same seed + same generator version produces same level.
- Every generated level is structurally valid.
- Every generated level has a verified solution.
- Difficulty score is within requested band.
- No repeated fingerprint inside the configured window.
- Dependency cycles are rejected.
- Generic cross-check search respects its configured budget.
- Generator gracefully reports failure rather than returning an invalid board.
- Daily challenge is identical across clients.

## 13.3 Multiplayer tests

- Both clients receive identical challenge data.
- Duplicate submissions are idempotent.
- Invalid move traces are rejected.
- Client clock manipulation does not decide a match.
- Reconnecting does not duplicate rewards.
- User cannot read another user's private inventory.
- Leaderboard entries are validated.
- Match result cannot be rewritten by the client.

## 13.4 Device testing

Test on:

- Small Android phones.
- Large Android phones.
- Common mid-range chipsets.
- Low-memory devices.
- Different pixel densities.
- Slow network.
- Offline mode.
- App background/foreground.
- Incoming call/audio interruption.
- Update and reinstall.
- Different safe-area/inset configurations.

## 13.5 Performance objectives

Initial internal goals:

- Fast first interaction after launch.
- No visible path-layout jitter during input.
- No sustained frame drops on target mid-range devices.
- No large memory growth across repeated level loads.
- Asset loading must not block simple UI transitions.
- Generated-level solving must remain within a configured budget.
- Network failures must not block offline campaign play.

Measure on physical devices; do not rely on desktop browser performance.

## 13.6 Accessibility

- Large touch targets.
- Clear arrowhead direction.
- Path contrast independent of skin.
- No colour-only state indicators.
- Readable labels and numerals.
- Reduced-motion option.
- Sound and haptic controls.
- Avoid flashing effects.
- Support system text scaling where practical.

# 23. Acceptance gates

## Gate A — Core mechanic

- All four arrowhead directions work.
- Multi-bend paths render and expand to the same occupied cells as the domain model.
- Whole-path swept-volume collision is correct, including body-only blockers.
- Blocked move leaves board occupancy unchanged; permitted attempt/mistake counters update once.
- Valid move mutates state exactly once.
- Full level clears through a verified move sequence.
- Repeated taps, app backgrounding and interrupted animation do not duplicate actions or rewards.

## Gate B — Player experience

- A first-time player can explain the rule after the tutorial.
- Players can distinguish a blocked move from a legal move.
- The gameplay board is readable on small portrait screens.
- The HUD and tool states match the current action/economy.
- Save/load and restart work without progress loss.
- No critical accessibility, safe-area or lifecycle defect remains.

## Gate C — Content and generator

- Same schema/rules/generator version and seed produce identical level data.
- Every delivered level is structurally valid and has a verified solution.
- Solution replay passes an independent checker.
- Difficulty is human-calibrated, not assigned only by solver cost.
- Generation failure falls back to a known-good board and never displays an invalid level.
- A representative sample across every difficulty band is human-tested.

## Gate D — Online competition

- The server issues/records canonical challenge data.
- Server replay validation checks every move and final state.
- Duplicate submissions are idempotent.
- Client clock changes do not determine a result.
- RLS and endpoint authorization tests pass.
- Player data is restricted to the intended audience.

## Gate E — Monetization and publishing

- Account holder is eligible and the real owner is disclosed correctly.
- Target audience, content rating, Data safety and privacy declarations are accurate.
- Ads and purchases meet the current applicable Play policies.
- Purchases are verified and recoverable.
- No paid product is required to finish campaign content.
- No paid randomized reward is sold in v1.
- Retention and complaints are compared before/after monetization.

## Gate F — Scale and operations

- Retention is stable across more than one cohort and sample sizes are stated.
- Acquisition has a repeatable signal beyond one viral post.
- Crash/error monitoring and support ownership exist.
- Content production and validation can continue without engine rewrites.
- Hosting, support, moderation and incident costs are understood before live multiplayer.

# 26. Content operations, releases and support

## 26.1 Level/content release pipeline

1. Author a level in the internal editor or validated source format.
2. Run schema, geometry, collision and solvability checks.
3. Replay the stored solution through the production rules package.
4. Run a visual preview at narrow and wide phone aspect ratios.
5. Human-review the level's intended lesson and difficulty.
6. Assign a stable level ID and content version.
7. Include it in a content manifest with a checksum.
8. Test the manifest in a release candidate before publishing.
9. Keep the previous known-good manifest available for rollback.

Never overwrite a level silently if players have saved progress against it. If a rule change invalidates old content, increment `rulesVersion` and provide a migration or preserve the old rules for replay.

## 26.2 Release channels

- **Development:** developer-only builds; debug overlays allowed.
- **Internal alpha:** team and invited device testers; no real-money purchases.
- **Closed beta:** recruited external testers; analytics and privacy disclosures active.
- **Production:** staged rollout where available; monitor crashes, ANRs, reviews and support reports.

Use versioned release notes. Keep a rollback build and a documented owner for production incidents.

## 26.3 Support and incident basics

Before public launch, define:

- A support email/contact route controlled by the legitimate publisher.
- A process for lost progress, purchase restoration and bug reports.
- A way for players to copy a diagnostic bundle without exposing secrets.
- A severity scale for crashes, corrupt saves, unfair levels and billing failures.
- Who can pause daily challenges or disable a broken online feature.
- A response owner and an escalation route for privacy/security incidents.

Do not launch a feature that nobody is responsible for operating after release.
