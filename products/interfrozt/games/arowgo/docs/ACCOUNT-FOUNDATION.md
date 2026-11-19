# Account foundation — B01 implementation

> Current web implementation now uses verified Google ID tokens and PlayFab OpenID Connect. The earlier authorization-code contract below is superseded for web. See [refactor and required setup](ACCOUNT-BACKEND-DEV.md).

> 18 November update: an isolated development Google backend and test page are implemented. [Current provider-spike status](ACCOUNT-BACKEND-DEV.md) supersedes earlier statements that no service code exists. Live provider success and production service gates remain open.

Updated 16 November 2026, after the status audit. B01 is in progress, not complete.

## Implemented

- src/account/contracts.ts: versioned session/account contracts and runtime response validation. The anonymous session has no online account; a linked account explicitly lists Google. Provider tickets and unexpected fields are discarded.
- src/account/web-api.ts: opt-in, same-origin web transport. Disabled by default and not wired into the game UI. Uses cookie credentials, no-store requests, no redirects, CSRF bootstrap, bounded requests, sanitized errors and one in-flight request per instance. Failure invalidates the cached CSRF token and requires session refresh. It does not retry mutations automatically.
- src/account/legacy-backup.ts: read-only raw snapshot of known profile, campaign, archive, lesson and preference keys. Unrecognized keys, including account credentials, are excluded. Corrupt known saves are retained for recovery. Read failure, detected mutation or data above 4 MiB fails the entire capture rather than returning a partial copy.
- tests/account.test.ts: contract, transport and backup behavior with deterministic test responses. These are not live Google or PlayFab integration tests.

No changes to campaign saves, rewards, wallets, game screens or live network behavior. No accounts, hosting, provider applications or secrets have been created. The modules are not imported by the shipped game yet.

## Draft HTTP contract for the future service

All routes are under /api/arowgo/v1/account on the web app origin. These are interface definitions, not running endpoints.

| Method/path         | Input                                                     | Result                                                            |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| GET session         | Cookie session if present                                 | Version 1 session, current account or null, CSRF token and expiry |
| POST guest          | schemaVersion, stable operationId                         | Authenticated online guest or existing account                    |
| POST google/sign-in | schemaVersion, operationId, authorizationCode, flowId     | Linked account session                                            |
| POST google/link    | Same credential fields plus existing authenticated cookie | Same guest account linked, or HTTP 409 without reassignment       |
| POST logout         | schemaVersion                                             | Confirmed anonymous session and refreshed CSRF token              |

Every POST requires X-CSRF-Token. Tokens here are anti-CSRF values, not authentication tickets. The service must issue and verify them, enforce Origin/CSRF checks, create Secure/HttpOnly/SameSite cookies, authenticate every protected command and own authorization. Client headers and validation alone provide no server protection.

operationId is a UUID v4 supplied by the caller and reused for the same logical command after reconciliation. The client does not implement deduplication; durable idempotency remains B02. HTTP 401/403/409/429 map to explicit error codes without leaking provider bodies. Other unsuccessful responses are unavailable. A failed/aborted POST may have committed remotely: refresh the session before deciding what to do; never assume cancellation rolled it back.

flowId is reserved for a server-created, session-bound, expiring OAuth flow. The start-flow endpoint, Google code acquisition, PKCE/state/nonce handling appropriate to the selected flow, credential exchange and link-collision recovery are not implemented. Do not synthesize flow IDs or enable these calls against an unverified endpoint. Provider setup must prove the correct credential on web and Android before public sign-in UI.

Concurrency protection is per transport instance only. Cross-tab/device authorization, revocation, refresh and race handling remain service responsibilities. There is no client identity override, force-link option, email-based merge or wallet field in these commands.

## Save protection and limitations

captureLegacyBackup returns an in-memory object labelled unverified-local. It neither persists a durable backup nor uploads/imports anything. Its double read detects ordinary changes but cannot make localStorage atomic across tabs. Future import should pause local writes, persist and verify a recovery copy, then await a server import receipt before changing ownership or removing any old copy. Failed capture must stop import.

Raw local gems, coins, cosmetics and completion records are untrusted. Capturing them is not approval to grant paid currency or mint first-clear rewards. The bounded grandfathering policy, account-scoped storage, import receipt, restore UX and cloud conflict logic remain B03/B04.

## Next gate

1. Configure a development PlayFab title and Google OAuth applications for the web origin and Android signing identity, using secret storage outside the client/repository.
2. Prove credential acquisition, cancelled sign-in, guest linking and an already-linked identity on both platforms. Native authentication needs its own verified adapter; this cookie transport is web-only.
3. Implement the trusted service and durable ledger (B02), then account UI/import (B03). No cloud UI should report synced until a real server acknowledgement exists.

See [architecture and delivery plan](BACKEND-ACCOUNT-PLAN.md) and [execution backlog](execution-backlog.md). Verification: 204 unit tests passed in 27 files (26 account tests), TypeScript and production build passed. Existing large-bundle warning remains. [Command evidence](verification/account-foundation-2026-11-16.txt). No browser rerun was needed for this isolated, unreferenced module slice; the prior audit records browser coverage.
