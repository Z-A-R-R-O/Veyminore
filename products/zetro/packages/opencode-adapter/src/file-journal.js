/**
 * @file file-journal.js
 * Bounded, optional file-backed journal port for the OpenCode adapter.
 * Synchronous get/set semantics so intent is durably reserved before the
 * adapter dispatches prompt_async. Atomic durability: temp write + fsync +
 * rename. Persists only messageID, state, time, reason and optional digest —
 * never credentials, prompt text, or source. Not multiprocess-safe: a single
 * process owns the journal file; concurrent processes are out of scope.
 */

import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const defaultFs = require_('fs');
const defaultPath = require_('path');

const ALLOWED_FIELDS = new Set(['state', 'at', 'reason', 'digest']);
const MAX_ID_LENGTH = 512;
const MAX_REASON_LENGTH = 2048;
const MAX_DIGEST_LENGTH = 256;

export class JournalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JournalError';
    this.code = code;
  }
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new JournalError('journal_corrupt', 'journal entry must be an object');
  }
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new JournalError('journal_reject_field', `field "${key}" is not persisted by the journal`);
    }
  }
  if (typeof entry.state !== 'string' || entry.state.length === 0 || entry.state.length > 64) {
    throw new JournalError('journal_corrupt', 'entry.state must be a short non-empty string');
  }
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) {
    throw new JournalError('journal_corrupt', 'entry.at must be a finite timestamp');
  }
  const clean = { state: entry.state, at: entry.at };
  if (entry.reason !== undefined) {
    if (typeof entry.reason !== 'string' || entry.reason.length > MAX_REASON_LENGTH) {
      throw new JournalError('journal_corrupt', 'entry.reason must be a bounded string');
    }
    clean.reason = entry.reason;
  }
  if (entry.digest !== undefined) {
    if (typeof entry.digest !== 'string' || entry.digest.length === 0 || entry.digest.length > MAX_DIGEST_LENGTH) {
      throw new JournalError('journal_corrupt', 'entry.digest must be a bounded string');
    }
    clean.digest = entry.digest;
  }
  return clean;
}

function sanitizeId(messageID) {
  if (typeof messageID !== 'string' || messageID.length === 0 || messageID.length > MAX_ID_LENGTH) {
    throw new JournalError('journal_reject', 'messageID must be a bounded non-empty string');
  }
  return messageID;
}

/**
 * Create a file-backed journal port `{ get, set }` for createOpenCodeAdapter.
 * @param {object} options
 * @param {string} options.path explicit journal file path (required, no default)
 * @param {object} [options.fs] injected fs-compatible storage (tests/temp stores);
 *        defaults to node:fs. Must provide readFileSync, writeFileSync,
 *        renameSync; openSync/fsyncSync/closeSync enable fsync durability.
 * @param {number} [options.maxEntries] bound on journaled messageIDs (default 1000)
 */
export function createFileJournal({ path, fs = defaultFs, maxEntries = 1000 } = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new JournalError('journal_config', 'an explicit journal file path is required');
  }
  for (const fn of ['readFileSync', 'writeFileSync', 'renameSync']) {
    if (typeof fs[fn] !== 'function') {
      throw new JournalError('journal_config', `fs must provide ${fn}`);
    }
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new JournalError('journal_config', 'maxEntries must be a positive integer');
  }

  const tmpPath = `${path}.tmp`;
  let records = null;
  let corrupt = null;

  function load() {
    if (records) return records;
    if (corrupt) throw corrupt;
    let raw;
    try {
      raw = fs.readFileSync(path, 'utf8');
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        records = {};
        return records;
      }
      corrupt = new JournalError('journal_corrupt', 'journal file could not be read; failing closed');
      throw corrupt;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      corrupt = new JournalError('journal_corrupt', 'journal file is not valid JSON (partial write?); failing closed');
      throw corrupt;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      corrupt = new JournalError('journal_corrupt', 'journal file root must be an object; failing closed');
      throw corrupt;
    }
    const clean = {};
    try {
      for (const [id, entry] of Object.entries(parsed)) {
        sanitizeId(id);
        clean[id] = sanitizeEntry(entry);
      }
    } catch (err) {
      corrupt = err instanceof JournalError ? err : new JournalError('journal_corrupt', 'invalid journal entry; failing closed');
      throw corrupt;
    }
    records = clean;
    return records;
  }

  function persist() {
    const payload = JSON.stringify(records);
    let fd;
    try {
      const dir = defaultPath.dirname(path);
      if (dir && dir !== '.') {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          if (!err || err.code !== 'EEXIST') throw err;
        }
      }
      if (typeof fs.openSync === 'function' && typeof fs.fsyncSync === 'function' && typeof fs.closeSync === 'function') {
        fd = fs.openSync(tmpPath, 'w');
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
      } else {
        fs.writeFileSync(tmpPath, payload, 'utf8');
      }
      fs.renameSync(tmpPath, path);
    } catch (err) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* best effort */
        }
      }
      if (err instanceof JournalError) throw err;
      throw new JournalError('journal_io', 'journal write failed');
    }
  }

  return {
    get(messageID) {
      const entry = load()[messageID];
      return entry ? { ...entry } : undefined;
    },
    set(messageID, entry) {
      sanitizeId(messageID);
      const recs = load();
      if (!recs[messageID] && Object.keys(recs).length >= maxEntries) {
        throw new JournalError('journal_full', `journal bound of ${maxEntries} entries reached; failing closed`);
      }
      recs[messageID] = sanitizeEntry(entry);
      persist();
      return { ...recs[messageID] };
    },
  };
}
