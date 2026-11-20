# Open game and release gaps

Reconciled 20 November 2026 against the current 100-level implementation. [Current state](CURRENT-GAME-STATE.md) owns delivered behavior; this file owns unresolved acceptance gaps.

| Priority | Gap | Completion evidence required |
| --- | --- | --- |
| P0 for full-history cloud sync | 10,700-byte packed cap rejects realistic histories, already at 80 clears | Bounded larger-save format; atomic current/previous versions; stale-writer rejection; exact history/currency recovery; realistic 100-level archives; isolated real PlayFab round-trip. Never trim saves to fit. |
| P0 for production accounts/economy | Localhost backend, development SQLite, non-production sessions and operations | Chosen production host/storage, durable sessions, backups and tested restore, rate limits, monitoring and recovery ownership. |
| P1 | Account-wallet cross-device continuity is partial | Completed levels/stars/equipment restore exists; explicitly design partial-board and appearance sync, conflicts and account isolation before claiming full continuity. |
| P1 | Human difficulty and comprehension unmeasured | Observe onboarding and late-game decisions, especially the Level 100 difficulty jump; measure retries/time and readability. Solver success is not human enjoyment. |
| P1 | Native acceptance incomplete | Signed build and physical-device lifecycle, touch, audio, safe areas, performance and recovery tests. Browser emulation is insufficient. |
| P1 | Broad release regression/formatting status not freshly established | Full relevant browser suite and formatting baseline; distinguish fresh results from dated evidence. |
| P1 for launch | Rights/privacy/account operations | Review supplied/generated art, fonts/audio, retention/deletion and support/recovery processes. |
| P2 | Finite collection/earning loop | Review the proposed chest tiers and 100-skin catalog, asset quality and earning balance before implementation. Current 15 skins/three crates stay the source of truth. |
| Later | Multiplayer, social, rankings, daily/endless | Separate implementation and operating plans; placeholders are not delivered network features. |

Delivered work includes Google/PlayFab sign-in, cloud conflict/recovery flows, automatic completion uploads, reviewed server-wallet migration, account restore, 100 levels and neutral hold inspection. Do not reopen those as “not implemented”; address their limits above. Free Hint/Erase and assistance-compatible stars are current behavior, not undiscovered defects.
