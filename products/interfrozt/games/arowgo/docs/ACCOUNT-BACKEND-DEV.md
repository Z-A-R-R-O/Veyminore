# Development Google sign-in backend — ID token refactor

Updated 18 November 2026. The failed authorization-code spike has been replaced for web with Google Identity Services Sign in with Google, server-side Google ID token verification and PlayFab OpenID Connect.

## Current flow

1. The server issues a cookie-bound, single-use flow nonce.
2. The standard Google sign-in button obtains an ID token containing that nonce.
3. google-auth-library verifies the signature, audience, issuer and expiry. The backend also requires the exact flow nonce and a subject.
4. The backend submits the token to PlayFab LoginWithOpenIdConnect using connection google-web. Linking uses LinkOpenIdConnect with ForceLink=false.
5. A successful response rotates the server session. Tokens and PlayFab session tickets remain off localStorage and out of logs. Local gameplay saves and balances are not imported.

The old code-exchange path is removed. Existing Google-add-on player identities are not automatically the same as OIDC identities; do not migrate or merge them by email. Any existing cloud player must be linked through an authenticated, explicitly designed migration before production use.

## Console configuration — creation reported

Run server/account/setup-oidc.ps1 interactively from PowerShell. It targets only title 116A87, prompts for the PlayFab title secret key and existing Google Web client secret without echoing them, and does not persist credentials. It creates google-web using Google's discovery document and the recorded Web client ID. It never updates an existing connection.

The script explicitly sets PlayFab IgnoreNonce=true for this brokered flow because this API does not take the application's expected nonce. Our server still verifies the signed nonce against its single-use session flow before accepting a session. PlayFab's direct public client API remains a separate trust boundary; server-protected commands must not infer our session/nonce validation from a PlayFab login alone. Review that boundary and account linking before production. The script describes this setting and asks for CREATE before submitting. The user reported “Created google-web” on 18 November 2026. No secret was requested in chat.

After setup, run pnpm account:server and pnpm account:web, then open http://localhost:4173/account-test.html. The single standard Google button replaces the previous two-click code popup. There is an explicit restart control after failures and bounded token verification/client requests.

## Verification

223 tests passed in 29 files. Includes actual RSA signature verification through Google's library, forged signature rejection, wrong audience/issuer, expiry/nonce checks, session and CSRF isolation, logout races, identity collisions and HTTP checks. TypeScript and production build pass. Existing large-bundle warning remains. Successful live Google-to-PlayFab login is NOT yet verified. The user reports the OpenID connection has now been created.

## Development limits

Loopback-only service, strict Host/Origin, HttpOnly/SameSite cookies (Secure must be added for HTTPS deployment), bounded in-memory sessions, no durable ledger or account recovery/deletion. Restart signs users out. Guest provisioning and native integration remain pending. This is not a production-ready account system. Google-auth-library is used only in server code.

## Official contracts

- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://learn.microsoft.com/en-us/rest/api/playfab/client/authentication/login-with-openid-connect?view=playfab-rest
- https://learn.microsoft.com/en-us/rest/api/playfab/admin/authentication/create-openid-connection?view=playfab-rest

See [account setup](ACCOUNT-SETUP.md) and [foundation](ACCOUNT-FOUNDATION.md).


## Sign-in page and timeout fixes — 18 November 2026

Redesigned the isolated development page with responsive Satoshi typography, AROWGO branding, connection progress, explicit success/error states, account details and a read-only session check. Google consent is not presented as successful PlayFab authentication. Restart remains available if a popup closes without delivering a credential.

Fixed the successful-response body read to share the transport deadline; a stalled JSON body previously bypassed that deadline. Google mutations now allow 30 seconds, covering sequential Google verification (8 seconds) and PlayFab transport (12 seconds). Other calls retain 15 seconds. The page no longer races this against a shorter independent UI timer.

