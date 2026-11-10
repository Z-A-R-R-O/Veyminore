# Online competition and social systems

Working revision 2.3 · Derived from masterplan 2.1 · Updated 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page revises source sections 8 under the working amendments. Original section numbers remain for traceability; consult the original reference for unchanged historical text. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 8. Multiplayer and social architecture

## 8.1 Multiplayer rollout

Do not begin with real-time multiplayer.

Build in this order:

1. Daily challenge leaderboard.
2. Asynchronous friend challenge.
3. Ranked asynchronous competition.
4. Live 1v1 race.
5. Seasonal competitions and teams, only if demand supports them.

This provides competitive value before the team operates a real-time multiplayer service.

## 8.2 Daily leaderboard

All players receive the same daily puzzle seed.

Leaderboard ordering should be based on a documented deterministic rule.

Suggested ranking order:

1. Completed beats incomplete.
2. Fewer mistakes.
3. Fewer assisted actions.
4. Apply a documented tie-break only if it distinguishes outcomes; successful removal count alone cannot distinguish full clears of the same board.
5. Faster completion as a tie-breaker.

The exact order must be tested for fairness and published in the game.

## 8.3 Asynchronous 1v1 challenge

Flow:

1. Player A selects Challenge Friend.
2. Server issues a challenge ID and canonical level seed.
3. Player A shares a link or code.
4. Player B opens the challenge.
5. Both players receive identical rules and level data.
6. Each completes the puzzle independently.
7. Server validates the submitted move trace.
8. Results are compared.
9. Winner and match summary are displayed.

The players do not need to be online at the same time.

## 8.4 Ranked mode rules

- No paid hints or erase actions in ranked matches.
- Cosmetic skins must not affect gameplay.
- Same generator and rules version for both players.
- No changing the board after the match begins.
- Time and move rules must be visible before play.
- Disconnect and app interruption rules must be explicit.
- Do not mix casual and ranked scores.

## 8.5 Live 1v1 mode — later phase

Potential format:

- Two players enter a match room.
- Both receive the same board.
- Each player clears their own board.
- Server validates actions.
- First valid completion wins.
- If neither completes within the time limit, use score and mistake tie-breakers.
- Reconnection is supported for a short grace period.
- Match result is server-issued.

### Live-mode requirements

- Server-authoritative state.
- Matchmaking.
- Room lifecycle.
- Message validation.
- Reconnection and timeout handling.
- Rate limiting.
- Anti-cheat checks.
- Server clock for elapsed time.
- Match result persistence.
- Load testing and operational monitoring.

## 8.6 Social features

Start with:

- Share challenge link.
- Share result card.
- Copy challenge code.
- Predefined safe reactions.

Do not introduce open chat in the early product. It creates moderation, privacy and safety requirements that are disproportionate to the first release.

## 8.7 Anti-cheat

Never trust a client-submitted score by itself.

For ranked play:

- Store the canonical seed and generator version.
- Validate every submitted move against server-known rules.
- Validate the final board state.
- Check impossible completion times.
- Use server timestamps where appropriate.
- Rate-limit challenge and score submissions.
- Make result submission idempotent.
- Flag suspicious activity for review.
- Do not ban users solely based on one noisy heuristic.
