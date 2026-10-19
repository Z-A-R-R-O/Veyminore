/**
 * Injected-HTTP-fixture tests for @zetro/opencode-adapter.
 * Run: node --test test/adapter.test.js   (NOT RUN in OCR-4 pass; coordinator executes)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenCodeAdapter,
  AdapterError,
  redact,
  projectWorkerManifest,
  projectWorkerManifests,
  ManifestError,
  MANIFEST_PINNED_MODEL
} from '../src/index.js';

const BASE = 'http://127.0.0.1:4096';
const SECRET = 'super-secret-token-do-not-leak';

const PINNED = {
  projectID: 'proj-1',
  sessionID: 'sess-1',
  directory: 'E:/Veyminore/products/zetro',
  root: 'E:/Veyminore',
};

function ok(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'content-length': String(JSON.stringify(body).length) },
  });
}

function noContent() {
  return new Response(null, { status: 204 });
}

/** Build an injected fetch from a route table. Records every call. */
function fixtureFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u.toString(), path: u.pathname, method: init?.method ?? 'GET', body: init?.body ?? null, headers: init?.headers ?? {} });
    // Last matching route wins so tests can override identityRoutes() entries
    // (e.g. force a 302 on /global/health for the redirect-rejection case).
    let route;
    for (let i = routes.length - 1; i >= 0; i--) {
      const r = routes[i];
      if ((r.method ?? 'GET') === (init?.method ?? 'GET') && r.path === u.pathname) {
        route = r;
        break;
      }
    }
    if (!route) return new Response('not found', { status: 404 });
    if (route.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, route.delayMs));
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    return route.respond(u);
  };
  fn.calls = calls;
  return fn;
}

function identityRoutes(overrides = {}) {
  const project = overrides.project ?? { id: 'proj-1' };
  const path = overrides.path ?? { directory: 'E:/Veyminore/products/zetro', root: 'E:/Veyminore' };
  const session = overrides.session ?? { id: 'sess-1', projectID: 'proj-1' };
  return [
    { path: '/global/health', respond: () => ok({ status: 'ok' }) },
    { path: '/project/current', respond: () => ok(project) },
    { path: '/path', respond: () => ok(path) },
    { path: '/session/sess-1', respond: () => ok(session) },
    { path: '/session/sess-1/status', respond: () => ok({ status: 'idle' }) },
  ];
}

function makeAdapter(fetchFn, extra = {}) {
  return createOpenCodeAdapter({
    endpoint: BASE,
    fetch: fetchFn,
    getCredentialHeaders: () => ({ authorization: `Bearer ${SECRET}` }),
    ...PINNED,
    ...extra,
  });
}

test('rejects non-loopback endpoint', () => {
  assert.throws(
    () => createOpenCodeAdapter({ endpoint: 'http://example.com:4096', fetch: async () => new Response(null, { status: 204 }), ...PINNED }),
    (err) => err instanceof AdapterError && err.code === 'invalid_endpoint',
  );
});

test('wrong project identity rejects before mutation', async () => {
  const f = fixtureFetch(identityRoutes({ project: { id: 'proj-EVIL' } }));
  const a = makeAdapter(f);
  await assert.rejects(() => a.verifyIdentity(), (err) => err.code === 'identity_mismatch');
  assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});

test('wrong directory identity rejects before mutation', async () => {
  const f = fixtureFetch(identityRoutes({ path: { directory: 'C:/elsewhere', root: 'E:/Veyminore' } }));
  const a = makeAdapter(f);
  await assert.rejects(() => a.verifyIdentity(), (err) => err.code === 'identity_mismatch');
  assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});

test('prompt journals intent then acknowledged on 204; duplicate does not resend', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  const r1 = await a.prompt({ messageID: 'm1', text: 'hello' });
  assert.equal(r1.state, 'acknowledged');
  assert.equal(r1.resent, false);
  assert.equal(a.receipt('m1').state, 'acknowledged');

  const r2 = await a.prompt({ messageID: 'm1', text: 'hello' });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.resent, false);
  const posts = f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async'));
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].body);
  assert.equal(body.messageID, 'm1');
  assert.deepEqual(body.model, { providerID: 'opencode', modelID: 'opencode/mimo-v2.6-flash-free' });
  assert.deepEqual(body.parts, [{ type: 'text', text: 'hello' }]);
});

