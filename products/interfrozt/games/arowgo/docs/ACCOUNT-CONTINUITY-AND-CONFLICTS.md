# Account continuity and conflict resolution policy

Updated 20 November 2026. Governs cross-device state synchronization, mid-puzzle session lifecycle, appearance persistence, and deterministic conflict resolution across guest and authenticated accounts.

See [account and currency flows](ACCOUNT-CURRENCY-FLOWS.md) for balance ownership, [account services](ACCOUNT-SERVICES.md) for API contract specifications, and [production infrastructure](PRODUCTION-ACCOUNT-INFRASTRUCTURE.md) for ledger durability and backup architecture.

---

## 1. Architectural scope: synchronized vs. device-local state

To guarantee deterministic puzzle simulation, prevent race conditions during rapid player moves, and eliminate multi-master corruption, AROWGO strictly partitions game state into **Cloud-Synchronized Account State** and **Device-Local Session State**.

| State category | Elements | Synchronization channel | Persistence layer |
| --- | --- | --- | --- |
| **Synchronized Account State** | Wallet balance, transaction ledger, unlocked skins, equipped arrow skin | Server Ledger API (`/api/arowgo/v1/economy`) | SQLite `wallets`, `transactions`, `unlocks`, `preferences` tables |
| **Synchronized Appearance** | Player avatar ID (`adventure-01`..`30`), frame ID (`frame-01`..`30`), display name | Server Ledger API (`action: "appearance"`) | SQLite `preferences(account, equipped, avatar, frame, name, revision)` |
| **Synchronized Campaign Progress** | Completed levels (1–100), best stars (1–3), fastest clear time (ms), first-clear coin awards | Cloud Save Envelope (PlayFab Entity Objects) + Server Ledger completion log | Multi-chunk envelope (up to 150 KB packed / 512 KiB raw) + SQLite `completions` table |
| **Device-Local In-Progress Board** | Active puzzle board, incomplete move log, undo history stack, current attempt ID, elapsed timer | **None (Device-local only)** | Local memory / transient storage |
| **Device-Local Preferences** | Music volume, SFX volume, haptic feedback toggle, hold preview inspect timer (400ms) | **None (Device-local only)** | Local `localStorage` client settings |

---

## 2. Cross-device appearance synchronization

Players can customize their identity across devices through their profile appearance:

1. **Avatar**: Canonical identifiers `adventure-01` through `adventure-30` (fallback: `"world"`).
2. **Frame**: Canonical identifiers `frame-01` through `frame-30` (fallback: `"frame-01"`).
3. **Display name**: Custom sanitized string up to 24 characters (fallback: `"Arrower"`).
4. **Equipped arrow skin**: Canonical skin ID (`"classic"`, `"mint"`, `"ember"`, etc.).

### Server ledger preferences schema

The ledger stores player customization with optimistic versioning in `server/economy/wallet.mjs`:

```sql
CREATE TABLE IF NOT EXISTS preferences (
  account TEXT PRIMARY KEY,
  equipped TEXT NOT NULL DEFAULT 'classic',
  avatar TEXT,
  frame TEXT,
  name TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account) REFERENCES wallets(account) ON DELETE CASCADE
);
```

### Optimistic concurrency control

Appearance updates use optimistic locking via `expectedRevision`:

```typescript
// Request payload to POST /api/arowgo/v1/economy
{
  "account": "user-uuid",
  "action": "appearance",
  "avatar": "adventure-04",
  "frame": "frame-02",
  "name": "PuzzleMaster",
  "expectedRevision": 1
}
```

- If `current.revision === expectedRevision`: The record is updated, `revision` is incremented to `current.revision + 1`, and the updated appearance is returned with HTTP 200.
- If `current.revision !== expectedRevision`: The server rejects the write with HTTP 409 Conflict (`{ error: "conflict", message: "Stale revision" }`), preventing a stale device from overwriting newer customizations made on another device.

### Restoration into local profile

When a player authenticates on a new or wiped device, `accountRestorePlan` in `src/account/account-restore.ts` fetches the remote preference record, validates values using `isAvatar()` and `readAvatarFrame()`, and restores them into local `arowgo.profile.v1`:

```typescript
const restoredProfile = {
  ...currentProfile,
  name: preference.name || currentProfile.name,
  avatar: isAvatar(preference.avatar) ? preference.avatar : currentProfile.avatar,
  frame: readAvatarFrame(preference.frame, currentProfile.frame),
};
```

---

## 3. In-progress board state and clean restart policy

### Why in-progress boards are not synchronized

Synchronizing incomplete, mid-puzzle board moves across devices introduces severe failure modes:
- **Solver and collision desynchronization**: Replaying partial snake moves across varying device frame rates risks out-of-sync obstacle collision checks.
- **Race conditions**: If two devices have the same level open, simultaneous moves create irreconcilable branch divergence in move transcripts.
- **Latency friction**: Requiring cloud round-trips per arrow move turns an instant 60 FPS local swipe interaction into a laggy, network-dependent experience.

