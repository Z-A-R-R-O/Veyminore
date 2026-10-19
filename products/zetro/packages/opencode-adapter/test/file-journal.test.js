/**
 * Offline temp-store tests for the bounded file journal (src/file-journal.js).
 * Injected in-memory fs; no real server, env, network, or shell.
 * Run: node --test test/file-journal.test.js   (NOT RUN in OCR-W2 pass; coordinator executes)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenCodeAdapter } from '../src/index.js';
import { createFileJournal, JournalError } from '../src/file-journal.js';

const BASE = 'http://127.0.0.1:4096';
const SECRET = 'super-secret-token-do-not-leak';
const PINNED = {
  projectID: 'proj-1',
  sessionID: 'sess-1',
  directory: 'E:/Veyminore/products/zetro',
  root: 'E:/Veyminore',
};

/** In-memory fs-compatible temp store shared across "restarts" via the same map. */
function memfs(files = new Map()) {
  const fds = new Map();
  let nextFd = 3;
  return {
    files,
    readFileSync(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    writeFileSync(fdOrPath, data) {
      const p = typeof fdOrPath === 'number' ? fds.get(fdOrPath) : String(fdOrPath);
      files.set(p, String(data));
    },
    renameSync(from, to) {
      if (!files.has(from)) {
        const err = new Error(`ENOENT: ${from}`);
        err.code = 'ENOENT';
        throw err;
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    openSync(p) {
      const fd = nextFd++;
      fds.set(fd, String(p));
      files.set(String(p), '');
      return fd;
    },
    fsyncSync() {},
    closeSync(fd) {
      fds.delete(fd);
    },
    mkdirSync() {},
  };
}

function ok(body, status = 200) {
  const text = JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json', 'content-length': String(text.length) } });
}
function noContent() {
  return new Response(null, { status: 204 });
}

function fixtureFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init?.method ?? 'GET', body: init?.body ?? null });
    let route;
    for (let i = routes.length - 1; i >= 0; i--) {
      const r = routes[i];
      if ((r.method ?? 'GET') === (init?.method ?? 'GET') && r.path === u.pathname) {
        route = r;
        break;
      }
    }
    if (!route) return new Response('not found', { status: 404 });
    return route.respond(u);
  };
  fn.calls = calls;
  return fn;
}

function identityRoutes() {
  return [
    { path: '/global/health', respond: () => ok({ status: 'ok' }) },
    { path: '/project/current', respond: () => ok({ id: 'proj-1' }) },
    { path: '/path', respond: () => ok({ directory: PINNED.directory, root: PINNED.root }) },
    { path: '/session/sess-1', respond: () => ok({ id: 'sess-1', projectID: 'proj-1' }) },
    { path: '/session/sess-1/status', respond: () => ok({ status: 'idle' }) },
  ];
}

function makeAdapter(fetchFn, journal, extra = {}) {
  return createOpenCodeAdapter({
    endpoint: BASE,
    fetch: fetchFn,
    getCredentialHeaders: () => ({ authorization: `Bearer ${SECRET}` }),
    journal,
    ...PINNED,
    ...extra,
  });
}

test('restart with file journal: exact one POST across adapter recreation', async () => {
  const files = new Map();
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const before = makeAdapter(f, createFileJournal({ path: 'E:/tmp/zetro-journal.json', fs: memfs(files) }));
  const r1 = await before.prompt({ messageID: 'mr1', text: 'x' });
  assert.equal(r1.state, 'acknowledged');

  const after = makeAdapter(f, createFileJournal({ path: 'E:/tmp/zetro-journal.json', fs: memfs(files) }));
  const r2 = await after.prompt({ messageID: 'mr1', text: 'x' });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.resent, false);
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, 1);
});

test('file journal persists only IDs/state/time/reason — no auth, prompts, or source', async () => {
  const files = new Map();
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f, createFileJournal({ path: 'E:/tmp/j2.json', fs: memfs(files) }));
  await a.prompt({ messageID: 'mp1', text: 'prompt-text-cannot-be-persisted' });
  const dump = files.get('E:/tmp/j2.json');
  assert.ok(dump, 'journal file written');
  const parsed = JSON.parse(dump);
  assert.deepEqual(Object.keys(parsed), ['mp1']);
  assert.deepEqual(Object.keys(parsed.mp1).sort(), ['at', 'state']);
  assert.equal(dump.includes(SECRET), false, 'no credential persisted');
  assert.equal(dump.includes('prompt-text-cannot-be-persisted'), false, 'no prompt text persisted');
  assert.equal(dump.includes('opencode-adapter'), false, 'no source persisted');
});