test('timeout becomes delivery_unknown and never resends', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', delayMs: 50, respond: () => noContent() },
  ]);
  const a = makeAdapter(f, { timeoutMs: 5 });
  const r = await a.prompt({ messageID: 'm2', text: 'slow' });
  assert.equal(r.state, 'delivery_unknown');
  assert.equal(r.resent, false);
  assert.equal(a.receipt('m2').state, 'delivery_unknown');

  const dup = await a.prompt({ messageID: 'm2', text: 'slow' });
  assert.equal(dup.duplicate, true);
  assert.equal(dup.resent, false);
  const posts = f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async'));
  assert.equal(posts.length, 1, 'no blind resend after timeout');
});

test('unknown delivery correlates only when messageID is echoed; never resends', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', delayMs: 50, respond: () => noContent() },
    { path: '/session/sess-1/message', respond: () => ok([{ id: 'other' }, { id: 'm3' }]) },
  ]);
  const a = makeAdapter(f, { timeoutMs: 5 });
  await a.prompt({ messageID: 'm3', text: 'x' });
  assert.equal(a.receipt('m3').state, 'delivery_unknown');

  const c = await a.correlate('m3');
  assert.equal(c.correlated, true);
  assert.equal(c.state, 'acknowledged');
  const posts = f.calls.filter((c2) => c2.method === 'POST' && c2.path.endsWith('/prompt_async'));
  assert.equal(posts.length, 1, 'correlate must never resend');
});

test('correlate with unknown messageID stays unresolved', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', delayMs: 50, respond: () => noContent() },
    { path: '/session/sess-1/message', respond: () => ok([{ id: 'other' }]) },
  ]);
  const a = makeAdapter(f, { timeoutMs: 5 });
  await a.prompt({ messageID: 'm4', text: 'x' });
  const c = await a.correlate('m4');
  assert.equal(c.correlated, false);
  assert.equal(c.state, 'delivery_unknown');
  assert.equal(f.calls.filter((c2) => c2.method === 'POST' && c2.path.endsWith('/prompt_async')).length, 1);
});

test('idle status never certifies completion and does not resend', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  await a.prompt({ messageID: 'm5', text: 'x' });
  const s = await a.status();
  assert.equal(s.completes, false);
  assert.equal(a.receipt('m5').state, 'acknowledged', 'status must not mutate journal state');
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, 1);
});

test('redirect is rejected as auth destination change', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { path: '/global/health', respond: () => new Response(null, { status: 302, headers: { location: 'http://evil.example/auth' } }) },
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  await assert.rejects(() => a.prompt({ messageID: 'm6', text: 'x' }), (err) => err.code === 'auth_destination_change');
  assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});

test('abort requires identity and posts abort', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/abort', respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  const r = await a.abort();
  assert.equal(r.aborted, true);
  assert.ok(f.calls.some((c) => c.method === 'GET' && c.path === '/project/current'));
  assert.ok(f.calls.some((c) => c.method === 'POST' && c.path === '/session/sess-1/abort'));
});

