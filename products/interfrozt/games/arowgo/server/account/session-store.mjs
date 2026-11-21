import { DatabaseSync } from "node:sqlite";

/**
 * Durable SQLite-backed session store for AROWGO account service.
 * Implements a Map-compatible interface so it can be seamlessly passed into createAccountService.
 * Sessions are automatically wrapped in a Proxy so any mutation (s.account, s.ticket, s.busy, etc.)
 * is immediately persisted to the underlying SQLite database in WAL mode.
 */
export function openSessionStore(
  dbOrPath,
  { now = Date.now } = {},
) {
  const isOwner = typeof dbOrPath === "string" || dbOrPath instanceof URL;
  const db = isOwner ? new DatabaseSync(dbOrPath) : dbOrPath;

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      csrf TEXT NOT NULL,
      expires INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
  `);

  const selectStmt = db.prepare("SELECT csrf, expires, data FROM sessions WHERE id = ?");
  const deleteStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  const pruneStmt = db.prepare("DELETE FROM sessions WHERE expires <= ?");
  const countStmt = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE expires > ?");
  const allStmt = db.prepare("SELECT id, csrf, expires, data FROM sessions WHERE expires > ?");

  function persist(id, s) {
    const { csrf, expires, ...rest } = s;
    db.prepare(`
      INSERT INTO sessions (id, csrf, expires, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        csrf = excluded.csrf,
        expires = excluded.expires,
        data = excluded.data
    `).run(id, csrf, expires, JSON.stringify(rest));
  }

  function wrap(id, rawSession) {
    function makeProxy(target) {
      return new Proxy(target, {
        get(t, prop) {
          const val = t[prop];
          if (val && typeof val === "object") {
            return makeProxy(val);
          }
          return val;
        },
        set(t, prop, value) {
          t[prop] = value;
          try {
            persist(id, rawSession);
          } catch {
            // Keep in-memory mutation even if DB write encounters transient lock
          }
          return true;
        },
      });
    }
    return makeProxy(rawSession);
  }

  // Active proxy cache in memory for reference equality within process
  const cache = new Map();

  return {
    get(id) {
      this.prune();
      if (cache.has(id)) {
        const cached = cache.get(id);
        if (cached.expires > now()) return cached;
        cache.delete(id);
      }
      const row = selectStmt.get(id);
      if (!row) return undefined;
      if (row.expires <= now()) {
        deleteStmt.run(id);
        return undefined;
      }
      let rest = {};
      try {
        rest = JSON.parse(row.data);
      } catch {
        rest = {};
      }
      const raw = {
        csrf: row.csrf,
        expires: row.expires,
        account: rest.account ?? null,
        ticket: rest.ticket ?? null,
        flow: rest.flow ?? null,
        busy: rest.busy ?? false,
        cloudBusy: rest.cloudBusy ?? false,
        attempts: Array.isArray(rest.attempts) ? rest.attempts : [],
      };
      const proxy = wrap(id, raw);
      cache.set(id, proxy);
      return proxy;
    },

    set(id, s) {
      persist(id, s);
      const proxy = wrap(id, { ...s });
      cache.set(id, proxy);
      return this;
    },

    delete(id) {
      cache.delete(id);
      const res = deleteStmt.run(id);
      return res.changes > 0;
    },

    has(id) {
      return this.get(id) !== undefined;
    },

    clear() {
      cache.clear();
      db.prepare("DELETE FROM sessions").run();
    },

    prune() {
      const current = now();
      pruneStmt.run(current);
      for (const [id, s] of cache) {
        if (s.expires <= current) cache.delete(id);
      }
    },

    get size() {
      this.prune();
      const row = countStmt.get(now());
      return row?.count ?? 0;
    },

    *[Symbol.iterator]() {
      this.prune();
      const rows = allStmt.all(now());
      for (const row of rows) {
        let rest = {};
        try {
          rest = JSON.parse(row.data);
        } catch {}
        const raw = {
          csrf: row.csrf,
          expires: row.expires,
          account: rest.account ?? null,
          ticket: rest.ticket ?? null,
          flow: rest.flow ?? null,
          busy: rest.busy ?? false,
          cloudBusy: rest.cloudBusy ?? false,
          attempts: Array.isArray(rest.attempts) ? rest.attempts : [],
        };
        const proxy = wrap(row.id, raw);
        cache.set(row.id, proxy);
        yield [row.id, proxy];
      }
    },

    close() {
      cache.clear();
      if (isOwner) {
        db.close();
      }
    },
  };
}
