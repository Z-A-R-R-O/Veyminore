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

## Account progression sync — step 1, 19 November 2026

Migrated account wallets now persist completed level IDs, best stars and equipped skin in the same development account database. The `wallet` response includes `progress` (`levelId`, `bestStars`) and `preference` (`equipped`, `revision`). This step saves account data; second-device activation and puzzle-save restoration remain the next step.

Completion records now include elapsed time. The server replays the transcript to verify the clear and accuracy star. Speed uses the reported device elapsed time and the level target (including a server-granted boost); this is not trusted wall-clock anti-cheat. An attempt's first recorded score is immutable. A new replay may raise best stars but cannot reduce them or grant the first-clear coins again. A star-only upgrade advances the account revision without changing balances. Older commands with no timing still work and cannot claim a speed star.

A dedicated `equip` command requires an owned skin and the expected preference revision. Stale choices are rejected and refreshed for the player to choose again. An uncertain response keeps the original operation ID/revision and is recovered on reconnect or reload. No currency is spent when changing equipped skin.

Database upgrades are additive. Reviewed migration snapshots seed missing star and equipment records. Existing server clears without a reviewed star record receive the completion star; subsequent verified runs can improve it. Existing local best stars remain untouched. Reopening the database never replaces newer star records or equipped choices with the old backup.

The completion queue now identifies acknowledgements per attempt, so replays of an already-cleared level still synchronize their score. Account > Retry account sync also retries pending equipment changes. Original legacy saves and balances are unchanged. This development preview continues to use local server SQLite, not a newly deployed PlayFab progress service.

## Second-device account restore (2026-11-19)

Implemented for the development account-wallet preview. Profile links to **Review or restore account**; a signed-in player can preview completed levels, total best stars, equipped skin and server balances, then explicitly confirm a new-device restore.

- Reads the authenticated account overview; never imports the new device's local currency into the wallet.
- Requires a reviewed account migration. Checks account identity and wallet revision again on confirmation; changed server state requires a fresh preview.
- Preserves original legacy keys byte-for-byte. Creates a downloadable recovery backup before any account-save replacement, journals the previous namespace, verifies writes and binds the account last.
- Uses the exclusive save lock; another game tab prevents restoration. Interrupted restoration rolls back before game startup. Storage failures retain the recovery journal for retry.
- Restores all known level completion flags and best stars into fresh, valid boards, plus owned/equipped skin metadata. Partially played boards restart. Existing bound account saves are not overwritten by this initial-restore flow.
- Currency remains server-authoritative. Restore issues no grant, purchase or completion operation. Name/avatar and partially played boards are not synchronized by this feature.

Validation: 292 unit tests and production build pass. Focused browser coverage uses isolated browser contexts against a real in-memory wallet ledger, not player balances. This remains a single-host development ledger, not a production PlayFab Economy deployment.

Browser verification: all four focused desktop/phone restore and wallet regression checks pass, including two isolated device contexts, stale preview rejection, lost purchase responses and reloads. Interrupted-write rollback and retry are covered by unit tests.