test('paid model is refused with no fallback', async () => {
  const f = fixtureFetch(identityRoutes());
  const a = makeAdapter(f);
  await assert.rejects(
    () => a.prompt({ messageID: 'm7', text: 'x', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' } }),
    (err) => err.code === 'model_not_pinned',
  );
  assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});

test('credential canary never appears in adapter errors or results', async () => {
  const f = fixtureFetch([
    { path: '/global/health', respond: () => ok({ status: 'ok' }) },
    { path: '/project/current', respond: () => ok({ id: 'proj-1' }) },
    { path: '/path', respond: () => ok({ directory: PINNED.directory, root: PINNED.root }) },
    { path: '/session/sess-1', respond: () => new Response(JSON.stringify({ error: `auth failed for Bearer ${SECRET}` }), { status: 500 }) },
  ]);
  const a = makeAdapter(f);
  let caught = null;
  try {
    await a.verifyIdentity();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'expected an error');
  assert.equal(String(caught.message).includes(SECRET), false, 'secret must be redacted from error text');
  const serialized = JSON.stringify({ message: caught.message, code: caught.code });
  assert.equal(serialized.includes(SECRET), false);
  // outbound credential callback is invoked but the value never round-trips through results
  assert.ok(f.calls[0].headers.authorization.startsWith('Bearer '), 'fixture received auth header');
});

test('redact strips bearer tokens and authorization json', () => {
  const s = redact(`Authorization: Bearer ${SECRET} and {"authorization":"${SECRET}"}`);
  assert.equal(s.includes(SECRET), false);
});

test('oversized response is rejected', async () => {
  const big = 'x'.repeat(2048);
  const f = fixtureFetch([
    { path: '/global/health', respond: () => ok({ status: 'ok', big }) },
  ]);
  const a = makeAdapter(f, { maxResponseBytes: 512 });
  await assert.rejects(() => a.verifyIdentity(), (err) => err.code === 'response_too_large');
});

test('concurrent same messageID prompts send exactly one POST', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', delayMs: 20, respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  const results = await Promise.all([
    a.prompt({ messageID: 'mc', text: 'same' }),
    a.prompt({ messageID: 'mc', text: 'same' }),
    a.prompt({ messageID: 'mc', text: 'same' }),
  ]);
  const posts = f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async'));
  assert.equal(posts.length, 1, 'intent reservation must serialize same-messageID prompts');
  const acked = results.filter((r) => r.state === 'acknowledged' && r.duplicate === false);
  const dups = results.filter((r) => r.duplicate === true);
  assert.equal(acked.length, 1);
  assert.equal(dups.length, 2);
  assert.ok(dups.every((r) => r.resent === false));
  assert.equal(a.receipt('mc').state, 'acknowledged');
});

test('timeout applies to the whole body read, not just headers', async () => {
  // Headers resolve instantly; the body stream never drains. The deadline must
  // still fire and yield delivery_unknown instead of hanging unbounded.
  const f = fixtureFetch([
    ...identityRoutes(),
    {
      method: 'POST',
      path: '/session/sess-1/prompt_async',
      respond: () => ({
        status: 204,
        headers: { get: () => null },
        text: () => new Promise(() => {}), // body read never settles
      }),
    },
  ]);
  const a = makeAdapter(f, { timeoutMs: 40 });
  const r = await a.prompt({ messageID: 'mbody', text: 'x' });
  assert.equal(r.state, 'delivery_unknown');
  assert.equal(a.receipt('mbody').state, 'delivery_unknown');
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, 1);
});

test('abort re-verifies identity on every call (no cached identity)', async () => {
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/abort', respond: () => noContent() },
  ]);
  const a = makeAdapter(f);
  await a.abort();
  await a.abort();
  const identityGets = f.calls.filter((c) => c.method === 'GET' && c.path === '/project/current');
  assert.equal(identityGets.length, 2, 'each abort must re-run identity verification');
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path === '/session/sess-1/abort').length, 2);
});

test('durable journal port: restart replay of known messageID never resends', async () => {
  // Simulated durable store shared across two adapter "instances" (a restart).
  const store = new Map();
  const port = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const f = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
  ]);
  const before = makeAdapter(f, { journal: port });
  const r1 = await before.prompt({ messageID: 'mrestart', text: 'x' });
  assert.equal(r1.state, 'acknowledged');

  const after = makeAdapter(f, { journal: port }); // fresh instance = restart
  const r2 = await after.prompt({ messageID: 'mrestart', text: 'x' });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.resent, false);
  assert.equal(r2.state, 'acknowledged');
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/prompt_async')).length, 1);
});

test('restart without journal port: unknown messageID is not blindly resent', async () => {
  const f1 = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', delayMs: 50, respond: () => noContent() },
  ]);
  const a1 = makeAdapter(f1, { timeoutMs: 5 });
  await a1.prompt({ messageID: 'mlost', text: 'x' });

  // "Restart": fresh adapter with empty in-memory journal and no port.
  const f2 = fixtureFetch([
    ...identityRoutes(),
    { method: 'POST', path: '/session/sess-1/prompt_async', respond: () => noContent() },
    { path: '/session/sess-1/message', respond: () => ok([{ id: 'mlost' }]) },
  ]);
  const a2 = makeAdapter(f2);
  const c = await a2.correlate('mlost').catch(() => null);
  assert.equal(c, null, 'unknown messageID after restart must not be resolvable without a durable journal');
  assert.equal(f2.calls.filter((x) => x.method === 'POST').length, 0, 'no resend across restart');
});

