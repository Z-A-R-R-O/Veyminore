/**
 * In-memory sliding-window rate limiter for AROWGO API.
 * Tracks request timestamps per key (client IP or account identifier)
 * and calculates precise Retry-After delays when limits are reached.
 */
export function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 120,
  now = Date.now,
} = {}) {
  const records = new Map();

  function pruneKey(timestamps, cutoff) {
    return timestamps.filter((t) => t > cutoff);
  }

  function pruneAll() {
    const cutoff = now() - windowMs;
    for (const [key, timestamps] of records) {
      const valid = pruneKey(timestamps, cutoff);
      if (valid.length === 0) {
        records.delete(key);
      } else {
        records.set(key, valid);
      }
    }
  }

  return {
    check(key = "default", cost = 1) {
      pruneAll();
      const cutoff = now() - windowMs;
      const current = pruneKey(records.get(key) ?? [], cutoff);
      if (current.length + cost > maxRequests) {
        const oldest = current[0] ?? now();
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldest + windowMs - now()) / 1000),
        );
        return {
          allowed: false,
          retryAfter: retryAfterSeconds,
          current: current.length,
          limit: maxRequests,
        };
      }
      for (let i = 0; i < cost; i++) {
        current.push(now());
      }
      records.set(key, current);
      return {
        allowed: true,
        retryAfter: 0,
        current: current.length,
        limit: maxRequests,
      };
    },

    reset(key) {
      if (key !== undefined) {
        records.delete(key);
      } else {
        records.clear();
      }
    },

    get size() {
      pruneAll();
      return records.size;
    },
  };
}
