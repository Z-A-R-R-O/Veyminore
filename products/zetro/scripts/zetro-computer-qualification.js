#!/usr/bin/env node

/**
 * ZETRO Computer: Offline Qualification Harness & Spec
 *
 * Implements the deterministic offline qualification harness for the forthcoming
 * real Windows Computer provider as specified in docs/COMPUTER-AGENT-AND-OVERLAY-PLAN.md.
 *
 * Core Architecture & Injected Ports:
 * 1. Authority Port: Session admission, exact window identity binding, grant TTL,
 *    revocation, user takeover barrier, and post-stop denial.
 * 2. Provider Port: Window inspection, frame observation, and input action execution.
 *    (Defaults to offline mock provider; --native flag fails closed by policy).
 * 3. Verifier Port: Independent post-action verification, frame integrity validation,
 *    and strict no-op input rejection.
 *
 * Notepad-Disposable Scenario Steps:
 *   exacttarget -> inspect -> observe -> planinput -> verify -> stop -> denyafterstop
 *
 * Invariants:
 * - Always marked MOCK-COMPUTER with nativeVerified: false.
 * - Native flag (--native) fails closed as unsupported until audited native helper is accepted.
 * - Exactly zero real desktop automation, zero real screenshots, zero real SendInput keystrokes.
 * - Exactly zero network requests, zero models, zero secrets, zero root manifest changes.
 *
 * Owned by AGR-5 (M0 Lead / Release Qualification).
 */

const { createHash } = require('node:crypto');
const assert = require('node:assert');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Native Windows Provider Error: Thrown when native execution is requested
 * before the native helper binary is officially accepted and audited.
 */
class UnsupportedNativeError extends Error {
  constructor(message) {
    super(message || 'Native Windows helper is not yet qualified or accepted. Fail-closed by policy.');
    this.name = 'UnsupportedNativeError';
    this.code = 'UNSUPPORTED_NATIVE';
  }
}

/**
 * Computer Authority Port: Manages sessions, tokens, grants, and security barriers.
 */
class ComputerAuthorityPort {
  constructor() {
    this.sessions = new Map();
  }

  createSession({ principal, target, ttlMs = 60000, maxInputs = 5 }) {
    const sessionId = `csess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionToken = `ctok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();

    const session = {
      sessionId,
      sessionToken,
      principal,
      target: { ...target },
      createdAt: now,
      expiresAt: now + ttlMs,
      maxInputs,
      inputsRemaining: maxInputs,
      state: 'ACTIVE', // ACTIVE | REVOKED | STOPPED
      userTakeover: false,
      revocationReason: null
    };

    this.sessions.set(sessionToken, session);
    return session;
  }

  checkAuthorization(sessionToken, operation, currentTarget) {
    const session = this.sessions.get(sessionToken);
    if (!session) {
      return { ok: false, code: 'session_not_found', reason: 'Session token not found or invalid' };
    }

    if (session.state === 'STOPPED') {
      return { ok: false, code: 'session_stopped', reason: 'Session has been stopped; further effects denied' };
    }

    if (session.state === 'REVOKED') {
      return { ok: false, code: 'session_revoked', reason: `Session revoked: ${session.revocationReason || 'administrative action'}` };
    }

    if (session.userTakeover) {
      return { ok: false, code: 'user_takeover_active', reason: 'User takeover active; agent desktop effects blocked' };
    }

    if (Date.now() > session.expiresAt) {
      return { ok: false, code: 'session_expired', reason: 'Session authorization grant has expired' };
    }

    // Exact window and process generation identity binding
    if (currentTarget) {
      if (currentTarget.windowHandle !== session.target.windowHandle) {
        return {
          ok: false,
          code: 'target_identity_mismatch',
          reason: `Window handle mismatch: expected '${session.target.windowHandle}', got '${currentTarget.windowHandle}'`
        };
      }
      if (currentTarget.processId !== session.target.processId) {
        return {
          ok: false,
          code: 'target_identity_mismatch',
          reason: `Process ID mismatch: expected '${session.target.processId}', got '${currentTarget.processId}'`
        };
      }
      if (currentTarget.processGeneration !== session.target.processGeneration) {
        return {
          ok: false,
          code: 'target_identity_mismatch',
          reason: `Process generation recycled/mismatched: expected '${session.target.processGeneration}', got '${currentTarget.processGeneration}'`
        };
      }
    }

    if (operation === 'input') {
      if (session.inputsRemaining <= 0) {
        return { ok: false, code: 'quota_exceeded', reason: 'Session input quota exhausted' };
      }
      session.inputsRemaining -= 1;
    }

    return { ok: true, session };
  }