// ============================================================================
// IFZ Worker Manifest & Availability Projection Tests
// ============================================================================

const VALID_CLAIM = {
  workerId: 'ocr-worker-1',
  sessionId: 'sess-1',
  projectId: 'proj-1',
  workspaceId: 'ws-zetro',
  directory: 'E:/Veyminore/products/zetro',
  root: 'E:/Veyminore',
  model: MANIFEST_PINNED_MODEL,
  permissions: ['allow:read', 'allow:write', 'allow:exec'],
  isQualified: true,
  qualification: { status: 'passed', verifiedAt: 1700000000000 },
  observedAt: 1700000000000,
  status: 'available',
  sessionState: 'idle'
};

test('IFZ Manifest 1: Happy path projection is deeply frozen, bounded, and contains exact identities', () => {
  const manifest = projectWorkerManifest(VALID_CLAIM, { now: 1700000010000 });

  assert.equal(manifest.schemaVersion, 'zetro.ifz.worker_manifest.v1');
  assert.equal(manifest.workerId, 'ocr-worker-1');
  assert.equal(manifest.sessionID, 'sess-1');
  assert.equal(manifest.projectId, 'proj-1');
  assert.equal(manifest.workspaceId, 'ws-zetro');
  assert.equal(manifest.directory, 'E:/Veyminore/products/zetro');
  assert.deepEqual(manifest.model, MANIFEST_PINNED_MODEL);
  assert.deepEqual(manifest.capabilities.effects, ['execute', 'read', 'write']);
  assert.equal(manifest.availability.status, 'available');
  assert.equal(manifest.availability.completionCertified, false);
  assert.equal(manifest.qualification.status, 'qualified');

  // Verify deep freeze immutability
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.capabilities));
  assert.ok(Object.isFrozen(manifest.availability));
  assert.ok(Object.isFrozen(manifest.qualification));
});

test('IFZ Manifest 2: Identity mismatches are rejected before projection', () => {
  // Mismatched project
  assert.throws(
    () => projectWorkerManifest(VALID_CLAIM, { projectID: 'proj-DIFFERENT', now: 1700000010000 }),
    (err) => err instanceof ManifestError && err.code === 'identity_mismatch'
  );

  // Mismatched workspace
  assert.throws(
    () => projectWorkerManifest(VALID_CLAIM, { workspaceId: 'ws-DIFFERENT', now: 1700000010000 }),
    (err) => err instanceof ManifestError && err.code === 'identity_mismatch'
  );

  // Mismatched session
  assert.throws(
    () => projectWorkerManifest(VALID_CLAIM, { sessionID: 'sess-DIFFERENT', now: 1700000010000 }),
    (err) => err instanceof ManifestError && err.code === 'identity_mismatch'
  );
});

test('IFZ Manifest 3: Pinned model enforced; paid fallback refused', () => {
  // Non-pinned model
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, model: { providerID: 'openai', modelID: 'gpt-4o' } }, { now: 1700000010000 }),
    (err) => err instanceof ManifestError && err.code === 'model_not_pinned'
  );

  // Missing model
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, model: null }, { now: 1700000010000 }),
    (err) => err instanceof ManifestError && err.code === 'model_not_pinned'
  );
});

test('IFZ Manifest 4: Freshness enforced; stale and future observations rejected', () => {
  const now = 1700000000000;

  // Stale observation (> 300,000ms old)
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, observedAt: now - 350000 }, { now }),
    (err) => err instanceof ManifestError && err.code === 'stale_observation'
  );

  // Future observation (> 60,000ms clock skew)
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, observedAt: now + 70000 }, { now }),
    (err) => err instanceof ManifestError && err.code === 'future_observation'
  );
});

