# Production account and ledger infrastructure specification

Production architecture, durable sessions, rate limiting, and disaster recovery runbooks. Reconciled 20 November 2026. [Production deployment](DEPLOYMENT-PRODUCTION.md) · [Account services](ACCOUNT-SERVICES.md) · [Server economy](SERVER-ECONOMY.md) · [Cloud recovery guide](CLOUD-SAVE-RECOVERY.md).

---

## 1. Production architecture and topology

AROWGO separates high-performance client gameplay (served as a static SPA from Vercel Edge CDN) from authoritative account, economy, and cloud persistence services.

```
                          PUBLIC INTERNET
                                 |
        +------------------------+------------------------+
        | (HTTPS / Client HTML)                           | (HTTPS / Authoritative API)
        v                                                 v
+-------------------------------+             +---------------------------------------+
|        Vercel Edge CDN        |             |       Production Account Service      |
|     https://arowgo.vercel.app |             |           api.arowgo.app / :4174      |
|                               |             |                                       |
| - Prebuilt Vite SPA           |             | - Node.js 24 LTS                      |
| - Satoshi & Matcha fonts      |             | - Origin & Host Header Verification   |
| - Canvas & SVG arrow assets   |             | - Sliding-Window Rate Limiter         |
| - 100 canonical puzzle boards |             | - Health Probes (/api/arowgo/v1/health)|
+-------------------------------+             +---------------------------------------+
                |                                                 |
                | Load in browser                                 | Auth, Wallet & Sessions
                v                                                 v
+-------------------------------+             +---------------------------------------+
|         Client Browser        |             |      Durable Persistent Storage       |
|                               |             |            (NVMe Volume /data)        |
| - Local storage (offline-first|             |                                       |
| - Web Locks (single tab)      |             | - sessions.sqlite (Durable sessions)  |
| - CSRF & Cookie management    |             | - economy.sqlite (WAL Ledger & Wallet)|
| - Account restore flows       |             | - backups/ (Point-in-time snapshots)  |
+-------------------------------+             +---------------------------------------+
                                                                  |
                                                                  | Server-to-Server OIDC
                                                                  v
                                              +---------------------------------------+
                                              |       External Cloud Providers        |
                                              |                                       |
                                              | - Google OIDC (Token verification)    |
                                              | - PlayFab (116A87 Entity Objects)     |
                                              +---------------------------------------+
```

---

## 2. Hosting platform and storage selection

### Compute platform
The account backend is packaged as a containerized Node.js 24 service running under one of the following production targets:
- **Primary Target**: Fly.io or Render with an attached persistent NVMe volume mounted at `/data`.
- **Alternative Target**: Google Cloud Run with Cloud Storage FUSE / Cloud SQL, or dedicated Linux VPS with systemd and automated volume backups.

### Persistence model: SQLite WAL mode
AUTHORITATIVE DATA:
- `economy.sqlite`: Ledger transactions, wallet balances, first-clear receipts, inventory, and completed progress.
- `sessions.sqlite`: Active authenticated sessions, CSRF tokens, and auth rate-limit attempts.

Pragmas enforced on all database handles:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;
```

**Why SQLite WAL mode for AROWGO**:
1. **Single-Writer Atomicity**: AROWGO player wallet operations and level completions are serialized per account using strict database transactions (`BEGIN IMMEDIATE`). SQLite WAL supports concurrent readers while writers execute with sub-millisecond latency.
2. **Zero Network Latency**: In-process database queries eliminate database network round-trips (typically 5–15ms per query with remote Postgres), ensuring wallet verification finishes in under 2ms.
3. **Capacity**: The full 100-level reward ledger across 100,000 active players requires less than 250 MB of disk storage, easily fitting within standard persistent SSD volumes.
4. **Horizontal Scaling Path**: If concurrent writes ever exceed single-host NVMe capacity (>2,000 writes/sec), the schema cleanly migrates to Managed PostgreSQL or PlayFab Economy V2 without changing API contracts.

---

## 3. Durable session store (`session-store.mjs`)

Development previously kept sessions in a transient memory map, causing all players to be logged out whenever the process restarted. The production service uses `openSessionStore` (`server/account/session-store.mjs`).

### Schema
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  expires INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
```

### Key properties
1. **Map-compatible interface**: Implements `get`, `set`, `delete`, `has`, `clear`, `size`, and `[Symbol.iterator]` to plug seamlessly into `createAccountService`.
2. **Transparent mutation synchronization via recursive Proxy**: When service code modifies `session.account`, `session.ticket`, or `session.attempts`, the Proxy traps the assignment and immediately commits the update to SQLite.
3. **Automated TTL pruning**: Sessions default to 1-hour TTL (`3600` seconds). Expired sessions are pruned automatically during reads and iterators.
4. **Zero-downtime container restarts**: Deployed containers, process crashes, or health restarts retain player sign-in state.

---

## 4. Sliding-window rate limiting (`rate-limiter.mjs`)

To protect authentication endpoints and server-wallet mutations against brute-force attacks, credential stuffing, and denial-of-service, `createRateLimiter` (`server/account/rate-limiter.mjs`) runs at the HTTP gateway layer.

### Gate parameters

| Endpoint group | Window | Limit per IP | Violation response |
| --- | --- | --- | --- |
| **General API** (`/session`, `/cloud`, `/economy`) | 60 seconds | 120 requests | HTTP 429 `{ error: "rate-limited", retryAfter }` |
| **Auth flows** (`/google/flow`, `/google/sign-in`, `/link`) | 60 seconds | 5 attempts | HTTP 429 `{ error: "rate-limited", retryAfter }` |
| **Health probe** (`/api/arowgo/v1/health`) | Unmetered | Unlimited | Always HTTP 200 |