test('partial write (truncated JSON) fails closed with journal_corrupt', () => {
  const files = new Map([['E:/tmp/partial.json', '{"m1":{"state":"acknow']]);
  const j = createFileJournal({ path: 'E:/tmp/partial.json', fs: memfs(files) });
  assert.throws(() => j.get('m1'), (err) => err instanceof JournalError && err.code === 'journal_corrupt');
  assert.throws(() => j.set('m2', { state: 'intent', at: 1 }), (err) => err.code === 'journal_corrupt');
});

test('adapter with corrupt journal never reaches POST (fail closed)', async () => {
  const files = new Map([['E:/tmp/bad.json', 'not-json']]);
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f, createFileJournal({ path: 'E:/tmp/bad.json', fs: memfs(files) }));
  await assert.rejects(() => a.prompt({ messageID: 'mx', text: 'x' }), (err) => err.code === 'journal_corrupt');
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});

test('corrupt entry shape (bad state type) fails closed', () => {
  const files = new Map([['E:/tmp/shape.json', JSON.stringify({ m1: { state: 42, at: 1 } })]]);
  const j = createFileJournal({ path: 'E:/tmp/shape.json', fs: memfs(files) });
  assert.throws(() => j.get('m1'), (err) => err.code === 'journal_corrupt');
});

test('foreign fields in stored entry fail closed (containment)', () => {
  const files = new Map([['E:/tmp/leak.json', JSON.stringify({ m1: { state: 'intent', at: 1, authorization: 'Bearer leaked' } })]]);
  const j = createFileJournal({ path: 'E:/tmp/leak.json', fs: memfs(files) });
  assert.throws(() => j.get('m1'), (err) => err.code === 'journal_reject_field');
});

test('concurrent distinct messageIDs: one POST each, journal bound respected', async () => {
  const files = new Map();
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f, createFileJournal({ path: 'E:/tmp/conc.json', fs: memfs(files), maxEntries: 10 }));
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5'];
  const results = await Promise.all(ids.map((messageID) => a.prompt({ messageID, text: `t-${messageID}` })));
  assert.ok(results.every((r) => r.state === 'acknowledged' && r.duplicate === false));
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, ids.length);
  const parsed = JSON.parse(files.get('E:/tmp/conc.json'));
  assert.equal(Object.keys(parsed).length, ids.length);
  for (const id of ids) assert.equal(parsed[id].state, 'acknowledged');
});

test('journal bound: new messageID beyond maxEntries fails closed before POST', async () => {
  const files = new Map();
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f, createFileJournal({ path: 'E:/tmp/bound.json', fs: memfs(files), maxEntries: 1 }));
  await a.prompt({ messageID: 'b1', text: 'x' });
  await assert.rejects(() => a.prompt({ messageID: 'b2', text: 'x' }), (err) => err.code === 'journal_full');
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, 1);
});

test('atomic durability: set writes tmp then renames; crash between leaves old intact', async () => {
  const files = new Map([['E:/tmp/atomic.json', JSON.stringify({ keep: { state: 'acknowledged', at: 1 } })]]);
  const store = memfs(files);
  let failRename = false;
  const fs = {
    ...store,
    renameSync(from, to) {
      if (failRename) {
        const err = new Error('EIO');
        err.code = 'EIO';
        throw err;
      }
      store.renameSync(from, to);
    },
  };
  const j = createFileJournal({ path: 'E:/tmp/atomic.json', fs });
  failRename = true;
  assert.throws(() => j.set('m9', { state: 'intent', at: 2 }), (err) => err.code === 'journal_io');
  const after = JSON.parse(files.get('E:/tmp/atomic.json'));
  assert.equal(after.keep.state, 'acknowledged', 'target file untouched on failed rename');
});

test('journal constructor requires explicit path and valid fs', () => {
  assert.throws(() => createFileJournal({}), (err) => err.code === 'journal_config');
  assert.throws(() => createFileJournal({ path: 'E:/tmp/x.json', fs: {} }), (err) => err.code === 'journal_config');
  assert.throws(() => createFileJournal({ path: 'E:/tmp/x.json', maxEntries: 0 }), (err) => err.code === 'journal_config');
});

test('missing journal file starts empty and is created on first set', async () => {
  const files = new Map();
  const j = createFileJournal({ path: 'E:/tmp/new.json', fs: memfs(files) });
  assert.equal(j.get('n1'), undefined);
  j.set('n1', { state: 'intent', at: 5 });
  assert.equal(files.has('E:/tmp/new.json'), true);
  assert.equal(j.get('n1').state, 'intent');
});