test('IFZ Manifest 5: Qualification required; unknown and malformed effects rejected', () => {
  const now = 1700000010000;

  // Missing qualification
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, isQualified: false }, { now }),
    (err) => err instanceof ManifestError && err.code === 'missing_qualification'
  );

  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, qualification: { status: 'failed' } }, { now }),
    (err) => err instanceof ManifestError && err.code === 'missing_qualification'
  );

  // Unknown effect token
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, permissions: ['allow:read', 'allow:telepathy'] }, { now }),
    (err) => err instanceof ManifestError && err.code === 'unknown_effect'
  );

  // Malformed permission rule
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, permissions: ['invalid::rule:shape'] }, { now }),
    (err) => err instanceof ManifestError && err.code === 'malformed_permissions'
  );
});

test('IFZ Manifest 6: Unsafe and control identities are rejected', () => {
  const now = 1700000010000;

  // Control characters / path traversal / symbols in ID
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, workerId: 'worker\x00malicious' }, { now }),
    (err) => err instanceof ManifestError && err.code === 'unsafe_identity'
  );

  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, sessionId: '../traversal' }, { now }),
    (err) => err instanceof ManifestError && err.code === 'unsafe_identity'
  );

  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, projectId: 'proj;DROP TABLE;' }, { now }),
    (err) => err instanceof ManifestError && err.code === 'unsafe_identity'
  );
});

test('IFZ Manifest 7: Batch duplicate rejection and registry bounds', () => {
  const now = 1700000010000;
  const registry = new Set();

  const m1 = projectWorkerManifest({ ...VALID_CLAIM, workerId: 'ocr-unique-1', sessionId: 'sess-u1' }, { now, registry });
  assert.equal(m1.workerId, 'ocr-unique-1');

  // Re-registering duplicate workerId throws duplicate_identity
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, workerId: 'ocr-unique-1', sessionId: 'sess-u2' }, { now, registry }),
    (err) => err instanceof ManifestError && err.code === 'duplicate_identity'
  );

  // Duplicate inside projectWorkerManifests batch throws duplicate_identity
  assert.throws(
    () => projectWorkerManifests([
      { ...VALID_CLAIM, workerId: 'batch-w1', sessionId: 'batch-s1' },
      { ...VALID_CLAIM, workerId: 'batch-w1', sessionId: 'batch-s2' }
    ], { now }),
    (err) => err instanceof ManifestError && err.code === 'duplicate_identity'
  );

  // Batch bound > 64 throws registry_full
  const oversizedBatch = Array.from({ length: 65 }, (_, i) => ({
    ...VALID_CLAIM,
    workerId: `batch-w-${i}`,
    sessionId: `batch-s-${i}`
  }));
  assert.throws(
    () => projectWorkerManifests(oversizedBatch, { now }),
    (err) => err instanceof ManifestError && err.code === 'registry_full'
  );
});

test('IFZ Manifest 8: Availability observed state only, completion certification denied, and credential containment', () => {
  const now = 1700000010000;

  // Status 'completed' or 'done' implies completion and must be rejected
  assert.throws(
    () => projectWorkerManifest({ ...VALID_CLAIM, status: 'completed' }, { now }),
    (err) => err instanceof ManifestError && err.code === 'invalid_availability'
  );

  // 'busy' or 'idle' reflects active availability with completionCertified: false
  const busyManifest = projectWorkerManifest({ ...VALID_CLAIM, status: 'busy', sessionState: 'running_step' }, { now });
  assert.equal(busyManifest.availability.status, 'busy');
  assert.equal(busyManifest.availability.sessionState, 'running_step');
  assert.equal(busyManifest.availability.completionCertified, false);

  // Credential and confidential fields on claim are excluded from projected manifest
  const toxicClaim = {
    ...VALID_CLAIM,
    token: 'super-secret-token-do-not-leak',
    authorization: 'Bearer secret_auth_header',
    prompt: 'confidential prompt instructions',
    source: 'internal source file buffer',
    error: new Error('internal DB stack trace')
  };

  const clean = projectWorkerManifest(toxicClaim, { now });
  const serialized = JSON.stringify(clean);

  assert.ok(!serialized.includes('super-secret-token-do-not-leak'));
  assert.ok(!serialized.includes('secret_auth_header'));
  assert.ok(!serialized.includes('confidential prompt instructions'));
  assert.ok(!serialized.includes('internal source file buffer'));
  assert.equal(clean.token, undefined);
  assert.equal(clean.authorization, undefined);
  assert.equal(clean.prompt, undefined);
  assert.equal(clean.source, undefined);
  assert.equal(clean.error, undefined);
});

