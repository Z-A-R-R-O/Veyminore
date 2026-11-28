# Account services: current contract

Updated 20 November 2026. [Setup](ACCOUNT-SETUP.md) · [Server wallet](SERVER-ECONOMY.md) · [Cloud recovery guide](CLOUD-SAVE-RECOVERY.md) · [Production deployment](DEPLOYMENT-PRODUCTION.md) · [Historical rollout](ACCOUNT-BACKEND-DEV.md).

## Identity

The web client obtains a Google Identity Services ID token with a server-issued, cookie-bound nonce. The backend verifies signature, issuer, audience, expiry and nonce, then uses PlayFab OpenID Connect connection `google-web`. Linking does not force-reassign accounts or merge by email. Tokens and PlayFab tickets stay out of localStorage. Profile Account opens the same-origin sign-in page and refreshes session state on return.

The old Google authorization-code experiment is historical. Live sign-in success was user-confirmed. Signing in or out alone never imports saves or grants currency.

## Legacy PlayFab snapshots

Manual sync uses independent server/client flags; automatic completion upload also needs its own client flag. These are development features. A confirmed manual upload/restore establishes an account/revision anchor before automatic uploads. Story completion uploads only after the local save succeeds; Practice and failed writes do not trigger it.

Snapshots preserve known raw save keys, rewards, balances and archives without currency merging. PlayFab `ExpectedProfileVersion` rejects stale writers. Identical operation retries reconcile with saved bytes; ambiguous outcomes are checked rather than blindly repeated. Account changes/conflicts pause for explicit resolution. Pending uploads survive offline periods and retry on relevant lifecycle events, not an unbounded timer.

Restore requires exclusive cross-tab access, a verified recovery copy and journal before writes. Interrupted restores roll back before gameplay starts. Original bytes are retained for recovery. Automatic sync never rewrites gameplay storage.

### Multi-chunk cloud capacity

The cloud envelope accepts up to 512 KiB raw data and 150,000 bytes packed using gzip/Brotli compression and multi-chunk PlayFab object fragmentation (up to 30 indexed chunk objects). Realistic UUID-rich move histories for 100 completed levels, backups, and migration archives fit losslessly within capacity. Current and previous snapshots preserve atomic single-request commits and integrity checks under `ExpectedProfileVersion`. Oversized uploads fail intact; zero data truncation is permitted. See [cloud recovery guide](CLOUD-SAVE-RECOVERY.md).

## Reviewed account wallet

This mode uses an authoritative SQLite server ledger, with account-bound balances, inventory, idempotent receipts and canonical completion replay. All 100 campaign IDs are in the reward manifest. First-clear rewards cannot be repeated; stars can improve on replay. Reported elapsed time is not trusted human-play anti-cheat.

Legacy import requires review, exported recovery data and an exact snapshot match. Original legacy keys stay intact; binding occurs last. Account-wallet mode pauses legacy automatic cloud snapshots. An explicit second-device flow restores known clears/stars, equipped skins, and appearance; partial boards restart cleanly at move 0 with a fresh attempt ID. See [wallet workflow and history](SERVER-ECONOMY.md) and [account continuity & conflict policy](ACCOUNT-CONTINUITY-AND-CONFLICTS.md).

## Production infrastructure

The account service supports both localhost development and containerized production modes (`AROWGO_PRODUCTION_SERVER=1`). Production features include durable SQLite session storage (`sessions.sqlite`), sliding-window IP rate limiting (`rate-limiter.mjs`), automated point-in-time database backups (`VACUUM INTO`), cryptographic manifests, ledger balance invariant verification, and container health probes (`/api/arowgo/v1/health`). See [production infrastructure guide](PRODUCTION-ACCOUNT-INFRASTRUCTURE.md) and [production deployment guide](DEPLOYMENT-PRODUCTION.md).
