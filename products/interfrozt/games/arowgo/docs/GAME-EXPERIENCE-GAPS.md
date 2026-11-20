# Open game and release gaps

Reconciled 20 November 2026 against the current 100-level implementation. [Current state](CURRENT-GAME-STATE.md) owns delivered behavior; this file owns unresolved acceptance gaps.

| Priority | Gap | Completion evidence required | Status |
| --- | --- | --- | --- |
| Resolved (P0) | Production account & ledger infrastructure; see [production infrastructure](PRODUCTION-ACCOUNT-INFRASTRUCTURE.md) | Chosen hosting/storage architecture (SQLite WAL on persistent volume with Postgres scale path), durable session store (`sessions.sqlite`), IP sliding-window rate limiting (`rate-limiter.mjs`), point-in-time backups (`VACUUM INTO`) with SHA-256 manifests, dual-entry balance invariant verification, dry-run & pre-restore safety snapshots, health probes (`/health`). Verified in `tests/production-infrastructure.test.js`. | Resolved |
| Resolved (P0) | 10,700-byte packed cap rejected realistic 100-level histories; see [cloud recovery guide](CLOUD-SAVE-RECOVERY.md) | Resolved via multi-chunk envelope up to 150 KB packed / 512 KiB raw in `cloud.mjs`; atomic current/previous versions, stale-writer rejection, zero truncation, exact restores verified in `tests/cloud-capacity.test.js` and `tests/sanctum.test.ts`. | Resolved |
| Resolved (P1) | Account-wallet cross-device continuity; see [continuity & conflict policy](ACCOUNT-CONTINUITY-AND-CONFLICTS.md) | Appearance synchronization (`avatar`, `frame`, `name`), optimistic revision control, in-progress board clean restart policy, deterministic conflict matrix, and account namespace isolation implemented. Verified in `tests/account-continuity.test.ts`. | Resolved |
| P1 | Human difficulty and comprehension unmeasured | Observe onboarding and late-game decisions, especially the Level 100 difficulty jump; measure retries/time and readability. Solver success is not human enjoyment. | Open |
| P1 | Native acceptance incomplete | Signed build and physical-device lifecycle, touch, audio, safe areas, performance and recovery tests. Browser emulation is insufficient. | Open |
| P1 | Broad release regression/formatting status not freshly established | Full relevant browser suite and formatting baseline; distinguish fresh results from dated evidence. | Open |
| P1 for launch | Rights/privacy/account operations | Review supplied/generated art, fonts/audio, retention/deletion and support/recovery processes. | Open |
| P2 | Finite collection/earning loop | Review the proposed chest tiers and 100-skin catalog, asset quality and earning balance before implementation. Current 15 skins/three crates stay the source of truth. | Open |
| Later | Multiplayer, social, rankings, daily/endless | Separate implementation and operating plans; placeholders are not delivered network features. | Open |

Delivered work includes Google/PlayFab sign-in, cloud conflict/recovery flows, automatic completion uploads, reviewed server-wallet migration, account restore, 100 levels and neutral hold inspection. Do not reopen those as “not implemented”; address their limits above. Free Hint/Erase and assistance-compatible stars are current behavior, not undiscovered defects.
