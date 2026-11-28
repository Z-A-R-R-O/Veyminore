# Execution backlog

Updated 28 November 2026. [Gap register](GAME-EXPERIENCE-GAPS.md) owns open acceptance criteria; [current state](CURRENT-GAME-STATE.md) owns implemented behavior.

## Next: native acceptance & human playtest calibration

1. Reproduce with realistic UUID-bearing transcripts for 220 completed levels plus migration archives and previous snapshot.
2. Validate the merged multi-chunk implementation against the larger campaign and provider quotas.
3. Retain legacy-format compatibility, interrupted-write recovery, corrupt/missing-fragment rejection and account isolation.
4. Test exact restores and unchanged balances with synthetic fixtures in isolated storage; then verify against real PlayFab test objects.
5. Enable only after the capacity and recovery gates pass. Keep local saves and clear failure status throughout.

See [release checklist](RELEASE-CHECKLIST.md) and [level difficulty register](LEVEL-DIFFICULTY-REGISTER.md) for criteria.

1. Physical-device release acceptance: verify signed build lifecycle, touch target sizing (>= 48px), 60 FPS frame timing, safe-area insets, and audio session management.
2. Human difficulty & readability: evaluate late-game decision density (especially Level 100 Sanctum climax), solver vs human solve paths, retry pacing, and visual cue clarity.
3. Rights, privacy, and account operations: verify audio provenance, generated asset rights, data retention/deletion workflows, and player support runbooks.

## Following work

- Collection expansion after economy/design review (5 chest tiers, 100 skins); multiplayer remains later work.

## Delivered milestones

220-level campaign; snake movement and ordering mechanics; dense late boards; hold preview; profiles/badges; Google OIDC integration; legacy snapshot conflict protection and completion uploads; reviewed account wallet, idempotent rewards/purchases, and second-device completion restore. These are development implementations, not a declaration that all launch gates have passed.

- **Account continuity and conflict resolution policy**: Implemented cross-device appearance synchronization (`avatar`, `frame`, `name`), optimistic concurrency versioning on preferences (`expectedRevision`), clean restart policy for in-progress attempts on device restore, deterministic conflict resolution matrix (idempotent first-clear coins, monotonic star updates), and strict account namespace isolation (`arowgo.economy.<accountId>`). Verified in `tests/account-continuity.test.ts`. See [account continuity guide](ACCOUNT-CONTINUITY-AND-CONFLICTS.md).
- **Production account and ledger infrastructure**: Implemented durable SQLite session store (`sessions.sqlite`) with automated TTL pruning and proxy mutation tracking; sliding-window IP rate limiter (`rate-limiter.mjs`); automated atomic ledger backups (`VACUUM INTO`) with SHA-256 manifests and dual-entry balance invariant verification (`backup.mjs`); pre-restore safety snapshots and dry-run restore validation (`restore-ledger.mjs`); and container health probes (`/api/arowgo/v1/health`). Verified in `tests/production-infrastructure.test.js`. See [production infrastructure guide](PRODUCTION-ACCOUNT-INFRASTRUCTURE.md).
- **Full-history cloud capacity**: Multi-chunk PlayFab object envelope supporting realistic 100-level UUID transcripts, backups, and migration archives up to 150 KB packed / 512 KiB raw, with atomic commits under `ExpectedProfileVersion`, previous-generation rollback preservation, and corruption rejection. Verified in `tests/cloud-capacity.test.js` and `tests/sanctum.test.ts`. See [cloud recovery guide](CLOUD-SAVE-RECOVERY.md).
- **Original 100-level milestone & dense late boards**: 100 levels across 5 worlds (Bloom Valley, Verdant Cove, Frostfall Peaks, Amber Dunes, Amber Sanctum); snake movement v2, keys & locks, anchors, ice seals, phase gates, removal-count countdowns.
- **Reviewed account wallet & restore**: SQLite server ledger, idempotent first-clear rewards (2,500 coins total), second-device completion reconstruction, Google OIDC token exchange (`google-web`), and isolated live PlayFab entity probes.
- **Hold preview & presentation**: 400ms neutral hold inspection, 30 avatars, 30 frames, 15 arrow skins, 3 crate tiers, Satoshi typography, and purple arrow-v4 branding.
- **Comprehensive documentation suite**: 10 new/updated guides covering cloud recovery, deployment, generator v4, mechanics, level register, currency flows, release checklist, asset catalog, test coverage, and changelog.