### Clean restart rule for incomplete attempts

When an account is restored on a new device or re-downloaded from the cloud:
1. **Completed levels**: Recreated as finished boards with verified star ratings, fastest recorded times, and `claimed: true` first-clear records.
2. **Incomplete levels**: Recreated cleanly at move 0. All board obstacles, snakes, keys, anchors, and phase gates reset to initial level configuration. A fresh, cryptographically unique `attemptId` is generated, and the move log begins empty (`moveLog: []`).

This ensures the player always has a pristine, uncorrupted puzzle state to solve, while all permanent awards remain secure.

---

## 4. Conflict resolution matrix

When multiple devices operate concurrently or submit conflicting updates, AROWGO applies deterministic domain-specific resolution rules:

| Action / Event | Conflict scenario | Resolution rule | System guarantee |
| --- | --- | --- | --- |
| **First-Clear Coins** | Two devices clear the same level for the first time simultaneously | **Idempotent First-Commit**: The first clear to reach the server ledger receives 25 coins (`coins: 25`). The second completion receives 0 coins (`coins: 0`) and is flagged as duplicate. | Total campaign coin cap of 2,500 coins cannot be exceeded. |
| **Level Stars** | Device A achieves 2 stars; Device B achieves 3 stars on the same level | **Monotonic Maximum**: `stars = Math.max(starsA, starsB)`. | High scores are never downgraded. |
| **Clear Time** | Device A records 45,000ms; Device B records 38,500ms | **Monotonic Minimum**: `bestTime = Math.min(timeA, timeB)`. | Fastest record is preserved. |
| **Appearance Sync** | Device A and Device B update avatar/name concurrently | **Optimistic Revision Check**: Device supplying matching `expectedRevision` succeeds; stale device receives HTTP 409 Conflict and reloads latest appearance. | No silent overwrites; last known revision required. |
| **Wallet Purchases** | Device A and Device B both attempt to buy an item when balance only covers one | **Atomic Serializable Ledger**: SQLite `BEGIN IMMEDIATE` transaction verifies balance invariant (`balance >= cost`). First transaction commits; second fails with insufficient funds. | Balance cannot go negative; double-spend impossible. |
| **Cloud Save Transcripts** | Disconnected offline play creates divergent cloud save generations | **PlayFab ExpectedProfileVersion**: Commit requires expected version. On conflict, client prompts user to choose latest timestamp or inspect cloud recovery copy. | Zero silent data overwrites; recovery copy preserved in secondary chunk envelope. |

---

## 5. Account storage isolation and guest binding

AROWGO enforces strict storage key namespacing to isolate guest sessions from authenticated accounts and prevent multi-user device crossover.

### Namespaced local storage keys

Local storage keys are segregated by account identifier via `namespace(account)`:

```
# Guest unauthenticated storage
arowgo.save.v1
arowgo.profile.v1
arowgo.wallet.v1

# Authenticated account storage (e.g. user-abc-123)
arowgo.economy.user-abc-123.save.v1
arowgo.economy.user-abc-123.profile.v1
arowgo.economy.user-abc-123.wallet.v1
```

### Guest-to-authenticated binding flow

1. When a guest links a Google or PlayFab identity, their local completions and awards are migrated to the authenticated account's namespace.
2. The server ledger creates the wallet record via `accountRestorePlan`.
3. If an authenticated player signs out, the client switches back to the guest namespace without wiping or corrupting the authenticated account's local cache.
4. Switching between two distinct authenticated accounts (User A $\rightarrow$ User B) completely separates save files, profiles, and wallet balances without shared mutation.

---

## 6. Verification and test coverage

Account continuity and conflict resolution policies are verified by automated tests:

| Test file | Test description | Verified behavior |
| --- | --- | --- |
| `tests/account-continuity.test.ts` | Appearance sync across devices | Restores `avatar`, `frame`, and `name` into `arowgo.profile.v1` matching server ledger. |
| `tests/account-continuity.test.ts` | Optimistic concurrency locking | Validates `expectedRevision` check; rejects stale revision updates with HTTP 409. |
| `tests/account-continuity.test.ts` | Concurrent first-clear resolution | Verifies first clear receives 25 coins; concurrent second clear receives 0 coins and updates stars monotonically. |
| `tests/account-continuity.test.ts` | In-progress board clean restarts | Confirms uncompleted levels restart with move 0, empty move log, and unique `attemptId`. |
| `tests/account-continuity.test.ts` | Account storage isolation | Verifies guest and bound accounts maintain strictly partitioned storage keys. |
| `tests/account-restore.test.ts` | Full account restore workflow | Reconstructs 100-level completions, equipment, and profile defaults from remote state. |
| `tests/wallet.test.js` | Atomic wallet transactions | Tests idempotent first-clear awards, crate purchases, and skin equip persistence. |