  revokeSession(sessionToken, reason) {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.state = 'REVOKED';
      session.revocationReason = reason || 'explicit_revocation';
    }
  }

  recordUserTakeover(sessionToken) {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.userTakeover = true;
    }
  }

  stopSession(sessionToken) {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.state = 'STOPPED';
    }
  }
}

/**
 * Mock Computer Provider: Deterministic synthetic provider implementation.
 * Performs zero real desktop operations or OS SendInput calls.
 */
class MockComputerProvider {
  constructor(options = {}) {
    this.providerId = 'mock-computer-provider';
    this.isNative = false;
    this.simulatedText = options.initialText || '';
    this.actionDelayMs = options.actionDelayMs || 10;
  }

  async enumerateTargets() {
    return [
      {
        windowHandle: '0x00020468',
        processId: 10452,
        processGeneration: 'gen-10452-1792264000',
        processName: 'notepad.exe',
        title: 'Untitled - Notepad',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        displayId: 'display-primary-1'
      }
    ];
  }

  async inspectTarget(targetSpec) {
    await sleep(this.actionDelayMs);
    return {
      windowHandle: targetSpec.windowHandle,
      processId: targetSpec.processId,
      processGeneration: targetSpec.processGeneration,
      processName: targetSpec.processName,
      title: targetSpec.title,
      bounds: { ...targetSpec.bounds },
      isVisible: true,
      isMinimized: false,
      inspectedAt: Date.now()
    };
  }

  async captureObservation(targetSpec, options = {}) {
    await sleep(this.actionDelayMs);
    const content = options.injectTamperedContent !== undefined ? options.injectTamperedContent : this.simulatedText;
    const rawFrame = `MOCK_FRAME:[${targetSpec.windowHandle}]:[${content}]`;
    const frameDigest = options.injectForgedDigest ? '0000000000000000000000000000000000000000000000000000000000000000' : sha256(rawFrame);

    return {
      captureId: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      target: { ...targetSpec },
      rawText: content,
      frameDigest,
      dimensions: { width: targetSpec.bounds.width, height: targetSpec.bounds.height },
      dpi: 96
    };
  }

  async executeInput(targetSpec, planInput, options = {}) {
    await sleep(this.actionDelayMs);

    // If options.injectNoopInput is set, do not mutate simulated state
    if (!options.injectNoopInput) {
      if (planInput.type === 'type_text') {
        this.simulatedText += planInput.payload;
      }
    }

    return {
      actionId: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: planInput.type,
      appliedAt: Date.now(),
      targetWindow: targetSpec.windowHandle
    };
  }
}

/**
 * Native Windows Computer Provider Stub:
 * Fails closed immediately because native helper binaries are not yet qualified or audited.
 */
class NativeWindowsComputerProvider {
  constructor() {
    this.providerId = 'windows-native-helper';
    this.isNative = true;
    throw new UnsupportedNativeError('Native Windows helper is not yet qualified or accepted. Fail-closed by policy.');
  }
}

/**
 * Independent Computer Verifier:
 * Validates observation integrity, delta assertions, and rejects no-op inputs.
 */
class IndependentComputerVerifier {
  verifyObservation(observation, expectedContent) {
    if (!observation || typeof observation !== 'object') {
      return { ok: false, reason: 'Observation missing or invalid' };
    }
    const expectedFrame = `MOCK_FRAME:[${observation.target.windowHandle}]:[${expectedContent}]`;
    const expectedHash = sha256(expectedFrame);
    if (observation.frameDigest !== expectedHash) {
      return {
        ok: false,
        reason: `CAPTURE_DIGEST_CORRUPTED: Expected frame hash '${expectedHash}', got '${observation.frameDigest}'`
      };
    }
    return { ok: true, verifiedHash: observation.frameDigest };
  }

