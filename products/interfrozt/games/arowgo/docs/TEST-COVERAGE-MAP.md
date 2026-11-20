# Test coverage map

Feature-to-test mapping and verification classification. Reconciled 20 November 2026. [Build guide](build-guide.md) · [Latest audit](AUDIT-2026-11-20.md) · [Release checklist](RELEASE-CHECKLIST.md).

## 1. Test tier classification

The AROWGO test suite uses four distinct verification tiers:

1. **Automated Unit Tests**: Fast, deterministic, offline tests running under Vitest. No external network dependencies.
2. **Mocked-Provider Backend Tests**: Tests exercise server HTTP routes, auth flows, and SQLite wallet logic using synthetic fixtures and mock Google/PlayFab responders.
3. **Live-Provider Probes**: Opt-in integration tests against real PlayFab entity objects restricted to designated probe namespaces (`arowgo-sync-probe-v1`). Normal game saves remain untouched.
4. **End-to-End Browser Tests**: Playwright browser flows covering desktop Chrome and emulated Pixel 7 viewports.
5. **Physical-Device Checks**: Manual and hardware test suites on real Android hardware (Open launch gate).

---

## 2. Feature-to-test mapping matrix

| Feature Area | Source Code | Test Files | Tier | Notes |
| --- | --- | --- | --- | --- |
| **Snake Exit Rules (v2)** | `src/domain/rules.ts` | `tests/rules.test.ts`, `tests/snake-rules.test.ts` | Automated Unit | Verifies head-ray exits, body slithers, and rejects self-crossing. |
| **Arrow Geometry & Bends** | `src/domain/rules.ts` | `tests/arrowGeometry.test.ts` | Automated Unit | Tests 1-bend, 2-bend coordinate expansions and boundary clamping. |
| **Keys & Locks** | `src/domain/rules.ts` | `tests/keys.test.ts`, `tests/campaign-keys.test.ts` | Automated Unit | Tests `requires` locking, circular dependency rejection, hint compatibility. |
| **Anchors** | `src/domain/rules.ts` | `tests/cove.test.ts`, `tests/sanctum.test.ts` | Automated Unit | Tests `anchorRequires` multi-tethering and unblocking sequences. |
| **Ice Seals** | `src/domain/rules.ts` | `tests/timing.test.ts`, `tests/timing-compat.test.js` | Automated Unit | Tests `thawAfter` threshold counting and shattered state. |
| **Phase Gates** | `src/domain/rules.ts` | `tests/timing.test.ts`, `tests/sanctum.test.ts` | Automated Unit | Tests `phase: 0 \| 1` parity transitions. |
| **Keg Deadlines** | `src/domain/rules.ts` | `tests/timing.test.ts`, `tests/density.test.ts` | Automated Unit | Tests `deadline` removal countdown and `expiredKeg()` failure. |
| **Hold Preview (400ms)** | `src/domain/preview.ts` | `tests/hold-preview.test.ts` | Automated Unit | Tests neutral inspection; ensures no winning moves leaked. |
| **Assistance Tools** | `src/application/session.ts` | `tests/tools.test.ts` | Automated Unit | Tests Hint (solver-safe arrow) and Erase (removes 1 arrow, advances count). |
| **100-Level Campaign** | `src/domain/campaign.ts` | `tests/campaign.test.ts` | Automated Unit | Verifies all 100 level saves, star totals (300), and coins (exactly 2,500). |
| **Generator (v4)** | `src/domain/generator.ts` | `tests/generator.test.ts`, `tests/mild-generator.test.ts` | Automated Unit | Tests seed repeatability, layout gates, and key-lock pair insertion. |
| **Planning Evaluation** | `src/domain/planning.ts` | `tests/planning.test.ts`, `tests/density.test.ts` | Automated Unit | Measures `randomLegalWinRate` and verifies monotonic difficulty curves. |
| **Profile & 30 Avatars/Frames** | `src/storage/profile.ts` | `tests/profile.test.ts`, `tests/badges.test.ts` | Automated Unit | Tests avatar selection, frame persistence, and badge award triggers. |
| **Local Save & Recovery Journal** | `src/account/cloud-local.ts` | `tests/cloud-local.test.ts` | Automated Unit | Tests Web Lock, `restore-journal.v1` crash rollback, and `recovery.v1`. |
| **Completion Sync Engine** | `src/account/completion-sync.ts` | `tests/completion-sync.test.ts` | Automated Unit | Tests sync anchor, retry queues, conflict detection, and offline handling. |
| **Google OIDC Identity** | `server/account/google-identity.mjs` | `tests/google-identity.test.js` | Mocked Backend | Tests nonce verification, token expiry, and audience mismatch rejection. |
| **Account Auth Endpoints** | `server/account/service.mjs` | `tests/account-backend.test.js`, `tests/account.test.ts` | Mocked Backend | Tests session creation, CSRF token validation, cookie binding. |
| **Server SQLite Ledger** | `server/economy/wallet.mjs` | `tests/wallet.test.js` | Mocked Backend | Tests atomic wallet operations, idempotent clear receipts, zero double-claims. |
| **Economy Purchases** | `server/economy/rewards.mjs` | `tests/economy-purchases.test.js`, `tests/economy-client.test.ts` | Mocked Backend | Tests crate purchase validation and balance deductions. |
| **Account Progress Restore** | `src/account/account-restore.ts` | `tests/account-progress.test.js`, `tests/account-restore.test.ts` | Mocked Backend | Tests clean second-device board reconstruction and account namespaces. |
| **Live PlayFab Entity Probe** | `server/account/cloud-probe.mjs` | `tests/cloud-backend.test.js` | Live Provider | Tests real PlayFab `SetObjects`/`GetObjects` with probe objects. |
| **Full-History Cloud Capacity** | `server/account/cloud.mjs` | `tests/cloud-capacity.test.js`, `tests/sanctum.test.ts` | Mocked Backend | Tests multi-chunk envelope up to 150 KB, 100-level UUID saves, and previous-save atomicity. |
| **Production Account Infrastructure** | `server/account/session-store.mjs`, `server/account/rate-limiter.mjs`, `server/economy/backup.mjs` | `tests/production-infrastructure.test.js` | Mocked Backend | Tests durable SQLite sessions, IP sliding-window rate limiting, atomic ledger backups, invariant verification, and health probe. |
| **Responsive Viewports & Flow** | `src/ui/App.tsx` | `tests/e2e/*` | Playwright E2E | Desktop (1280×800) and emulated mobile (Pixel 7 390×844) viewport checks. |
| **Physical Hardware** | Android APK | `android/` | Physical Device | **OPEN GATE**: Touch targets, safe-area insets, thermal stability, haptics. |

---

## 3. Execution commands

```powershell
# 1. Run all offline unit and mocked-provider tests (Vitest)
pnpm test

# 2. Run a specific test suite
pnpm exec vitest run tests/sanctum.test.ts

# 3. Run Playwright E2E browser suite
pnpm exec playwright test

# 4. Run documentation links and status index check
python scripts/check-doc-links.py
```
