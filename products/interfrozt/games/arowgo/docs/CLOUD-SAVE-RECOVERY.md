# Cloud-save recovery and operating guide

Current contract and recovery guide. Reconciled 20 November 2026. [Account services](ACCOUNT-SERVICES.md) · [Server economy](SERVER-ECONOMY.md) · [Current state](CURRENT-GAME-STATE.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## 1. Overview and architecture

AROWGO implements an offline-first storage hierarchy. Gameplay never blocks on network responses, and client `localStorage` is the primary operational store for active play.

```
+-------------------------------------------------------------------------+
|                              Client Browser                             |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                     Active Gameplay (localStorage)                |  |
|  |   - arowgo.profile.v1     (Profile, coins spent, gems, inventory)  |  |
|  |   - arowgo.slice.v1       (Level 01 active session state)         |  |
|  |   - arowgo.level.<id>.v1  (Levels 02-100 session records)         |  |
|  +-------------------------------------------------------------------+  |
|              |                                           ^              |
|              | Local backup & journal                    | Exclusive    |
|              v (pre-write verification)                  | Web Lock     |
|  +-------------------------------------+                 | restore      |
|  |       Local Recovery Safeguards     |                 |              |
|  |   - arowgo.cloud.recovery.v1        |-----------------+              |
|  |   - arowgo.cloud.restore-journal.v1 |                                |
|  +-------------------------------------+                                |
+-------------------------------------------------------------------------+
                                    |
                                    | POST /api/arowgo/v1/account/cloud
                                    | (Development only, localhost:4173)
                                    v
+-------------------------------------------------------------------------+
|                  Development Account Server (127.0.0.1:4174)             |
|                                                                         |
|   - Node.js IPv4 HTTP service (refuses NODE_ENV=production)             |
|   - Validates snapshot entries <= 500, regex-checked keys, <= 512 KiB   |
|   - Compression: Gzip level 9 -> Brotli quality 6 -> Brotli quality 11  |
|   - Packed envelope gate: max 150,000 bytes (multi-chunk PlayFab store) |
+-------------------------------------------------------------------------+
                                    |
                                    | PlayFab Entity API (SetObjects)
                                    | ExpectedProfileVersion concurrency
                                    v
+-------------------------------------------------------------------------+
|                      PlayFab Entity Objects (116A87)                    |
|                                                                         |
|   - arowgo-save-v1          (Current save, head chunk <= 7,000 chars)   |
|   - arowgo-save-v1-chunk-i  (Indexed overflow chunks 1..N <= 7,000 ch)  |
|   - arowgo-save-previous-v1 (Previous generation rollback head chunk)   |
|   - arowgo-save-previous-v1-chunk-i (Previous generation chunks 1..N)   |
|   - arowgo-save-overflow-v1 (Legacy single-overflow backwards compat)   |
+-------------------------------------------------------------------------+
```

There are two distinct cloud mechanisms in the codebase:
1. **Legacy PlayFab Snapshot Sync** (`src/account/cloud-local.ts`, `cloud-api.ts`, `completion-sync.ts`, `server/account/cloud.mjs`): Development-only full raw `localStorage` snapshot stored in PlayFab entity objects.
2. **Reviewed Account Wallet Restore** (`src/account/account-restore.ts`, `account-restore-store.ts`, `server/economy/wallet.mjs`): Server SQLite ledger owning currencies, claims, and second-device cleared level reconstruction.

---

## 2. Envelope and size constraints (multi-chunk cloud capacity)

### Limits

| Gate | Limit | Mechanism | Violation outcome |
| --- | --- | --- | --- |
| Raw JSON size | **512 KiB** (`524,288` bytes) | `validateSnapshot` in `cloud.mjs` | HTTP 413 `save-too-large` |
| Entry count | **500 entries** | `validateSnapshot` in `cloud.mjs` | HTTP 400 `invalid-save` |
| Packed envelope | **150,000 bytes** | `packSnapshot` in `cloud.mjs` | HTTP 413 `save-too-large` |
| PlayFab object size | **8,000 bytes** per object | PlayFab `SetObjects` API limit | Multi-chunk slicing at 7,000 chars |
| Max chunks per snapshot | **30 chunks** (~210 KiB base64) | `fragment()` in `cloud.mjs` | Bounded within PlayFab 100-object limit |

### Multi-chunk fragmentation architecture

PlayFab entity objects enforce a strict limit of 8,000 bytes per `DataObject`. To store complete 100-level saves (with move attempt timestamps, UUID transcripts, star ratings, and backup entries) while maintaining atomic single-request commits:

- **Primary Object (`arowgo-save-v1`)**: Stores the save header, checksum metadata (`operationId`, `hash`, `encoding`, `profileVersion`), and chunk 0 (`data: base64.slice(0, 7000)`). If the payload requires multiple chunks, `chunkCount: N` is recorded on the object.
- **Indexed Overflow Chunks (`arowgo-save-v1-chunk-1` .. `arowgo-save-v1-chunk-${N-1}`)**: Overflow chunks are committed as discrete, indexed entity objects. Each chunk object contains `{ schemaVersion: 1, operationId, chunkIndex, totalChunks, data }`. With chunks sized at 7,000 characters, each JSON object safely occupies ~7,100 bytes, remaining well under the 8,000-byte PlayFab cap.
- **Atomic Previous-Generation Preservation**: `arowgo-save-previous-v1` and its indexed chunks (`arowgo-save-previous-v1-chunk-${i}`) preserve the preceding snapshot in its entirety.
- **Atomic Single-Call Commit**: All objects (current head, current chunks, previous head, previous chunks) are committed together in a single `SetObjects` call under `ExpectedProfileVersion`. PlayFab allows up to 100 objects per entity; using up to 30 chunks per generation consumes at most ~62 objects in the worst case.
- **Backward Compatibility**: Reading existing legacy saves that used the single `arowgo-save-overflow-v1` dictionary is fully supported. If `chunkCount` is omitted and `overflow: true`, the reader pulls the tail from `arowgo-save-overflow-v1`.

### Resolution of the realistic 80–100 level history capacity gap

In realistic play, every completed level writes an `arowgo.level.<id>.v1` entry containing run attempt timestamps, full UUID move transcripts, star ratings, and backup entries. 
- At **40 levels**: packed size is ~5.5–7.2 KiB (1 to 2 chunks).
- At **80 levels**: packed size reaches ~11–13 KiB (2 to 3 chunks).
- At **100 levels**: packed size reaches ~14–17 KiB (3 to 4 chunks).
- At **100 levels with heavy retries & migration archives**: packed size reaches 50–80 KiB (8 to 12 chunks), raw JSON ~200–400 KiB.

The multi-chunk architecture easily handles these realistic payloads up to 150,000 packed bytes (512 KiB raw), resolving the historical 10,700-byte single-overflow bottleneck without dropping any move history, transcripts, or recovery data.

### Zero-truncation guarantee

When `save-too-large` occurs:
- The server throws `AuthError(413, "save-too-large")`.
- The upload fails **intact**.
- **No data is dropped, trimmed, or stripped** to fit the quota.
- The player's local save in `localStorage` remains 100% complete and untouched.
- Auto-sync pauses and signals that the save exceeds current cloud capacity.

---

## 3. Failed uploads and network resiliency

### Upload failure causes and handling

| Cause | Error code | Client behavior | Local save safety |
| --- | --- | --- | --- |
| Network drop / timeout | `network` / `timeout` | Stored in `arowgo.cloud.anchor.v1` as `pending: operationId` | Unaffected; local write succeeded before sync |
| Provider down (PlayFab 502) | `cloud-unavailable` | Pauses sync; retries on next lifecycle event | Unaffected |
| Save exceeds packed cap | `save-too-large` | Pauses sync; notifies user | Unaffected; zero truncation |
| Account identity changed | `account-changed` | Halts sync; requires re-authentication | Unaffected |
| Concurrency conflict | `save-conflict` | Pauses sync; requires manual resolution | Unaffected |

### Idempotency via operationId and hash matching

Every save request generates a unique UUIDv4 `operationId` and computes a SHA-256 hash of the uncompressed JSON snapshot.

If a network timeout occurs after the server successfully writes to PlayFab, the client retries with the same `operationId`:
```javascript
// server/account/cloud.mjs
if (current.record?.operationId === operationId) {
  if (current.record.snapshot.hash !== packed.hash)
    throw new AuthError(409, "save-conflict");
  return view(current);
}
```
If the hash matches, the server returns the existing committed save record with HTTP 200 without throwing a conflict or double-writing.

### Lifecycle retries (no unconstrained polling)

`CompletionSync` (`src/account/completion-sync.ts`) orchestrates retries safely:
- Updates `arowgo.cloud.anchor.v1` with `{ accountId, version, pending: operationId }`.
- Retries flush only on:
  1. `online` browser window event.
  2. Tab focus / page visibility.
  3. Subsequent completed Story level (`arowgo-level-saved`).
  4. Explicit manual retry in Account settings.
- Practice mode never triggers cloud sync.
- Story completions only upload **after** local write to `localStorage` finishes.

---

## 4. Conflict handling and concurrency

### Concurrency model

Cloud sync uses optimistic concurrency control backed by PlayFab's `ExpectedProfileVersion`.

1. The client loads the current cloud state, receiving `ProfileVersion` (e.g., version 4).
2. When saving, the client sends `expectedVersion: 4`.
3. If another client or tab updated PlayFab in the interim, PlayFab returns `EntityProfileVersionMismatch`.
4. The server converts this into HTTP 409 `save-conflict`.

### Conflict pause policy

When a `save-conflict` occurs:
- `CompletionSync` halts automatic uploads immediately.
- The UI status updates to: `"Auto-sync paused: another cloud save exists. Resolve it in Manage cloud save."`
- **Neither save is overwritten**: cloud retains its remote version, and the local device retains its local version.
- Manual resolution in "Manage cloud save" (`src/account/cloud-page.ts`) displays both versions using `describeSave()`:
  - Local: Cleared level count, stars, net coins, gems.
  - Cloud: Saved timestamp, cleared level count, stars, net coins, gems.
- The player explicitly chooses whether to **Upload local save** (overwriting cloud) or **Restore cloud save** (replacing local save after safety backup).

---

## 5. Backups and safe recovery safeguards

### Exclusive Web Lock

Any restore or batch write operation must acquire the Web Lock:
```typescript
await navigator.locks.request("arowgo-save-access-v1", async () => { ... });
```
This prevents simultaneous writes or partial reads across multiple browser tabs.

### Crash-safe journaling (dual safety keys)

Before any gameplay key in `localStorage` is touched during a restore:

1. **Pre-verification**:
   - `validateBackup(target)` checks schema version 1, `gameId: "arowgo"`, trust level, and key patterns.
   - `validatePlayableRestore(target)` parses `arowgo.profile.v1` and every level session against both current and historical rules (`beforeDensityLevels`, `beforeHardeningLevels`, `beforeTimingLevels`).
   - `sameBackup(before, expected)` verifies that local storage has not changed between user confirmation and write execution.
2. **Dual safety keys written**:
   - `arowgo.cloud.recovery.v1`: Stores `{ schemaVersion: 1, accountId, before }`. Verified by immediate readback. **Retained permanently** after restore as a recovery fallback.
   - `arowgo.cloud.restore-journal.v1`: Stores `{ schemaVersion: 1, accountId, before }`. Verified by immediate readback. **Removed only after successful restore**.
3. **Interrupted restore rollback**:
   - If the browser tab crashes, reloads, or loses power mid-write, `recoverInterruptedRestore(storage)` runs on startup before any game module loads.
   - It detects the surviving `restore-journal.v1`, replaces all keys with the `before` state, verifies byte equality, and cleans up the journal.

### Account-wallet restore safety

In reviewed account-wallet mode (`src/account/account-restore-store.ts`):
- Local legacy keys (`arowgo.profile.v1`, etc.) are **never overwritten**.
- Account progress is namespaced under `arowgo.economy.<accountId>.save.<key>`.
- Dual keys `arowgo.economy.restore-recovery.v1` and `arowgo.economy.restore-journal.v1` protect writes.
- Rollback runs automatically on startup if `restore-journal.v1` is detected.

---

## 6. Step-by-step recovery procedures

### Procedure A: Automatic crash recovery (startup)

1. On app boot, before initializing React or Phaser, `src/account/cloud-local.ts` checks for `arowgo.cloud.restore-journal.v1`.
2. If present, it restores the complete `before` snapshot automatically.
3. The journal key is removed; gameplay initializes with pre-restore data intact.

### Procedure B: Manual rollback from recovery key (DevTools console)

If a player restored a cloud save and wishes to undo it, the pre-restore state is preserved in `arowgo.cloud.recovery.v1`:

```javascript
// Open Developer Tools -> Console on http://localhost:4173
const raw = localStorage.getItem("arowgo.cloud.recovery.v1");
if (!raw) {
  console.error("No recovery snapshot found.");
} else {
  const recovery = JSON.parse(raw);
  console.log("Restoring backup for account:", recovery.accountId);
  for (const entry of recovery.before.entries) {
    localStorage.setItem(entry.key, entry.raw);
  }
  console.log("Successfully restored", recovery.before.entries.length, "keys. Reloading...");
  location.reload();
}
```

### Procedure C: Resolving a cloud save conflict

1. Open **Settings** -> **Account** -> **Manage cloud save**.
2. Review the side-by-side comparison:
   - **Local device**: e.g., "60 levels cleared · 180 stars · 1,500 coins · 15 gems"
   - **Cloud save**: e.g., "55 levels cleared · 165 stars · 1,375 coins · 12 gems"
3. To keep local progress: Tap **Upload local save**. The client fetches the latest remote version number, packages local storage, and overwrites cloud with a fresh `operationId`.
4. To adopt cloud progress: Tap **Restore cloud save**. The client creates `arowgo.cloud.recovery.v1`, journals the action, and writes the cloud save to local storage.

### Procedure D: Handling `save-too-large` (80+ completed levels)

When a player reaches 80+ levels in development mode and receives `save-too-large`:
1. **Reassure player/tester**: All progress is safely saved on the local device. No progress or coins have been lost.
2. Local play continues normally without interruption.
3. Cloud sync will remain paused for this account until the multi-chunk entity envelope upgrade is deployed.
4. Export a local JSON backup (Procedure E) as an additional safety precaution.

### Procedure E: Emergency local save export

To create an offline JSON backup of all game progress directly from the browser:

```javascript
// Run in browser console on the game origin:
const backup = {
  exportedAt: new Date().toISOString(),
  origin: location.origin,
  keys: {}
};
for (let i = 0; i < localStorage.length; i++) {
  const k = localStorage.key(i);
  if (k && k.startsWith("arowgo.")) {
    backup.keys[k] = localStorage.getItem(k);
  }
}
console.log(JSON.stringify(backup, null, 2));
// Copy output or trigger download:
const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `arowgo-save-${Date.now()}.json`;
a.click();
```
