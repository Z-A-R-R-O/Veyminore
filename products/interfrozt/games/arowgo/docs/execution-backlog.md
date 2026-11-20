# Execution backlog

Updated 20 November 2026. [Gap register](GAME-EXPERIENCE-GAPS.md) owns open acceptance criteria; [current state](CURRENT-GAME-STATE.md) owns implemented behavior.

## Next: full-history cloud capacity

See [cloud recovery guide](CLOUD-SAVE-RECOVERY.md) for limits, recovery workflows, and current safe failure handling.

1. Reproduce with realistic UUID-bearing transcripts for 100 completed levels plus migration archives and previous snapshot.
2. Design bounded storage that retains every byte, current/previous atomicity and optimistic concurrency. Do not discard history, rewards or recovery copies to pass quotas.
3. Implement with legacy-format compatibility, interrupted-write recovery, corrupt/missing-fragment rejection and account isolation.
4. Test exact restores and unchanged balances with synthetic fixtures in isolated storage; then verify against real PlayFab test objects.
5. Enable only after the capacity and recovery gates pass. Keep local saves and clear failure status throughout.

## Following work

- Production account/ledger infrastructure and operational recovery; see [production deployment guide](DEPLOYMENT-PRODUCTION.md).
- Account continuity beyond completed-board restore, with explicit conflict policy.
- Human playtesting and physical-device release acceptance.
- Release regression, performance, formatting and rights/privacy checks.
- Collection expansion after economy/design review; multiplayer remains later work.

## Delivered milestones

100-level campaign; snake movement and ordering mechanics; dense late boards; hold preview; profiles/badges; Google OIDC integration; legacy snapshot conflict protection and completion uploads; reviewed account wallet, idempotent rewards/purchases, and second-device completion restore. These are development implementations, not a declaration that all launch gates have passed.