  verifyInputEffect(preObservation, postObservation, planInput) {
    if (!preObservation || !postObservation) {
      return { ok: false, reason: 'Missing pre or post observation for verification' };
    }

    // 1. Identity preservation check
    if (preObservation.target.windowHandle !== postObservation.target.windowHandle ||
        preObservation.target.processGeneration !== postObservation.target.processGeneration) {
      return { ok: false, reason: 'Target window or process generation mutated during input effect' };
    }

    // 2. Strict No-Op Input Barrier
    if (preObservation.frameDigest === postObservation.frameDigest) {
      return {
        ok: false,
        reason: 'NOOP_INPUT_UNVERIFIED: Action produced zero state change in target window'
      };
    }

    // 3. Expected payload delta check
    if (planInput.type === 'type_text') {
      const expectedPostText = preObservation.rawText + planInput.payload;
      if (postObservation.rawText !== expectedPostText) {
        return {
          ok: false,
          reason: `Input text delta mismatch: expected '${expectedPostText}', got '${postObservation.rawText}'`
        };
      }
    }

    return {
      ok: true,
      deltaBytes: Math.abs(postObservation.rawText.length - preObservation.rawText.length),
      preDigest: preObservation.frameDigest,
      postDigest: postObservation.frameDigest
    };
  }
}

/**
 * Execute the 7-step Notepad-disposable qualification scenario:
 * exacttarget -> inspect -> observe -> planinput -> verify -> stop -> denyafterstop
 */
