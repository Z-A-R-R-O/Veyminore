# Server economy — 19 November 2026

Status: integrated development preview, default-off on the account server. No real player was migrated or charged during verification. Production deployment remains separate.

## Delivered

- Account-bound SQLite wallet, balance constraints, transaction history and durable operation receipts. Exact retries return the original result; changed payloads cannot reuse a receipt.
- First-clear reward validation against all 40 canonical campaign levels. Recorded select and free erase actions are replayed against the game's rules, including keg expiry and stranded-board failure. A stable level ID earns 25 coins only once.
- Server-priced chest purchases with cryptographic rolls, duplicate refunds, saved inventory and recovery of the last discovery. Payment and reward commit together.
- Starter gem and welcome-chest claims once per account. Three-gem time boosts grant once per server attempt; the client applies a retained receipt once to its local attempt.
- Migration review/export page, operator import command, atomic source-backup archive, hash-matched activation and account-specific save copies. Existing original saves remain available for recovery.
- Main game integration for wallet display, shop, gift, boosts and result feedback. Completion transcripts are queued durably, retried after reconnection, and survive leaving a board.
- One account-game tab at a time using Web Locks. Session identity is rechecked on each request and the server checks the expected account before a mutation.

## Development workflow

Use Node 24. Run the existing Google/PlayFab account development server and Vite preview. Keep `.env.development.local`, `.local/`, migration packets and wallet database files out of Git.

1. From Profile > Account, open **Review account wallet** (`/economy.html`). Close other game tabs. Download the migration review; it includes the complete raw recovery snapshot and proposed entitlements.
2. Inspect it with `node server/economy/migrate.mjs review <packet.json>`. Review balances, cleared levels, collection and the source snapshot. This command validates the transaction in an isolated in-memory ledger.
3. Import the reviewed packet with `node server/economy/migrate.mjs import <packet.json> --reviewed`. The exact approval UUID can be retried without adding balances twice. Importing over an existing earned wallet or a different prior import is rejected.
4. Set `AROWGO_ECONOMY=1` for the development account server and restart it. Database location is `.local/economy.sqlite`. A restart may require Google sign-in again.
5. Reopen the review page and select **Use reviewed account wallet**. Activation requires a matching current local snapshot hash. If local progress changed after review, activation stops. It never overwrites an account save with a newly changed legacy save.

The binding marker is written only after the recovery copy and all account save copies succeed. Account game storage uses `arowgo.economy.<account>.save.*`. The original legacy keys are untouched. Switching to a different Google account pauses the bound game; it does not merge wallets or silently fall back to legacy spending.

## Recovery and authority

Legacy saves are unverified. Reviewing a migration is a grandfathering decision, not proof of historical purchases. The manifest contains exact reviewed balances, cleared stable level IDs, owned skins and gift claims. The entire source is archived in the ledger transaction and exported before activation. Equipped skin, profile details, previous boost receipts and progress remain in the account copy.

The account ledger is the spending/reward authority. Legacy per-level coin fields remain progression metadata in the copied saves and are not included in account balances. No max/addition/last-write-wins wallet merge is used. An uncertain purchase retains its operation ID until its response and wallet refresh succeed. Explicitly rejected unaffordable/invalid purchases release the pending intent. Recovery can require retrying the same chest before another purchase.

Account-wallet preview deliberately pauses legacy automatic cloud snapshot uploads. PlayFab legacy snapshots do not carry authoritative wallet data. Account-scoped puzzle saves currently remain on this device; server wallet/collection/clear receipts persist in the development database. Full cross-device account progress and production persistence are not enabled by this change.

Old in-progress saves without a move transcript must be replayed to validate a new reward. Existing paid boost receipts are retained and applied idempotently. A server attempt expires after 24 hours; restart an expired attempt to buy a new boost or submit a new run. Free Erase retains the prototype's assisted-clear behavior.

## Deployment boundary

This is a single-host development ledger, not PlayFab Economy V2 or a deployed production wallet. The account server still refuses production mode. Before a paid launch: select production hosting/storage, implement automated ledger backup/restore and monitoring, account-scoped progress synchronization, durable authentication sessions, rate limiting and operational recovery. Legal-move replay validates puzzle transitions; it is not proof of human play. Current prices/odds match the existing 15-skin prototype; the proposed 100-skin catalog is a separate roadmap item.

## Verification

Synthetic unit tests cover all 40 canonical solutions, idempotence, ownership, conflicting operation IDs, expiry, progression, durable reopen, duplicate refunds, insufficient funds, boosts, migration hash/account mismatch, exact balances, recovery preservation, storage failures and transaction rollback at the balance cap. Browser tests exercise reviewed activation, a real isolated SQLite ledger, completing a puzzle, losing a paid-chest response, retrying without double charge, reload persistence and a paid boost on desktop and phone. No real PlayFab player wallet or user save is used in these tests.
