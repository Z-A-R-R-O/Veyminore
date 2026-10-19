export function windowRow(overrides = {}) {
  return {
    hwnd: 100,
    title: 'Fixture Window',
    processId: 42,
    processName: 'fixture.exe',
    visible: true,
    minimized: false,
    generation: 'g1',
    ...overrides,
  };
}

export function enumerateResponse(windows, meta = {}) {
  return JSON.stringify({
    windows,
    generation: meta.generation ?? 'g1',
    observedAt: meta.observedAt ?? 1000000,
  });
}

export function scriptRunner(steps) {
  const queue = [...steps];
  const calls = [];
  return {
    calls,
    run(spec, opts = {}) {
      calls.push({ spec });
      const step = queue.shift();
      if (!step) return Promise.reject(new Error('fixture script exhausted'));
      if (typeof step === 'function') return Promise.resolve(step(spec, opts));
      if (step.error) return Promise.reject(step.error);
      if (step.hang) {
        return new Promise((_, reject) => {
          const signal = opts.signal;
          if (signal && signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return Promise.resolve({ ok: true, stdout: step.stdout });
    },
  };
}

export function hangForever() {
  return scriptRunner([{ hang: true }]);
}

export function fixedClock(startAt) {
  let now = startAt;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

export function unsupportedCaptureBackend() {
  return { status: 'unsupported' };
}

export function supportedCaptureBackend(captureFn, { independentlyTested = true } = {}) {
  return { status: 'supported', independentlyTested, capture: captureFn };
}
