import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserver, ObserverError, createIfzProjector } from '../src/index.js';
import {
  windowRow,
  enumerateResponse,
  scriptRunner,
  hangForever,
  fixedClock,
  unsupportedCaptureBackend,
  supportedCaptureBackend,
} from './fixtures.js';

const NOW = 1000000;

function makeObserver(steps, extra = {}) {
  const clock = fixedClock(NOW);
  const runner = scriptRunner(steps);
  const observer = createObserver({
    processRunner: runner,
    clock: clock.now,
    maxAgeMs: 5000,
    timeoutMs: 1000,
    ...extra,
  });
  return { observer, runner, clock };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ObserverError, `expected ObserverError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test('enumerate is bounded, truncates, and omits titles by default', async () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    windowRow({ hwnd: 100 + i, processId: 42 + i, generation: 'g1' }),
  );
  const { observer } = makeObserver(
    [{ stdout: enumerateResponse(rows, { generation: 'g1', observedAt: NOW }) }],
    { maxWindows: 3 },
  );
  const snapshot = await observer.enumerate({ limit: 10 });
  assert.equal(snapshot.windows.length, 3);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.dropped, 0);
  assert.equal(snapshot.ageMs, 0);
  for (const w of snapshot.windows) {
    assert.equal('title' in w, false);
    assert.equal(typeof w.titleChars, 'number');
  }
});

test('enumerate includes bounded titles when includeTitles is enabled', async () => {
  const { observer } = makeObserver(
    [{ stdout: enumerateResponse([windowRow({ title: 'x'.repeat(500) })]) }],
    { includeTitles: true, maxTitleChars: 16 },
  );
  const snapshot = await observer.enumerate();
  assert.equal(snapshot.windows[0].title.length, 16);
});

test('observe succeeds and reports native capture as unsupported without guessing', async () => {
  const { observer } = makeObserver(
    [{ stdout: enumerateResponse([windowRow()], { generation: 'g1', observedAt: NOW }) }],
    { captureBackend: unsupportedCaptureBackend() },
  );
  const result = await observer.observeWindow({
    hwnd: 100,
    expectedGeneration: 'g1',
    expectedProcessId: 42,
    capture: true,
  });
  assert.equal(result.status, 'observed');
  assert.equal(result.capture.status, 'unsupported');
  assert.equal(result.capture.artifact, null);
  assert.equal(result.capture.reason, 'NATIVE_CAPTURE_UNSUPPORTED');
});

test('changed hwnd (exact identity) is WINDOW_MISSING, never guessed', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow({ hwnd: 101 })]) },
  ]);
  await expectCode(observer.observeWindow({ hwnd: 100 }), 'WINDOW_MISSING');
});

test('closed window is WINDOW_MISSING', async () => {
  const { observer } = makeObserver([{ stdout: enumerateResponse([]) }]);
  await expectCode(observer.observeWindow({ hwnd: 100 }), 'WINDOW_MISSING');
});

test('changed process for same hwnd is PROCESS_MISMATCH', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow({ processId: 99 })]) },
  ]);
  await expectCode(
    observer.observeWindow({ hwnd: 100, expectedProcessId: 42 }),
    'PROCESS_MISMATCH',
  );
});

test('stale request (outdated expectedGeneration) is WINDOW_STALE', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow({ generation: 'g2' })], { generation: 'g2', observedAt: NOW }) },
  ]);
  await expectCode(
    observer.observeWindow({ hwnd: 100, expectedGeneration: 'g1' }),
    'WINDOW_STALE',
  );
});

test('changed generation between entry and snapshot is GENERATION_MISMATCH', async () => {
  const { observer } = makeObserver([
    {
      stdout: JSON.stringify({
        windows: [windowRow({ generation: 'legacy' })],
        generation: 'g9',
        observedAt: NOW,
      }),
    },
  ]);
  await expectCode(observer.observeWindow({ hwnd: 100 }), 'GENERATION_MISMATCH');
});

test('aged snapshot is WINDOW_STALE', async () => {
  const { observer, clock } = makeObserver([
    { stdout: enumerateResponse([windowRow()], { observedAt: NOW }) },
  ]);
  clock.advance(10000);
  await expectCode(
    observer.observeWindow({ hwnd: 100, maxAgeMs: 5000 }),
    'WINDOW_STALE',
  );
});

test('future observedAt on enumerate is RESPONSE_MALFORMED (no freshness bypass)', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow()], { generation: 'g1', observedAt: 999999999 }) },
  ]);
  await expectCode(observer.enumerate({ maxAgeMs: 1 }), 'RESPONSE_MALFORMED');
});

test('future observedAt on observe with tiny maxAge is RESPONSE_MALFORMED', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow()], { generation: 'g1', observedAt: 999999999 }) },
  ]);
  await expectCode(
    observer.observeWindow({ hwnd: 100, maxAgeMs: 1 }),
    'RESPONSE_MALFORMED',
  );
});

test('ageMs is exact with no non-negative clamp after clock advance', async () => {
  const { observer, clock } = makeObserver([
    { stdout: enumerateResponse([windowRow()], { observedAt: NOW }) },
  ]);
  clock.advance(250);
  const snapshot = await observer.enumerate();
  assert.equal(snapshot.ageMs, 250);
});

test('string minimized flag is rejected: all-invalid payload is RESPONSE_MALFORMED', async () => {
  const { observer } = makeObserver([
    {
      stdout: enumerateResponse([windowRow({ minimized: 'true' })], { observedAt: NOW }),
    },
  ]);
  await expectCode(observer.enumerate(), 'RESPONSE_MALFORMED');
});

test('string visible flag is rejected: all-invalid payload is RESPONSE_MALFORMED', async () => {
  const { observer } = makeObserver([
    {
      stdout: enumerateResponse([windowRow({ visible: 'false' })], { observedAt: NOW }),
    },
  ]);
  await expectCode(observer.enumerate(), 'RESPONSE_MALFORMED');
});

test('non-boolean flag rows are dropped; valid siblings survive with dropped count', async () => {
  const { observer } = makeObserver([
    {
      stdout: enumerateResponse(
        [windowRow(), windowRow({ hwnd: 200, minimized: 'yes' }), windowRow({ hwnd: 300, visible: 1 })],
        { observedAt: NOW },
      ),
    },
  ]);
  const snapshot = await observer.enumerate();
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].hwnd, 100);
  assert.equal(snapshot.dropped, 2);
  assert.equal(typeof snapshot.windows[0].minimized, 'boolean');
  assert.equal(typeof snapshot.windows[0].visible, 'boolean');
});

test('minimized window is WINDOW_MINIMIZED', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow({ minimized: true })]) },
  ]);
  await expectCode(observer.observeWindow({ hwnd: 100 }), 'WINDOW_MINIMIZED');
});

test('hidden window is WINDOW_NOT_VISIBLE', async () => {
  const { observer } = makeObserver([
    { stdout: enumerateResponse([windowRow({ visible: false })]) },
  ]);
  await expectCode(observer.observeWindow({ hwnd: 100 }), 'WINDOW_NOT_VISIBLE');
});

test('hung runner times out with OBSERVER_TIMEOUT', async () => {
  const observer = createObserver({
    processRunner: hangForever(),
    clock: () => NOW,
    timeoutMs: 20,
  });
  await expectCode(observer.enumerate(), 'OBSERVER_TIMEOUT');
});

test('pre-aborted signal is OBSERVER_CANCELLED without calling the runner', async () => {
  const { observer, runner } = makeObserver([{ stdout: enumerateResponse([]) }]);
  const ac = new AbortController();
  ac.abort();
  await expectCode(observer.enumerate({ signal: ac.signal }), 'OBSERVER_CANCELLED');
  assert.equal(runner.calls.length, 0);
});

test('mid-flight abort is OBSERVER_CANCELLED', async () => {
  const observer = createObserver({
    processRunner: hangForever(),
    clock: () => NOW,
    timeoutMs: 5000,
  });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  await expectCode(observer.enumerate({ signal: ac.signal }), 'OBSERVER_CANCELLED');
});

test('malformed stdout is RESPONSE_MALFORMED', async () => {
  const { observer } = makeObserver([{ stdout: 'not-json{{{' }]);
  await expectCode(observer.enumerate(), 'RESPONSE_MALFORMED');
});

test('all-invalid window entries are RESPONSE_MALFORMED', async () => {
  const { observer } = makeObserver([
    { stdout: JSON.stringify({ windows: [{ nope: true }], generation: 'g1', observedAt: NOW }) },
  ]);
  await expectCode(observer.enumerate(), 'RESPONSE_MALFORMED');
});

test('oversized response is RESPONSE_TOO_LARGE', async () => {
  const { observer } = makeObserver([{ stdout: 'x'.repeat(4096) }], { maxResponseBytes: 512 });
  await expectCode(observer.enumerate(), 'RESPONSE_TOO_LARGE');
});

test('requireCapture with unsupported backend is CAPTURE_UNSUPPORTED', async () => {
  const { observer } = makeObserver(
    [{ stdout: enumerateResponse([windowRow()]) }],
    { captureBackend: unsupportedCaptureBackend() },
  );
  await expectCode(
    observer.observeWindow({ hwnd: 100, requireCapture: true }),
    'CAPTURE_UNSUPPORTED',
  );
});

test('capture backend not independently tested is treated as unsupported', async () => {
  const backend = supportedCaptureBackend(async () => ({ artifact: {} }), {
    independentlyTested: false,
  });
  const { observer } = makeObserver([{ stdout: enumerateResponse([windowRow()]) }], {
    captureBackend: backend,
  });
  assert.equal(observer.getCapabilities().nativeCapture, 'unsupported');
  const result = await observer.observeWindow({ hwnd: 100, capture: true });
  assert.equal(result.capture.status, 'unsupported');
});

test('independentlyTested:true is exposed as caller attestation, never native-verified proof', async () => {
  const backend = supportedCaptureBackend(async () => ({
    artifact: { mime: 'image/png', width: 1, height: 1, bytes: 1, artifactId: 'a' },
  }));
  const { observer } = makeObserver([{ stdout: enumerateResponse([windowRow()]) }], {
    captureBackend: backend,
  });
  const caps = observer.getCapabilities();
  assert.equal(caps.nativeCapture, 'supported');
  assert.equal(caps.nativeCaptureAttestation, 'caller_asserted_not_native_verified');
  const result = await observer.observeWindow({ hwnd: 100, capture: true });
  assert.equal(result.capture.status, 'captured');
  assert.equal(result.capture.attestation, 'caller_asserted_not_native_verified');
  assert.equal('nativeVerified' in result.capture, false);
});

test('validated capture returns bounded artifact metadata only', async () => {
  const backend = supportedCaptureBackend(async () => ({
    artifact: {
      mime: 'image/png',
      width: 800,
      height: 600,
      bytes: 12345,
      artifactId: 'art-1',
      sha256: 'a'.repeat(64),
    },
  }));
  const { observer } = makeObserver([{ stdout: enumerateResponse([windowRow()]) }], {
    captureBackend: backend,
  });
  const result = await observer.observeWindow({ hwnd: 100, capture: true });
  assert.equal(result.capture.status, 'captured');
  assert.deepEqual(result.capture.artifact, {
    mime: 'image/png',
    width: 800,
    height: 600,
    bytes: 12345,
    ref: 'art-1',
    sha256: 'a'.repeat(64),
  });
});

test('inline pixel payloads are rejected with INLINE_PIXELS_REJECTED', async () => {
  const backend = supportedCaptureBackend(async () => ({ base64: 'AAAA', artifact: {} }));
  const { observer } = makeObserver([{ stdout: enumerateResponse([windowRow()]) }], {
    captureBackend: backend,
  });
  await expectCode(observer.observeWindow({ hwnd: 100, capture: true }), 'INLINE_PIXELS_REJECTED');
});

test('missing artifact reference is ARTIFACT_INVALID', async () => {
  const backend = supportedCaptureBackend(async () => ({ ok: true }));
  const { observer } = makeObserver([{ stdout: enumerateResponse([windowRow()]) }], {
    captureBackend: backend,
  });
  await expectCode(observer.observeWindow({ hwnd: 100, capture: true }), 'ARTIFACT_INVALID');
});

test('capabilities report no mouse/keyboard/clipboard/shell effects', () => {
  const { observer } = makeObserver([]);
  const caps = observer.getCapabilities();
  assert.deepEqual(caps.effects, { mouse: false, keyboard: false, clipboard: false, shell: false });
  assert.equal(caps.nativeCapture, 'unsupported');
  assert.equal(typeof observer.observeWindow, 'function');
  assert.equal('click' in observer, false);
  assert.equal('type' in observer, false);
  assert.equal('readClipboard' in observer, false);
  assert.equal('exec' in observer, false);
});

test('missing processRunner is REQUEST_INVALID', () => {
  assert.throws(() => createObserver({}), (err) => err.code === 'REQUEST_INVALID');
});

test('invalid hwnd request is REQUEST_INVALID', async () => {
  const { observer } = makeObserver([]);
  await expectCode(observer.observeWindow({ hwnd: -1 }), 'REQUEST_INVALID');
});

// --- IFZ truthful public observation projection (pure, offline) ---

const IFZ_MAX_AGE = 30000;

function makeIfzClock(start = NOW) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

function makeIfz(extra = {}) {
  const clock = makeIfzClock();
  const p = createIfzProjector({ clock: clock.now, maxAgeMs: IFZ_MAX_AGE, ...extra });
  return { p, clock };
}

function iev(over = {}) {
  return {
    id: 'i1',
    seq: 1,
    at: NOW,
    kind: 'idle',
    source: 'observer-1',
    project: 'proj-a',
    workspace: 'ws-a',
    ...over,
  };
}

test('ifz: empty projector is uncertain; kind mapping covers all eight states', () => {
  const { p } = makeIfz();
  const empty = p.project();
  assert.equal(empty.state, 'uncertain');
  assert.equal(empty.ageMs, null);
  assert.equal(empty.source, null);
  assert.equal(empty.project, null);
  assert.equal(empty.workspace, null);
  assert.equal(empty.seq, null);
  assert.deepEqual([...empty.evidence], []);

  const cases = [
    ['available', 'available'],
    ['connected', 'available'],
    ['idle', 'idle'],
    ['busy', 'running'],
    ['worker-started', 'running'],
    ['progress', 'running'],
    ['reported-complete', 'reportedComplete'],
    ['unavailable', 'unavailable'],
    ['interrupted', 'interrupted'],
    ['failed', 'interrupted'],
  ];
  for (const [kind, expected] of cases) {
    const fresh = makeIfz().p;
    assert.equal(fresh.accept(iev({ kind })).admitted, true, kind);
    assert.equal(fresh.project().state, expected, kind);
  }
});

test('ifz: connected/idle/busy/worker text can never prove completion', () => {
  for (const kind of ['connected', 'idle', 'busy', 'worker-started', 'progress']) {
    const { p } = makeIfz();
    assert.equal(p.accept(iev({ kind })).admitted, true, kind);
    const status = p.project();
    assert.notEqual(status.state, 'reportedComplete', kind);
    assert.notEqual(status.state, 'verifiedComplete', kind);
    assert.deepEqual([...status.evidence], [], kind);
  }
});

test('ifz: self-reported complete is unverified with no evidence', () => {
  const { p } = makeIfz();
  p.accept(iev({ kind: 'reported-complete', evidence: ['claimed-1'] }));
  const status = p.project();
  assert.equal(status.state, 'reportedComplete');
  assert.equal(status.subtext, 'Work reported complete; not independently verified.');
  assert.deepEqual([...status.evidence], []);
});

test('ifz: verified-complete requires evidence refs', () => {
  const { p } = makeIfz();
  const noEvidence = p.accept(iev({ kind: 'verified-complete' }));
  assert.equal(noEvidence.code, 'EVENT_MALFORMED');
  assert.equal(p.project().state, 'uncertain');

  p.accept(iev({ kind: 'verified-complete', evidence: ['run-9.artifact'] }));
  const status = p.project();
  assert.equal(status.state, 'verifiedComplete');
  assert.equal(status.subtext, 'Work verified complete.');
  assert.deepEqual([...status.evidence], ['run-9.artifact']);
});

test('ifz: verifiedComplete sticky over idle/available, yields to running/interrupted', () => {
  const a = makeIfz().p;
  a.accept(iev({ kind: 'verified-complete', evidence: ['art-1'] }));
  a.accept(iev({ id: 'i2', seq: 2, kind: 'idle' }));
  assert.equal(a.project().state, 'verifiedComplete');
  a.accept(iev({ id: 'i3', seq: 3, kind: 'available' }));
  assert.equal(a.project().state, 'verifiedComplete');
  a.accept(iev({ id: 'i4', seq: 4, kind: 'worker-started' }));
  assert.equal(a.project().state, 'running');

  const b = makeIfz().p;
  b.accept(iev({ kind: 'verified-complete', evidence: ['art-2'] }));
  b.accept(iev({ id: 'i2', seq: 2, kind: 'interrupted' }));
  assert.equal(b.project().state, 'interrupted');
});

test('ifz: stale/future/duplicate/reordered events rejected; project-time staleness -> uncertain', () => {
  const { p, clock } = makeIfz();
  assert.equal(p.accept(iev({ kind: 'busy', at: NOW - IFZ_MAX_AGE - 1 })).code, 'EVENT_STALE');
  assert.equal(p.accept(iev({ kind: 'busy', at: NOW - IFZ_MAX_AGE })).admitted, true);
  assert.equal(p.project().state, 'running');

  assert.equal(p.accept(iev({ id: 'i2', seq: 2, at: NOW + 1 })).code, 'EVENT_FUTURE');
  assert.equal(p.accept(iev({ id: 'i3', seq: 2 })).admitted, true);
  assert.equal(p.accept(iev({ id: 'i4', seq: 1 })).code, 'EVENT_REORDERED');
  assert.equal(p.accept(iev({ id: 'i5', seq: 2 })).code, 'EVENT_DUPLICATE');
  assert.equal(p.accept(iev({ id: 'i3', seq: 3 })).code, 'EVENT_DUPLICATE');

  clock.advance(IFZ_MAX_AGE + 1);
  const status = p.project();
  assert.equal(status.state, 'uncertain');
  assert.equal(status.ageMs, IFZ_MAX_AGE + 1);
});

test('ifz: exact source/project/workspace identity enforced', () => {
  const { p } = makeIfz();
  assert.equal(p.accept(iev()).admitted, true);
  assert.equal(p.accept(iev({ id: 'i2', seq: 2, source: 'observer-2' })).code, 'EVENT_MISMATCH');
  assert.equal(p.accept(iev({ id: 'i3', seq: 2, project: 'proj-b' })).code, 'EVENT_MISMATCH');
  assert.equal(p.accept(iev({ id: 'i4', seq: 2, workspace: 'ws-b' })).code, 'EVENT_MISMATCH');
  assert.equal(p.accept(iev({ id: 'i5', seq: 2, project: undefined })).code, 'EVENT_MISMATCH');
  assert.equal(p.accept(iev({ id: 'i6', seq: 2, workspace: undefined })).code, 'EVENT_MISMATCH');

  const ok = p.accept(iev({ id: 'i7', seq: 2, kind: 'busy' }));
  assert.equal(ok.admitted, true);
  const status = p.project();
  assert.equal(status.source, 'observer-1');
  assert.equal(status.project, 'proj-a');
  assert.equal(status.workspace, 'ws-a');
});

test('ifz: strict UTF-8 byte bounds on events and subtext', () => {
  const { p } = makeIfz({ maxEventBytes: 256 });
  const res = p.accept(iev({ junk: '💥'.repeat(200) }));
  assert.equal(res.code, 'EVENT_TOO_LARGE');

  const { p: tight } = makeIfz({ maxSubtextBytes: 8 });
  tight.accept(iev({ kind: 'available' }));
  assert.equal(tight.project().subtext, 'System a');
  assert.ok(new TextEncoder().encode(tight.project().subtext).length <= 8);
});

test('ifz: adversarial non-plain/cyclic/accessor/proxy/deep objects rejected', () => {
  const { p } = makeIfz();

  const cyclic = iev();
  cyclic.self = cyclic;
  assert.equal(p.accept(cyclic).code, 'EVENT_MALFORMED');

  const throwingGetter = { ...iev() };
  Object.defineProperty(throwingGetter, 'id', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.equal(p.accept(throwingGetter).code, 'EVENT_MALFORMED');

  const nonEnumerableGetter = { ...iev(), id: 'ok' };
  Object.defineProperty(nonEnumerableGetter, 'seq', {
    enumerable: false,
    get() {
      throw new Error('boom');
    },
  });
  assert.equal(p.accept(nonEnumerableGetter).code, 'EVENT_MALFORMED');

  assert.equal(p.accept(new Date(NOW)).code, 'EVENT_MALFORMED');
  class Hostile {}
  const instance = new Hostile();
  Object.assign(instance, iev());
  assert.equal(p.accept(instance).code, 'EVENT_MALFORMED');

  const proxy = new Proxy(iev(), {
    getPrototypeOf() {
      throw new Error('trap');
    },
  });
  assert.equal(p.accept(proxy).code, 'EVENT_MALFORMED');

  let deep = {};
  let cur = deep;
  for (let i = 0; i < 50000; i += 1) {
    cur.x = {};
    cur = cur.x;
  }
  const deepRes = p.accept({ ...iev(), deep });
  assert.equal(deepRes.admitted, false);
  assert.ok(deepRes.code === 'EVENT_MALFORMED' || deepRes.code === 'EVENT_TOO_LARGE');

  assert.equal(p.stats().admitted, 0);
  assert.equal(p.project().state, 'uncertain');
});

test('ifz: duplicate evidence refs rejected; evidence bounds enforced', () => {
  const { p } = makeIfz();
  assert.equal(
    p.accept(iev({ kind: 'verified-complete', evidence: ['art-1', 'art-1'] })).code,
    'EVENT_MALFORMED',
  );

  const { p: bounded } = makeIfz({ maxEvidenceRefs: 2, maxEvidenceRefChars: 8 });
  assert.equal(
    bounded.accept(iev({ kind: 'verified-complete', evidence: ['a', 'b', 'c'] })).code,
    'EVENT_MALFORMED',
  );
  assert.equal(
    bounded.accept(iev({ kind: 'verified-complete', evidence: ['toolongref'] })).code,
    'EVENT_MALFORMED',
  );
  assert.equal(
    bounded.accept(iev({ kind: 'verified-complete', evidence: ['a', 'bbbbbbbb'] })).admitted,
    true,
  );
});

test('ifz: projection never contains prompts, typed content, window content, secrets, or reasoning', () => {
  const { p } = makeIfz();
  p.accept(
    iev({
      kind: 'busy',
      prompt: 'PROMPT-LEAK',
      content: 'TYPED-LEAK',
      windowText: 'WINDOW-LEAK',
      secret: 'SECRET-LEAK',
      sourceText: 'SOURCE-LEAK',
      reasoning: 'REASONING-LEAK',
    }),
  );
  const serialized = JSON.stringify(p.project());
  for (const marker of [
    'PROMPT-LEAK',
    'TYPED-LEAK',
    'WINDOW-LEAK',
    'SECRET-LEAK',
    'SOURCE-LEAK',
    'REASONING-LEAK',
  ]) {
    assert.equal(serialized.includes(marker), false, marker);
  }
});

test('ifz: exact age from injected clock; bounded rejection counters; reset clears identity', () => {
  const { p, clock } = makeIfz();
  p.accept(iev({ kind: 'busy', at: NOW - 250 }));
  assert.equal(p.project().ageMs, 250);
  clock.advance(100);
  assert.equal(p.project().ageMs, 350);

  p.accept(iev({ id: 'i2', seq: 2, at: NOW + 150 }));
  p.accept(iev({ id: 'i3', seq: 3, project: 'other-proj' }));
  const status = p.project();
  assert.equal(status.rejections.total, 2);
  assert.deepEqual(Object.keys(status.rejections.byCode).sort(), [
    'EVENT_DUPLICATE',
    'EVENT_FUTURE',
    'EVENT_MALFORMED',
    'EVENT_MISMATCH',
    'EVENT_REORDERED',
    'EVENT_STALE',
    'EVENT_TOO_LARGE',
  ]);
  assert.equal(status.rejections.byCode.EVENT_FUTURE, 1);
  assert.equal(status.rejections.byCode.EVENT_MISMATCH, 1);

  p.reset();
  const fresh = p.project();
  assert.equal(fresh.state, 'uncertain');
  assert.equal(fresh.admitted, 0);
  assert.equal(fresh.rejections.total, 0);
  assert.equal(p.accept(iev({ source: 'other-observer' })).admitted, true);
});