Verification: 47 targeted account tests passed, including stalled-body and 21-second sign-in regression cases; production build passed (existing bundle-size warning). An isolated browser checked mobile success, failure and restored-session states using synthetic credentials and mocked responses. The live page reached the real Google-button ready state at 1280×800. Screenshots and runner are in tmp/account-*.png and tmp/check-account-redesign.mjs.

Live limitation: a credential-free invalid-token PlayFab probe responded with NotAuthorized; another probe timed out connecting even with IPv4 routing. This demonstrates intermittent connectivity, not a successful real login. The user's Google-to-PlayFab result remains unverified. Local campaign data and currency are untouched.

## Profile integration — 18 November 2026

The user supplied a screenshot of the live Google-to-PlayFab success state. Live identity sign-in is now user-confirmed; earlier pending-status notes above describe the preceding troubleshooting stage.

Profile now includes an Account tab. In the localhost development build it reads the server-owned session, opens the verified Google sign-in page on the same origin, returns directly to Account, displays the connected account and supports sign-out. It refreshes on window focus and provides retry when the service is unavailable. Other origins and production builds show an unavailable message without requesting authentication or redirecting across origins.

ProfileAccount has no profile/save writer dependencies. Signing in/out changes only the backend identity session; it does not import local data, merge identities, alter currencies or enable cloud saves. Existing local-save labels remain accurate. Cloud-save migration, durable sessions and production/native authentication remain separate work.

Profile integration validation: production build and 47 account unit/backend tests passed. Four Playwright browser tests passed: sign-in/return/sign-out/reload with byte-for-byte localStorage comparison; unavailable-service retry; existing profile edits and owned-skin controls; responsive sections at 320×568, 390×844, 844×390 and 1280×800. Browser auth tests use synthetic Google credentials and mocked backend responses, not the user's session. The prior live sign-in success is user-confirmed separately.

## Cloud save implementation — 18 November 2026

Manual snapshot sync is implemented behind TWO independent, default-off development flags: server `AROWGO_CLOUD_SYNC=1` and Vite `VITE_AROWGO_CLOUD_SYNC=1`. Production remains gated off. No live player's save has been uploaded or replaced during automated testing.

### Storage and conflicts

The server derives the PlayFab title-player entity from its stored authenticated session ticket, never from a client-supplied entity or token. `GetObjects` loads the current entity profile revision; `SetObjects` uses `ExpectedProfileVersion` so concurrent devices cannot silently overwrite each other. The current `arowgo-save-v1` and preceding `arowgo-save-previous-v1` snapshot are written together. Duplicate operation IDs with identical payloads return the saved result; changed payloads conflict. No write is automatically retried after an uncertain response.

Known AROWGO save keys are preserved byte-for-byte, including balances, reward-claim ledgers, old content backups and preferences. Snapshots are marked `unverified-local`. Compression is gzip/base64 with SHA-256 integrity checking, 512 KiB decompressed and 8,000-byte packed limits; oversized saves fail without truncation. PlayFab object quotas still require a live title round-trip check. Currency remains legacy local data, NOT a trusted paid-currency ledger. Sync never adds balances, grants purchases or merges rewards.

### Restore and recovery

Profile opens a separate cloud-save page on the same origin. Upload and restore each require a clear user choice and confirmation. Preview compares progress and balances. Restore rechecks account identity, cloud revision and local bytes, and rejects incompatible primary campaign/profile data instead of silently falling back to a new game. Older data can be backed up but may require a separate migration before restore.

All game tabs hold a shared Web Lock. The cloud page requires an exclusive lock; other game tabs must close. Before restore, a local recovery copy and write-ahead journal must both be written and read back successfully. Failed or interrupted restores roll back from the journal before the game module (and its controllers) loads. The latest pre-restore copy is downloadable as JSON. Failures that prevent rollback retain the journal and block game startup until recovery succeeds. Browsers lacking Web Locks cannot restore.

### Verification and remaining gate

