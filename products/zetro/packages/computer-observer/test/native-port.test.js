import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObserver,
  createNativeObservationAdapter,
  ObserverError,
} from '../src/index.js';

const NOW = 1000000;

function record(overrides = {}) {
  return {
    windowHandle: 500,
    processId: 42,
    processStartedAt: 900,
    generation: 'g7',
    displayId: 1,
    minimized: false,
    visible: true,
    title: 'Fixture',
    ...overrides,
  };
}

function enumerateResponse(records, meta = {}) {
  return {
    windows: records,
    generation: meta.generation ?? 'g7',
    observedAt: meta.observedAt ?? NOW,
  };
}

function inspectResponse(rec, observedAt = NOW) {
  return { window: rec, observedAt };
}

function okArtifact() {
  return { mime: 'image/png', width: 4, height: 4, bytes: 9, artifactId: 'art-1' };
}

function defaultInspect(recordsByHandle) {
  return async ({ windowHandle }) =>
    recordsByHandle.has(windowHandle) ? inspectResponse(recordsByHandle.get(windowHandle)) : null;
}

function makeAdapter(portOverrides = {}, options = {}) {
  const handles = new Map([[500, record()]]);
  const port = {
    enumerate: async () => enumerateResponse([record()]),
    inspect: defaultInspect(handles),
    capture: async () => ({ artifact: okArtifact() }),
    ...portOverrides,
  };
  const adapter = createNativeObservationAdapter({
    port,
    clock: () => NOW,
    maxAgeMs: 5000,
    timeoutMs: 1000,
    ...options,
  });
  return { adapter, port, handles };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ObserverError, `expected ObserverError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

function hangingMethod() {
  return (_params, opts = {}) =>
    new Promise((_, reject) => {
      if (opts.signal && opts.signal.aborted) {
        reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
        return;
      }
      if (opts.signal) {
        opts.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' })),
          { once: true },
        );
      }
    });
}

test('adapter is compatible with existing createObserver as processRunner', async () => {
  const { adapter } = makeAdapter();
  const observer = createObserver({ processRunner: adapter, clock: () => NOW, maxAgeMs: 5000 });
  const snapshot = await observer.enumerate();
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.windows[0].hwnd, 500);
  assert.equal(snapshot.windows[0].processId, 42);
  assert.equal(snapshot.ageMs, 0);
});

test('adapter exposes exact identity fields and freshness on inspect', async () => {
  const { adapter } = makeAdapter();
  const rec = await adapter.inspect({ windowHandle: 500 });
  assert.equal(rec.windowHandle, 500);
  assert.equal(rec.processId, 42);
  assert.equal(rec.processStartedAt, 900);
  assert.equal(rec.generation, 'g7');
  assert.equal(rec.displayId, 1);
  assert.equal(rec.observedAt, NOW);
  assert.equal(rec.ageMs, 0);
});

test('adapter works as captureBackend for createObserver capture path', async () => {
  const { adapter } = makeAdapter({ independentlyTested: true });
  const observer = createObserver({
    processRunner: adapter,
    captureBackend: adapter,
    clock: () => NOW,
    maxAgeMs: 5000,
  });
  const result = await observer.observeWindow({ hwnd: 500, capture: true });
  assert.equal(result.capture.status, 'captured');
  assert.equal(result.capture.artifact.ref, 'art-1');
  assert.equal(result.capture.attestation, 'caller_asserted_not_native_verified');
});

test('regression: direct adapter artifact shape is accepted by actual createObserver.performCapture', async () => {
  const { adapter } = makeAdapter({ independentlyTested: true });

  const direct = await adapter.capture({ windowHandle: 500, processId: 42 });
  assert.equal(direct.status, 'captured');
  assert.equal(direct.artifact.ref, 'art-1');
  assert.equal(direct.artifact.artifactId, 'art-1');
  assert.equal(direct.artifact.mime, 'image/png');
  assert.equal(direct.artifact.width, 4);
  assert.equal(direct.artifact.bytes, 9);
  assert.ok(direct.artifact.artifactId.length <= 512, 'artifactId must stay bounded');
  assert.equal('data' in direct, false);
  assert.equal('pixels' in direct, false);
  assert.equal('base64' in direct, false);
  assert.equal('nativeVerified' in direct, false);

  const observer = createObserver({
    processRunner: adapter,
    captureBackend: adapter,
    clock: () => NOW,
    maxAgeMs: 5000,
    timeoutMs: 1000,
  });
  const result = await observer.observeWindow({
    hwnd: 500,
    expectedGeneration: 'g7',
    expectedProcessId: 42,
    capture: true,
  });
  assert.equal(result.status, 'observed');
  assert.equal(result.capture.status, 'captured');
  assert.equal(result.capture.artifact.ref, 'art-1');
  assert.equal(result.capture.artifact.mime, 'image/png');
  assert.equal(result.capture.artifact.width, 4);
  assert.equal(result.capture.artifact.height, 4);
  assert.equal(result.capture.artifact.bytes, 9);
  assert.equal(result.capture.attestation, 'caller_asserted_not_native_verified');
  assert.equal('nativeVerified' in result.capture, false);
  assert.equal(JSON.stringify(result).includes('nativeVerified'), false);
});

test('wrong expected PID before capture is PROCESS_MISMATCH', async () => {
  const { adapter } = makeAdapter();
  await expectCode(
    adapter.capture({ windowHandle: 500, processId: 7 }),
    'PROCESS_MISMATCH',
  );
});

test('PID changed across async capture (reused HWND) is PROCESS_MISMATCH and returns no artifact', async () => {
  let calls = 0;
  const { adapter } = makeAdapter({
    inspect: async ({ windowHandle }) => {
      calls += 1;
      if (windowHandle !== 500) return null;
      return inspectResponse(calls === 1 ? record() : record({ processId: 999 }));
    },
  });
  await expectCode(adapter.capture({ windowHandle: 500, processId: 42 }), 'PROCESS_MISMATCH');
  assert.ok(calls >= 2, 'pre and post capture identity rechecks must both run');
});

test('processStartedAt renewed across capture (reused HWND) is WINDOW_STALE', async () => {
  let calls = 0;
  const { adapter } = makeAdapter({
    inspect: async ({ windowHandle }) => {
      calls += 1;
      if (windowHandle !== 500) return null;
      return inspectResponse(calls === 1 ? record() : record({ processStartedAt: 950 }));
    },
  });
  await expectCode(
    adapter.capture({ windowHandle: 500, processId: 42, processStartedAt: 900 }),
    'WINDOW_STALE',
  );
});

test('target closed before capture is WINDOW_MISSING', async () => {
  const { adapter } = makeAdapter({
    inspect: async () => null,
  });
  await expectCode(adapter.capture({ windowHandle: 500 }), 'WINDOW_MISSING');
});

test('target closed during capture (missing after) is WINDOW_MISSING and returns no artifact', async () => {
  let calls = 0;
  const { adapter } = makeAdapter({
    inspect: async ({ windowHandle }) => {
      calls += 1;
      if (windowHandle !== 500) return null;
      return calls === 1 ? inspectResponse(record()) : null;
    },
  });
  await expectCode(adapter.capture({ windowHandle: 500, processId: 42 }), 'WINDOW_MISSING');
});

test('minimized target is WINDOW_MINIMIZED', async () => {
  const handles = new Map([[500, record({ minimized: true })]]);
  const { adapter } = makeAdapter({ inspect: defaultInspect(handles) });
  await expectCode(adapter.capture({ windowHandle: 500 }), 'WINDOW_MINIMIZED');
});

test('hidden target is WINDOW_NOT_VISIBLE', async () => {
  const handles = new Map([[500, record({ visible: false })]]);
  const { adapter } = makeAdapter({ inspect: defaultInspect(handles) });
  await expectCode(adapter.capture({ windowHandle: 500 }), 'WINDOW_NOT_VISIBLE');
});

test('stale enumerate response is WINDOW_STALE', async () => {
  const { adapter } = makeAdapter({
    enumerate: async () => enumerateResponse([record()], { observedAt: NOW - 100000 }),
  });
  await expectCode(adapter.enumerate(), 'WINDOW_STALE');
});

test('future observedAt is RESPONSE_MALFORMED', async () => {
  const { adapter } = makeAdapter({
    enumerate: async () => enumerateResponse([record()], { observedAt: NOW + 1 }),
  });
  await expectCode(adapter.enumerate(), 'RESPONSE_MALFORMED');
});

test('revoked adapter rejects enumerate and capture with PORT_REVOKED', async () => {
  const { adapter } = makeAdapter();
  adapter.revoke();
  assert.equal(adapter.revoked, true);
  await expectCode(adapter.enumerate(), 'PORT_REVOKED');
  await expectCode(adapter.capture({ windowHandle: 500 }), 'PORT_REVOKED');
  await expectCode(adapter.run({ kind: 'enumerate' }), 'PORT_REVOKED');
});

test('provider throwing REVOKED maps to PORT_REVOKED', async () => {
  const { adapter } = makeAdapter({
    enumerate: async () => {
      throw Object.assign(new Error('token revoked'), { code: 'REVOKED' });
    },
  });
  await expectCode(adapter.enumerate(), 'PORT_REVOKED');
});

test('pre-aborted signal is OBSERVER_CANCELLED without provider call', async () => {
  let called = 0;
  const { adapter } = makeAdapter({
    enumerate: async () => {
      called += 1;
      return enumerateResponse([record()]);
    },
  });
  const ac = new AbortController();
  ac.abort();
  await expectCode(adapter.enumerate({ signal: ac.signal }), 'OBSERVER_CANCELLED');
  assert.equal(called, 0);
});

test('mid-flight cancel is OBSERVER_CANCELLED', async () => {
  const { adapter } = makeAdapter({ enumerate: hangingMethod() });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  await expectCode(adapter.enumerate({ signal: ac.signal }), 'OBSERVER_CANCELLED');
});

test('hung provider times out with OBSERVER_TIMEOUT', async () => {
  const { adapter } = makeAdapter({ enumerate: hangingMethod() }, { timeoutMs: 20 });
  await expectCode(adapter.enumerate(), 'OBSERVER_TIMEOUT');
});

test('oversized provider response is RESPONSE_TOO_LARGE', async () => {
  const { adapter } = makeAdapter(
    { enumerate: async () => enumerateResponse([record({ title: 'x'.repeat(4096) })]) },
    { maxResponseBytes: 512 },
  );
  await expectCode(adapter.enumerate(), 'RESPONSE_TOO_LARGE');
});

test('invalid identity fields are dropped; all-invalid is RESPONSE_MALFORMED', async () => {
  const missingDisplayId = makeAdapter({
    enumerate: async () => enumerateResponse([record({ displayId: undefined })]),
  });
  await expectCode(missingDisplayId.adapter.enumerate(), 'RESPONSE_MALFORMED');

  const nonBooleanFlags = makeAdapter({
    enumerate: async () =>
      enumerateResponse([record(), record({ windowHandle: 600, minimized: 'true' })]),
  });
  const snapshot = await nonBooleanFlags.adapter.enumerate();
  assert.equal(snapshot.windows.length, 1);
  assert.equal(snapshot.dropped, 1);
});

test('missing native provider returns CAPTURE_UNSUPPORTED everywhere', async () => {
  const adapter = createNativeObservationAdapter({ clock: () => NOW });
  assert.equal(adapter.status, 'unsupported');
  await expectCode(adapter.enumerate(), 'CAPTURE_UNSUPPORTED');
  await expectCode(adapter.inspect({ windowHandle: 500 }), 'CAPTURE_UNSUPPORTED');
  await expectCode(adapter.capture({ windowHandle: 500 }), 'CAPTURE_UNSUPPORTED');
  assert.equal(adapter.getCapabilities().provider, 'missing');
  assert.equal(adapter.getCapabilities().nativeCapture, 'unsupported');
});

test('adapter never self-labels nativeVerified', async () => {
  const { adapter } = makeAdapter({ independentlyTested: true });
  const caps = adapter.getCapabilities();
  assert.equal(caps.nativeCaptureAttestation, 'caller_asserted_not_native_verified');
  assert.equal('nativeVerified' in caps, false);
  const result = await adapter.capture({ windowHandle: 500 });
  assert.equal(result.attestation, 'caller_asserted_not_native_verified');
  assert.equal('nativeVerified' in result, false);
  assert.equal(JSON.stringify(result).includes('nativeVerified'), false);
});

test('unsupported spec.kind is REQUEST_INVALID', async () => {
  const { adapter } = makeAdapter();
  await expectCode(adapter.run({ kind: 'click' }), 'REQUEST_INVALID');
});

test('prior public API is preserved', () => {
  assert.equal(typeof createObserver, 'function');
  assert.equal(typeof createNativeObservationAdapter, 'function');
  const { adapter } = makeAdapter();
  assert.equal(typeof adapter.run, 'function');
  assert.equal(typeof adapter.capture, 'function');
  assert.deepEqual(adapter.getCapabilities().effects, {
    mouse: false,
    keyboard: false,
    clipboard: false,
    shell: false,
  });
});