async function runComputerScenario(options = {}) {
  const startTime = Date.now();
  const stages = [];

  // Check if native execution was requested
  if (options.nativeMode) {
    try {
      new NativeWindowsComputerProvider();
    } catch (err) {
      return {
        mode: 'NATIVE-WINDOWS',
        nativeVerified: false,
        error: err.message,
        code: err.code || 'UNSUPPORTED_NATIVE',
        durationMs: Date.now() - startTime,
        allStagesPassed: false,
        stages: []
      };
    }
  }

  const authority = new ComputerAuthorityPort();
  const provider = new MockComputerProvider({
    actionDelayMs: options.actionDelayMs || 5
  });
  const verifier = new IndependentComputerVerifier();

  const targetSpec = {
    windowHandle: '0x00020468',
    processId: 10452,
    processGeneration: 'gen-10452-1792264000',
    processName: 'notepad.exe',
    title: 'Untitled - Notepad',
    bounds: { x: 100, y: 100, width: 800, height: 600 },
    displayId: 'display-primary-1'
  };

  const ttlMs = options.ttlMs !== undefined ? options.ttlMs : 5000;
  const session = authority.createSession({
    principal: 'ocr-worker-1',
    target: targetSpec,
    ttlMs,
    maxInputs: 2
  });

  let preObservation = null;
  let postObservation = null;
  const planInput = {
    type: 'type_text',
    payload: 'ZETRO_NATIVE_INPUT_VERIFIED\n',
    targetCoords: { x: 150, y: 150 }
  };

  // ------------------------------------------------------------------------
  // Step 1: exacttarget (Admit session bound to exact window target)
  // ------------------------------------------------------------------------
  const authTarget1 = { ...targetSpec };
  if (options.injectWrongWindowAtTarget) {
    authTarget1.windowHandle = '0x00099999';
  }
  const check1 = authority.checkAuthorization(session.sessionToken, 'admit', authTarget1);
  if (!check1.ok) {
    stages.push({ step: 'exacttarget', status: 'FAILED', reason: check1.reason, code: check1.code });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  stages.push({ step: 'exacttarget', status: 'PASSED', target: targetSpec.windowHandle });

  // ------------------------------------------------------------------------
  // Step 2: inspect (Confirm window geometry and process generation)
  // ------------------------------------------------------------------------
  const currentTargetInspect = { ...targetSpec };
  if (options.injectWrongProcessGeneration) {
    currentTargetInspect.processGeneration = 'gen-10452-RECYCLED-999';
  }
  const check2 = authority.checkAuthorization(session.sessionToken, 'inspect', currentTargetInspect);
  if (!check2.ok) {
    stages.push({ step: 'inspect', status: 'FAILED', reason: check2.reason, code: check2.code });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  const inspection = await provider.inspectTarget(currentTargetInspect);
  assert.strictEqual(inspection.isVisible, true);
  stages.push({ step: 'inspect', status: 'PASSED', inspectionTimestamp: inspection.inspectedAt });

  // ------------------------------------------------------------------------
  // Step 3: observe (Capture initial pre-action observation)
  // ------------------------------------------------------------------------
  const check3 = authority.checkAuthorization(session.sessionToken, 'observe', targetSpec);
  if (!check3.ok) {
    stages.push({ step: 'observe', status: 'FAILED', reason: check3.reason, code: check3.code });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  preObservation = await provider.captureObservation(targetSpec, {
    injectForgedDigest: options.injectForgedDigestPre
  });
  const obsVerify1 = verifier.verifyObservation(preObservation, '');
  if (!obsVerify1.ok) {
    stages.push({ step: 'observe', status: 'FAILED', reason: obsVerify1.reason });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  stages.push({ step: 'observe', status: 'PASSED', preDigest: preObservation.frameDigest });

  // ------------------------------------------------------------------------
  // Step 4: planinput (Re-check authority immediately before effect, then act)
  // ------------------------------------------------------------------------
  if (options.injectUserTakeoverMidAwait) {
    authority.recordUserTakeover(session.sessionToken);
  }
  if (options.injectRevokeMidAwait) {
    authority.revokeSession(session.sessionToken, 'coordinator_emergency_revoke');
  }
  if (options.injectExpiredGrant) {
    await sleep(ttlMs + 20);
  }

  const currentTargetInput = { ...targetSpec };
  if (options.injectWrongWindowAtInput) {
    currentTargetInput.windowHandle = '0x000DEAD0';
  }

  const check4 = authority.checkAuthorization(session.sessionToken, 'input', currentTargetInput);
  if (!check4.ok) {
    stages.push({ step: 'planinput', status: 'FAILED', reason: check4.reason, code: check4.code });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }

  await provider.executeInput(targetSpec, planInput, {
    injectNoopInput: options.injectNoopInput
  });
  stages.push({ step: 'planinput', status: 'PASSED', inputType: planInput.type });

  // ------------------------------------------------------------------------
  // Step 5: verify (Capture post-action observation and verify state delta)
  // ------------------------------------------------------------------------
  const check5 = authority.checkAuthorization(session.sessionToken, 'observe', targetSpec);
  if (!check5.ok) {
    stages.push({ step: 'verify', status: 'FAILED', reason: check5.reason, code: check5.code });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }

  postObservation = await provider.captureObservation(targetSpec, {
    injectForgedDigest: options.injectForgedDigestPost
  });
  const effectResult = verifier.verifyInputEffect(preObservation, postObservation, planInput);
  if (!effectResult.ok) {
    stages.push({ step: 'verify', status: 'FAILED', reason: effectResult.reason });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  stages.push({ step: 'verify', status: 'PASSED', deltaBytes: effectResult.deltaBytes });

  // ------------------------------------------------------------------------
  // Step 6: stop (Transition session state to STOPPED)
  // ------------------------------------------------------------------------
  authority.stopSession(session.sessionToken);
  stages.push({ step: 'stop', status: 'PASSED', stoppedAt: Date.now() });

  // ------------------------------------------------------------------------
  // Step 7: denyafterstop (Enforce that post-stop requests are strictly denied)
  // ------------------------------------------------------------------------
  const checkPostStop = authority.checkAuthorization(session.sessionToken, 'observe', targetSpec);
  if (checkPostStop.ok) {
    stages.push({ step: 'denyafterstop', status: 'FAILED', reason: 'Authorization succeeded after session was stopped' });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  if (checkPostStop.code !== 'session_stopped') {
    stages.push({ step: 'denyafterstop', status: 'FAILED', reason: `Unexpected error code: ${checkPostStop.code}` });
    return buildScenarioResult(false, stages, startTime, provider.providerId);
  }
  stages.push({ step: 'denyafterstop', status: 'PASSED', denialCode: checkPostStop.code });

  return buildScenarioResult(true, stages, startTime, provider.providerId);
}

function buildScenarioResult(allPassed, stages, startTime, providerId) {
  return {
    mode: 'MOCK-COMPUTER',
    nativeVerified: false, // Invariant: synthetic offline harness never certifies native pass
    liveMilestonePassed: false,
    disclaimer: 'Deterministic offline fixture test only. Does not count as live or native qualification.',
    providerIdentity: providerId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    allStagesPassed: allPassed,
    stages,
    nativeLimitations: [
      'Windows Graphics Capture API unattached in offline harness',
      'UI Automation helper binary not accepted or audited',
      'SendInput synthetic keystrokes disabled without elevated host gate',
      'Display perimeter edge light overlay preview-only'
    ],
    unknownsCount: 0
  };
}

/**
 * Format report into human-readable text.
 */
function formatComputerReport(report) {
  const lines = [];
  lines.push('========================================================================');
  lines.push(' ZETRO Computer Qualification Harness (Offline Spec)');
  lines.push(` Mode: ${report.mode} | Provider: ${report.providerIdentity}`);
  lines.push(' Native Verified: FALSE (Offline Synthetic Fixture Only)');
  lines.push('========================================================================');
  lines.push(` Overall Status:        ${report.allStagesPassed ? 'PASSED (Deterministic Offline)' : 'FAILED / BLOCKED'}`);
  lines.push(` Duration:              ${report.durationMs}ms`);
  lines.push(` Total Stages:          ${report.stages.length}`);
  lines.push('------------------------------------------------------------------------');
  lines.push(' Scenario Lifecycle Stages:');
  lines.push('------------------------------------------------------------------------');

  for (const s of report.stages) {
    const sym = s.status === 'PASSED' ? '[PASS]' : '[FAIL]';
    const detail = s.reason ? ` -> ${s.reason}` : (s.denialCode ? ` (denied: ${s.denialCode})` : '');
    lines.push(` ${sym} ${s.step.padEnd(16)} status=${s.status}${detail}`);
  }

  lines.push('------------------------------------------------------------------------');
  lines.push(' Documented Native Limitations:');
  for (const lim of report.nativeLimitations) {
    lines.push(` • ${lim}`);
  }
  lines.push('========================================================================');
  lines.push(` Disclaimer: ${report.disclaimer}`);
  lines.push('========================================================================');

  return lines.join('\n');
}

/**
 * Deterministic Test Suite (8 Test Probes).
 */
async function runComputerTests() {
  console.log('========================================================================');
  console.log(' ZETRO Computer Qualification Test Suite (Offline Synthetic Runner)');
  console.log('========================================================================\n');

  // Test 1: Positive baseline scenario
  console.log('▶ Test 1: Executing complete 7-step Notepad-disposable scenario...');
  const pos = await runComputerScenario();
  assert.strictEqual(pos.allStagesPassed, true);
  assert.strictEqual(pos.stages.length, 7);
  assert.strictEqual(pos.nativeVerified, false);
  console.log('✔ Test 1: Complete 7-step Notepad scenario PASSED');

  // Test 2: Negative - Wrong window handle / identity mismatch
  console.log('▶ Test 2: Validating wrong window handle rejection barrier...');
  const negWrongWindow = await runComputerScenario({ injectWrongWindowAtInput: true });
  assert.strictEqual(negWrongWindow.allStagesPassed, false);
  const failStage2 = negWrongWindow.stages.find((s) => s.step === 'planinput');
  assert.strictEqual(failStage2.status, 'FAILED');
  assert.strictEqual(failStage2.code, 'target_identity_mismatch');
  console.log('✔ Test 2: Wrong window handle rejection barrier PASSED (denied at effect time)');

  // Test 3: Negative - Recycled process generation mismatch
  console.log('▶ Test 3: Validating recycled process generation rejection barrier...');
  const negWrongGen = await runComputerScenario({ injectWrongProcessGeneration: true });
  assert.strictEqual(negWrongGen.allStagesPassed, false);
  const failStage3 = negWrongGen.stages.find((s) => s.step === 'inspect');
  assert.strictEqual(failStage3.status, 'FAILED');
  assert.strictEqual(failStage3.code, 'target_identity_mismatch');
  console.log('✔ Test 3: Recycled process generation rejection barrier PASSED');

  // Test 4: Negative - User takeover mid-await barrier
  console.log('▶ Test 4: Validating user takeover mid-await barrier...');
  const negTakeover = await runComputerScenario({ injectUserTakeoverMidAwait: true });
  assert.strictEqual(negTakeover.allStagesPassed, false);
  const failStage4 = negTakeover.stages.find((s) => s.step === 'planinput');
  assert.strictEqual(failStage4.status, 'FAILED');
  assert.strictEqual(failStage4.code, 'user_takeover_active');
  console.log('✔ Test 4: User takeover mid-await barrier PASSED (input immediately blocked)');

  // Test 5: Negative - Revocation mid-await barrier
  console.log('▶ Test 5: Validating administrative revocation mid-await barrier...');
  const negRevoke = await runComputerScenario({ injectRevokeMidAwait: true });
  assert.strictEqual(negRevoke.allStagesPassed, false);
  const failStage5 = negRevoke.stages.find((s) => s.step === 'planinput');
  assert.strictEqual(failStage5.status, 'FAILED');
  assert.strictEqual(failStage5.code, 'session_revoked');
  console.log('✔ Test 5: Administrative revocation mid-await barrier PASSED');

  // Test 6: Negative - Expired grant barrier
  console.log('▶ Test 6: Validating expired grant TTL barrier...');
  const negExpire = await runComputerScenario({ ttlMs: 30, injectExpiredGrant: true });
  assert.strictEqual(negExpire.allStagesPassed, false);
  const failStage6 = negExpire.stages.find((s) => s.step === 'planinput');
  assert.strictEqual(failStage6.status, 'FAILED');
  assert.strictEqual(failStage6.code, 'session_expired');
  console.log('✔ Test 6: Expired grant TTL barrier PASSED');

  // Test 7: Negative - Forged capture digest rejection
  console.log('▶ Test 7: Validating forged capture digest rejection barrier...');
  const negDigest = await runComputerScenario({ injectForgedDigestPre: true });
  assert.strictEqual(negDigest.allStagesPassed, false);
  const failStage7 = negDigest.stages.find((s) => s.step === 'observe');
  assert.strictEqual(failStage7.status, 'FAILED');
  assert.ok(failStage7.reason.includes('CAPTURE_DIGEST_CORRUPTED'));
  console.log('✔ Test 7: Forged capture digest rejection barrier PASSED');

  // Test 8: Negative - No-op input never verified barrier
  console.log('▶ Test 8: Validating no-op input rejection barrier (zero state delta)...');
  const negNoop = await runComputerScenario({ injectNoopInput: true });
  assert.strictEqual(negNoop.allStagesPassed, false);
  const failStage8 = negNoop.stages.find((s) => s.step === 'verify');
  assert.strictEqual(failStage8.status, 'FAILED');
  assert.ok(failStage8.reason.includes('NOOP_INPUT_UNVERIFIED'));
  console.log('✔ Test 8: No-op input rejection barrier PASSED (unverified when delta is 0)');

  // Test 9: Negative - Native flag fail-closed unsupported
  console.log('▶ Test 9: Validating native flag fail-closed unsupported probe...');
  const nativeResult = await runComputerScenario({ nativeMode: true });
  assert.strictEqual(nativeResult.nativeVerified, false);
  assert.strictEqual(nativeResult.allStagesPassed, false);
  assert.strictEqual(nativeResult.code, 'UNSUPPORTED_NATIVE');
  console.log('✔ Test 9: Native flag fail-closed unsupported probe PASSED');

  console.log('\n========================================================================');
  console.log(' ALL 9 COMPUTER QUALIFICATION TESTS PASSED');
  console.log('========================================================================\n');
}

/**
 * Main entrypoint.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
========================================================================
 ZETRO Computer Qualification Harness Manual
========================================================================

Usage:
  node scripts/zetro-computer-qualification.js [options]

Options:
  --test, --mock    Run all 9 deterministic qualification test probes
  --json            Output machine-readable JSON scenario report
  --native          Attempt native execution (fails closed as unsupported)
  --help, -h        Display this help manual

Description:
  Offline qualification harness and contract spec for the forthcoming
  Windows native Computer provider. Enforces 7-stage disposable Notepad
  lifecycle:
    exacttarget -> inspect -> observe -> planinput -> verify -> stop -> denyafterstop

Invariants:
  • Clearly labeled MOCK-COMPUTER with nativeVerified: false.
  • Never counts as live or native qualification.
  • Native mode (--native) fails closed with UNSUPPORTED_NATIVE.
  • Zero real desktop input, zero screenshots, zero network requests, zero secrets.
`);
    return 0;
  }

  if (args.includes('--test') || args.includes('--mock')) {
    await runComputerTests();
    return 0;
  }

  if (args.includes('--native')) {
    const report = await runComputerScenario({ nativeMode: true });
    if (args.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`[zetro-computer-qualification] FAIL-CLOSED: ${report.error}`);
    }
    return 1;
  }

  const report = await runComputerScenario();

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatComputerReport(report));
  }

  return 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code || 0),
    (err) => {
      console.error(`[zetro-computer-qualification] Fatal error: ${err.message}`);
      process.exit(1);
    }
  );
}

module.exports = {
  ComputerAuthorityPort,
  MockComputerProvider,
  NativeWindowsComputerProvider,
  IndependentComputerVerifier,
  runComputerScenario,
  runComputerTests
};