242 unit tests passed across 31 files, including cloud serialization/integrity/size validation, account isolation, CAS conflict, idempotency, quota failures, interrupted restores and exact preservation of currency bytes. Browser test `tmp/check-cloud.mjs` runs a separate flag-enabled Vite on port 4175, proxies only an isolated test browser to it, and mocks PlayFab/session responses. It verified upload, restore (19 gems restored with the displaced 7-gem save retained), stale-revision rejection, multi-tab blocking and the actual default-disabled page. It never reads the user's browser session.

Live PlayFab write/read/restore remains unverified. Keep both flags off for normal play until an isolated real-account round trip confirms title quotas, entity permissions, CAS behavior and readback. Automatic background sync and an authoritative wallet are not enabled. The existing local game remains the source of play data.

Sources: [GetObjects](https://learn.microsoft.com/en-us/rest/api/playfab/data/object/get-objects?view=playfab-rest), [SetObjects](https://learn.microsoft.com/en-us/rest/api/playfab/data/object/set-objects?view=playfab-rest), [official Python SDK ticket exchange](https://github.com/PlayFab/PythonSdk/blob/master/playfab/PlayFabAuthenticationAPI.py).

Additional browser regressions passed: five Profile/account/storage-failure checks, plus two game-startup checks for simultaneous game tabs and journal recovery before controller initialization. A startup lock-order issue found during review was fixed before completion: new game tabs now acquire shared locks directly unless a recovery journal requires exclusive recovery.

## Real-title test preparation — 18 November 2026

`cloud-test.html` is ready with a separate `AROWGO_CLOUD_PROBE=1` endpoint. Normal `AROWGO_CLOUD_SYNC` remains 0 and the Vite sync flag remains off. The account service was restarted with only the probe enabled, so the user must authenticate again.

The probe reads the normal cloud save before/after, writes synthetic 19/7/19-gem fixtures only to `arowgo-sync-probe-v1` and `arowgo-sync-probe-previous-v1`, verifies independent read-back, rejects a stale revision, and restores the first synthetic snapshot in PlayFab. Browser restore runs against a Map-backed storage object and verifies its recovery copy, while real local save bytes are compared before/after without writes. Probe objects remain as diagnostic fixtures; no normal save object is written. Normal save writes now require read-back verification before reporting success.

The probe itself passed a regression test with a populated normal save, and its browser page passed an isolated mocked test confirming the real localStorage remained byte-for-byte unchanged. These are not live PlayFab results. Waiting for the user's reauthentication and test execution; do not enable normal sync until the real page reports PASS.

## Live gate passed; development sync enabled — 19 November 2026

The user supplied the real test page PASS screenshot. The backend independently logged that real PlayFab write/read/conflict/restore passed and the normal cloud save was unchanged. Browser PASS confirms isolated restore/recovery and unchanged local save bytes. This supersedes earlier pending-live-test notes.

Enabled manual sync in ignored .env.development.local: AROWGO_CLOUD_SYNC=1, VITE_AROWGO_CLOUD_SYNC=1; probe disabled with AROWGO_CLOUD_PROBE=0. account:server loads this optional local environment file. Both development services restarted. Verified the real cloud endpoint requires authentication (401), the probe is disabled (503), and a mocked signed-in Profile shows Manage cloud save. Build passed. No normal save upload or restore was performed while enabling.

Sign in again after the service restart, then use Profile → Account → Manage cloud save. Uploads/restores require explicit choices; no background sync or currency addition. Production remains gated off. Currency is still legacy local-save data, not an authoritative paid wallet. Recreate the ignored local flags deliberately on another workstation.

## Automatic completion uploads — 19 November 2026

Enabled VITE_AROWGO_AUTO_SYNC=1 in the ignored development environment only, after tests passed. Production remains gated off. A story-mode transition to complete triggers sync only after SaveStore.save succeeds. Practice, failed local saves and repeated clicks on an already-complete board do not trigger uploads. Uploads contain complete raw snapshots; no balances, rewards or stars are merged.

A confirmed manual upload or restore establishes `arowgo.cloud.anchor.v1` with the account and revision. Existing users without this marker must confirm one upload/restore in Manage cloud save. Signing into another account cannot reuse the marker: each request checks the current authenticated account. Account changes and remote revision conflicts pause uploads for manual resolution.

A durable pending operation marker survives reload/offline periods. A separate cross-tab Web Lock serializes uploads. Completions arriving during an upload are coalesced into a follow-up snapshot. Retry occurs on next startup, the browser online event, another completion or the Account retry button; there is no unbounded timer retry loop. An ambiguous response is reconciled by reading cloud bytes first; matching snapshots need no duplicate write. Conflicting snapshots are never automatically replaced. Gameplay saves are never written by the automatic-sync engine.

Verification: 253 tests in 32 files passed and production build passed. Ten completion-sync tests cover exact snapshot/revision, no-anchor gating, remote conflict, offline pending retry, lost-response reconciliation, changed account, overlapping completions, practice and failed-save exclusion. Isolated browser runner `tmp/check-auto-sync.mjs` enabled the flag on a separate test Vite, completed Level 1 through actual arrow controls, verified one upload and 25 saved coins, then tested a newer remote revision: no upload and 25 local coins retained. Browser cloud responses were mocked; the underlying real PlayFab transport was verified in the preceding live probe. Enabling the feature did not upload user data itself.

## Save feedback and account-page redesign — 19 November 2026

Generated a transparent cloud-vault illustration using the built-in image generator and copied it to public/assets/account/cloud-vault-v1.png. The original remains under Codex generated_images. No text is embedded in the asset. Sign-in and cloud-save pages share the illustration, Matcha headings, Satoshi body type, lavender backgrounds and rounded controls. Mobile compresses the illustration beside the heading; comparison, confirmation, error and recovery controls remain accessible HTML. Google retains its standard sign-in button.

Added save badges during play and next to the result level label. States include saved locally, uploading, verified cloud save, offline, conflict and local-save failure. Selecting the badge opens Profile → Account. Local mutations clear an old cloud-success label; if gameplay changes while an upload is in flight, the status says the newer progress is local. A local storage failure takes precedence over cloud-success messaging. Reduced-motion settings suppress decorative animation.

Verification: 31 focused sync/restore tests passed; sign-in success/error/restored-session browser checks passed; six responsive play layouts passed; win/defeat result layouts passed at phone/desktop/landscape sizes after fixing the compact result header. Cloud comparison layouts passed at widths 320, 390 and 1280. Actual level-input browser tests with mocked cloud confirmed one completion upload and conflict preservation of local coins. Build passed with the existing bundle-size warning. No real player save was uploaded/restored during visual testing.

## 19 November 2026 — staged economy backend

Wallet, idempotent first-clear rewards, atomic chest/boost purchases and operator-reviewed migration primitives are implemented behind the default-off AROWGO_ECONOMY switch. See [Server economy foundation](SERVER-ECONOMY.md) for tested behavior and remaining client migration/rollout gates. Live browser balances and cloud-save sync have not been switched to this ledger.

## 19 November 2026 — account economy integration

Added migration review/export and reviewed import CLI, account-specific save activation, game wallet/shop/boost integration, durable completion retries and purchase receipt recovery. The development ledger stays opt-in; original local saves are preserved. Account-wallet mode pauses legacy cloud snapshot uploads; account-scoped cross-device progress is still a production rollout requirement. Current workflow and limitations: [Server economy](SERVER-ECONOMY.md).

## 19 November 2026 — progress sync step 1

Migrated account wallets now save best stars and equipped skin alongside server clear receipts. Better replays update stars without repeat coin awards. Equipment changes validate ownership and use revision checks with retryable receipts. Reviewed legacy snapshots seed additive database upgrades without resetting balances or newer choices. Desktop and phone integration tests cover two-to-three-star replay upgrades and recovery of a dropped equipment response. Second-device restore/activation is still the next phase; see SERVER-ECONOMY.md.

Verification for progression sync step 1: all 286 unit tests across 37 files passed; desktop and phone account-economy browser tests passed; formatting, TypeScript and production build passed. Tests used synthetic accounts and isolated ledgers. Existing Phaser bundle-size warning remains.