### Response headers on rate limit
When a client exceeds limits, the server responds with HTTP 429 and standard headers:
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 42
Cache-Control: no-store

{
  "error": "rate-limited",
  "retryAfter": 42
}
```

---

## 5. Ledger integrity and balance reconciliation

AROWGO enforces mathematical balance invariants across all economy operations. The wallet balance is not an independent arbitrary counter; it is strictly reconciled against the immutable `ledger` table.

### Balance invariant formula
For every account record in `wallets`:
$$\text{wallets.coins} = \sum_{\text{account}} \text{ledger.coins}$$
$$\text{wallets.gems} = \sum_{\text{account}} \text{ledger.gems}$$
$$\text{wallets.coins} \ge 0, \quad \text{wallets.gems} \ge 0$$

### Verification logic (`verifyLedgerIntegrity`)
`server/economy/backup.mjs` provides `verifyLedgerIntegrity(dbOrPath)` which executes:
1. `PRAGMA integrity_check`: Validates B-Tree formatting and page allocation.
2. `PRAGMA foreign_key_check`: Confirms zero orphaned attempts, clears, or inventory rows.
3. Reconciliation query:
   ```sql
   SELECT
     w.account,
     w.coins,
     w.gems,
     COALESCE(SUM(l.coins), 0) AS expected_coins,
     COALESCE(SUM(l.gems), 0) AS expected_gems
   FROM wallets w
   LEFT JOIN ledger l ON w.account = l.account
   GROUP BY w.account
   ```
   If any discrepancy is found, it immediately throws with the exact account ID and deltas.

---

## 6. Automated backup and disaster recovery runbook

### Online consistent snapshots
Because SQLite is configured in WAL mode, taking backups via simple file copying can corrupt WAL state. The system uses SQLite's online backup engine via `VACUUM INTO` in `createLedgerBackup()`.

### Backup manifest (`.json`)
Every backup produces a paired manifest:
```json
{
  "schemaVersion": 1,
  "backupFile": "arowgo-ledger-1732145678000.sqlite",
  "timestamp": 1732145678000,
  "createdAt": "2026-11-20T17:21:18.000Z",
  "sha256": "4a7b8e...3f12",
  "sizeBytes": 147456,
  "stats": {
    "accountCount": 142,
    "transactionCount": 1820,
    "totalCoins": 42500,
    "totalGems": 2840
  },
  "status": "verified"
}
```

### CLI tools

```powershell
# 1. Create a point-in-time verified ledger backup
node scripts/backup-ledger.mjs /data/economy.sqlite /data/backups

# 2. Check integrity and invariants of an active or restored database
node scripts/verify-ledger.mjs /data/economy.sqlite

# 3. Dry-run verify a backup file before restoring
node scripts/restore-ledger.mjs /data/backups/arowgo-ledger-1732145678000.sqlite --verify-only

# 4. Perform live database restoration (automatically creates .pre-restore safety backup)
node scripts/restore-ledger.mjs /data/backups/arowgo-ledger-1732145678000.sqlite /data/economy.sqlite
```

### Backup retention schedule
- **Hourly snapshots**: Retained locally for 24 hours in `/data/backups/`.
- **Daily snapshots**: Retained for 7 days.
- **Weekly archive**: Uploaded off-site to Google Cloud Storage (`gs://arowgo-production-ledger-backups/`) with versioning and object holds enabled.

---

## 7. Health probes, observability, and monitoring

### Container health probe endpoint
`GET /api/arowgo/v1/health`
- Unauthenticated, zero-overhead endpoint.
- Returns HTTP 200 when service is healthy.
- Output:
  ```json
  {
    "status": "ok",
    "service": "arowgo-account",
    "timestamp": "2026-11-20T17:25:00.000Z",
    "uptimeSeconds": 86420,
    "economy": true
  }
  ```

### Key operational alerts

| Alert condition | Severity | Action |
| --- | --- | --- |
| Health probe non-200 for > 30s | Critical (P0) | Container orchestrator auto-restart; page on-call |
| 5xx error rate > 1% over 5m | High (P1) | Check PlayFab API status and SQLite lock metrics |
| SQLite lock timeout (`busy_timeout`) | High (P1) | Check disk IOPS and uncommitted transactions |
| Balance invariant failure | Critical (P0) | Halt write operations; investigate fraud or disk failure |

---

## 8. Operational environment variables

```bash
# Production server enablement (mandatory for production boots)
AROWGO_PRODUCTION_SERVER=1
NODE_ENV=production

# Server networking
PORT=4174
AROWGO_HOST=0.0.0.0
AROWGO_ALLOWED_ORIGIN=https://arowgo.vercel.app

# Persistent storage paths
AROWGO_DATA_DIR=/data
AROWGO_DATABASE_PATH=/data/economy.sqlite
AROWGO_BACKUP_DIR=/data/backups

# Features
AROWGO_ECONOMY=1
AROWGO_DURABLE_SESSIONS=1
AROWGO_RATE_LIMIT_WINDOW_MS=60000
AROWGO_RATE_LIMIT_MAX=120

# Cloud credentials
GOOGLE_CLIENT_ID=169221851812-g5sp0sl7ingtl54t748qr0sajfnu6ej6.apps.googleusercontent.com
PLAYFAB_TITLE_ID=116A87
```
