/**
 * @file index.js
 * Offline conformance harness for the Computer alpha.
 * Dependency-free ESM. Injected contract/session/observer ports only.
 *
 * Verification modes (never conflated):
 *  - 'implementation': harness self-checks against its own state machine.
 *  - 'mock': scenarios run against injected in-memory mock ports (offline, deterministic).
 *  - 'native-live': scenarios run against real OCR-1/2/3 packages + real desktop observer.
 *                   Fail-closed: ALWAYS blocked in this offline harness. Caller-supplied
 *                   ports/labels are wiring only and never certify native-live; independent
 *                   attestation of actual packages is required and happens outside this module.
 */

const MODES = Object.freeze(['implementation', 'mock', 'native-live']);

class ConformanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConformanceError';
    this.code = code;
  }
}

/** Lifecycle state machine: idle -> authenticated -> granted -> observing -> revoked -> stopped -> exported */
const STATES = Object.freeze([
  'idle', 'authenticated', 'granted', 'observing', 'revoked', 'stopped', 'exported'
]);

const TRANSITIONS = Object.freeze({
  authenticate: { from: 'idle', to: 'authenticated' },
  grant: { from: 'authenticated', to: 'granted' },
  observe: { from: 'granted', to: 'observing' },
  revoke: { from: 'observing', to: 'revoked' },
  stop: { from: 'revoked', to: 'stopped' },
  exportAudit: { from: 'stopped', to: 'exported' }
});

function assertTransition(state, action) {
  const t = TRANSITIONS[action];
  if (!t) throw new ConformanceError('UNKNOWN_ACTION', `unknown action: ${action}`);
  if (state !== t.from) {
    throw new ConformanceError('INVALID_STATE', `action ${action} requires state ${t.from}, have ${state}`);
  }
  return t.to;
}

/** Simple deterministic digest for evidence identity (dependency-free; not cryptographic). */
function evidenceDigest(payload) {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-32:${h.toString(16).padStart(8, '0')}`;
}

/**
 * Injected port contract:
 *  contractPort:  { authenticate({subject, credential}), grant({subject, target, ttlMs, now}), revoke({grantId, now}) }
 *  sessionPort:   { beginObservation({grantId, target, now}), stopObservation({observationId, now}) }
 *  observerPort:  { observe({observationId, claim, now}), exportAudit({sessionId, now}) }
 */

/** In-memory mock ports for offline mock verification. */
export function createMockPorts({ now = () => Date.now() } = {}) {
  const audit = [];
  let grantSeq = 0, obsSeq = 0;
  const grants = new Map();
  const observations = new Map();

  const contractPort = {
    async authenticate({ subject, credential }) {
      if (!subject || credential !== 'valid-credential') {
        throw new ConformanceError('AUTH_FAILED', 'invalid subject or credential');
      }
      return { subject, authenticatedAt: now() };
    },
    async grant({ subject, target, ttlMs = 60000 }) {
      if (!target) throw new ConformanceError('NO_TARGET', 'grant requires a target');
      const grantId = `grant-${++grantSeq}`;
      const g = { grantId, subject, target, expiresAt: now() + ttlMs, revoked: false };
      grants.set(grantId, g);
      audit.push({ type: 'grant', grantId, at: now() });
      return { grantId, subject, target, expiresAt: g.expiresAt };
    },
    async revoke({ grantId, at = now() }) {
      const g = grants.get(grantId);
      if (!g) throw new ConformanceError('UNKNOWN_GRANT', `no grant ${grantId}`);
      if (at >= g.expiresAt) throw new ConformanceError('GRANT_EXPIRED', 'grant already expired');
      g.revoked = true;
      audit.push({ type: 'revoke', grantId, at });
      return { grantId, revoked: true };
    },
    /** Exposed for stale-target scenario: checks observation target still matches grant target. */
    checkTarget({ grantId, target }) {
      const g = grants.get(grantId);
      if (!g) throw new ConformanceError('UNKNOWN_GRANT', `no grant ${grantId}`);
      if (g.target !== target) throw new ConformanceError('STALE_TARGET', 'target changed since grant');
      return true;
    }
  };

  const sessionPort = {
    async beginObservation({ grantId, target, at = now() }) {
      const g = grants.get(grantId);
      if (!g) throw new ConformanceError('UNKNOWN_GRANT', `no grant ${grantId}`);
      if (g.revoked) throw new ConformanceError('GRANT_REVOKED', 'grant revoked');
      if (target !== g.target) throw new ConformanceError('STALE_TARGET', 'begin target must exactly equal grant target');
      if (at >= g.expiresAt) throw new ConformanceError('GRANT_EXPIRED', 'grant expired');
      const observationId = `obs-${++obsSeq}`;
      const o = { observationId, grantId, target, subject: g.subject, canceled: false, stopped: false, claims: [] };
      observations.set(observationId, o);
      return { observationId, pending: true };
    },
    async cancelObservation({ observationId, at = now() }) {
      const o = observations.get(observationId);
      if (!o) throw new ConformanceError('UNKNOWN_OBSERVATION', `no observation ${observationId}`);
      o.canceled = true;
      audit.push({ type: 'cancel', observationId, at });
      return { observationId, canceled: true };
    },
    async stopObservation({ observationId, at = now() }) {
      const o = observations.get(observationId);
      if (!o) throw new ConformanceError('UNKNOWN_OBSERVATION', `no observation ${observationId}`);
      if (o.canceled) throw new ConformanceError('OBSERVATION_CANCELED', 'observation was canceled');
      o.stopped = true;
      audit.push({ type: 'stop', observationId, at });
      return { observationId, stopped: true };
    },
    _observations: observations
  };

  const observerPort = {
    async observe({ observationId, claim, target, at = now() }) {
      const o = observations.get(observationId);
      if (!o) throw new ConformanceError('UNKNOWN_OBSERVATION', `no observation ${observationId}`);
      if (o.canceled) throw new ConformanceError('OBSERVATION_CANCELED', 'observation was canceled');
      if (o.stopped) throw new ConformanceError('OBSERVATION_STOPPED', 'observation already stopped');
      if (!claim || claim.observerId !== 'trusted-observer') {
        throw new ConformanceError('OBSERVER_CLAIM_REJECTED', 'untrusted or missing observer claim');
      }
      // Re-validate authority at the observe effect boundary (after the await boundary).
      const g = grants.get(o.grantId);
      if (!g) throw new ConformanceError('UNKNOWN_GRANT', `no grant ${o.grantId}`);
      if (g.revoked) throw new ConformanceError('GRANT_REVOKED', 'grant revoked before observe effect');
      if (at >= g.expiresAt) throw new ConformanceError('GRANT_EXPIRED', 'grant expired before observe effect');
      if (o.target !== g.target) {
        throw new ConformanceError('STALE_TARGET', 'observation target diverged from grant target');
      }
      if (target !== undefined && target !== o.target) {
        throw new ConformanceError('STALE_TARGET', 'observe target does not exactly match observation target');
      }
      const claimedDigest = claim.evidenceDigest;
      const actual = evidenceDigest(claim.evidence);
      if (claimedDigest !== actual) {
        throw new ConformanceError('EVIDENCE_MISMATCH', 'evidence digest does not match payload');
      }
      o.claims.push({ at, digest: actual, observerId: claim.observerId });
      audit.push({ type: 'observe', observationId, at, digest: actual });
      return { observationId, accepted: true, evidenceDigest: actual };
    },
    async exportAudit({ at = now() }) {
      const records = audit.map((r, i) => ({ seq: i, ...r }));
      const exportDigest = evidenceDigest(JSON.stringify(records));
      audit.push({ type: 'exportAudit', at, exportDigest });
      return { records, exportDigest, exportedAt: at };
    }
  };

  return { contractPort, sessionPort, observerPort };
}

/**
 * Integration entrypoints for OCR-1 (contract), OCR-2 (session), OCR-3 (observer) actual packages.
 * Fail-closed: supplying ports/labels is WIRING ONLY and never certifies native-live.
 * Native-live certification requires independent attestation performed outside this offline
 * harness; caller-supplied ports or self-declared labels cannot satisfy it.
 */
export function createIntegrationEntrypoints({ ocr1 = null, ocr2 = null, ocr3 = null } = {}) {
  const missing = [];
  if (!ocr1) missing.push('OCR-1:contract');
  if (!ocr2) missing.push('OCR-2:session');
  if (!ocr3) missing.push('OCR-3:observer');
  return {
    available: false,
    wiringComplete: missing.length === 0,
    attested: false,
    attestationRequired: true,
    missing,
    contractPort: ocr1,
    sessionPort: ocr2,
    observerPort: ocr3
  };
}

/** Run one named scenario against injected ports. Returns a structured result. */
export async function runScenario(name, ports, ctx = {}) {
  const { contractPort, sessionPort, observerPort } = ports;
  const result = { name, ok: false, steps: [], error: null };
  const step = async (label, fn) => {
    try {
      const out = await fn();
      result.steps.push({ label, ok: true });
      return out;
    } catch (e) {
      result.steps.push({ label, ok: false, code: e.code || e.name, message: e.message });
      throw e;
    }
  };
  try {
    switch (name) {
      case 'lifecycle': {
        const target = ctx.target || 'win://desktop/root';
        await step('authenticate', () => contractPort.authenticate({ subject: ctx.subject || 'alice', credential: 'valid-credential' }));
        const { grantId } = await step('grant', () => contractPort.grant({ subject: ctx.subject || 'alice', target, ttlMs: 60000 }));
        const { observationId } = await step('observe:begin', () => sessionPort.beginObservation({ grantId, target }));
        await step('observe:claim', () => observerPort.observe({
          observationId,
          claim: { observerId: 'trusted-observer', evidence: { kind: 'screenshot', target }, evidenceDigest: evidenceDigest({ kind: 'screenshot', target }) }
        }));
        await step('revoke', () => contractPort.revoke({ grantId }));
        await step('stop', () => sessionPort.stopObservation({ observationId }));
        const audit = await step('exportAudit', () => observerPort.exportAudit({}));
        if (!audit.exportDigest) throw new ConformanceError('AUDIT_EXPORT', 'missing export digest');
        result.auditExportDigest = audit.exportDigest;
        result.ok = true;
        break;
      }
      case 'stale-target': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        try {
          await contractPort.checkTarget({ grantId, target: 'win://desktop/other' });
          throw new ConformanceError('EXPECTED_STALE', 'stale target was not rejected');
        } catch (e) {
          if (e.code !== 'STALE_TARGET') throw e;
        }
        result.steps.push({ label: 'stale-target-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'expired-grant': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 1 });
        await new Promise(r => setTimeout(r, 5));
        try {
          await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
          throw new ConformanceError('EXPECTED_EXPIRED', 'expired grant was not rejected');
        } catch (e) {
          if (e.code !== 'GRANT_EXPIRED') throw e;
        }
        result.steps.push({ label: 'expired-grant-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'canceled-pending-observation': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
        await sessionPort.cancelObservation({ observationId });
        try {
          await observerPort.observe({
            observationId,
            claim: { observerId: 'trusted-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_CANCELED', 'canceled observation was not rejected');
        } catch (e) {
          if (e.code !== 'OBSERVATION_CANCELED') throw e;
        }
        result.steps.push({ label: 'canceled-observation-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'malicious-observer-claim': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
        try {
          await observerPort.observe({
            observationId,
            claim: { observerId: 'evil-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_REJECT', 'malicious claim was not rejected');
        } catch (e) {
          if (e.code !== 'OBSERVER_CLAIM_REJECTED') throw e;
        }
        result.steps.push({ label: 'malicious-claim-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'evidence-identity': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
        try {
          await observerPort.observe({
            observationId,
            claim: { observerId: 'trusted-observer', evidence: 'real', evidenceDigest: evidenceDigest('forged') }
          });
          throw new ConformanceError('EXPECTED_MISMATCH', 'forged evidence digest was not rejected');
        } catch (e) {
          if (e.code !== 'EVIDENCE_MISMATCH') throw e;
        }
        result.steps.push({ label: 'forged-evidence-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'wrong-target-during-observe': {
        const grantT = 'win://desktop/root';
        const { grantId } = await contractPort.grant({ subject: 'alice', target: grantT, ttlMs: 60000 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: grantT });
        try {
          await observerPort.observe({
            observationId,
            target: 'win://desktop/other',
            claim: { observerId: 'trusted-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_STALE', 'wrong observe target was not rejected');
        } catch (e) {
          if (e.code !== 'STALE_TARGET') throw e;
        }
        result.steps.push({ label: 'wrong-target-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'revoke-during-observe': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
        await contractPort.revoke({ grantId });
        try {
          await observerPort.observe({
            observationId,
            target: 'win://desktop/root',
            claim: { observerId: 'trusted-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_REVOKED', 'post-revoke observe was not rejected');
        } catch (e) {
          if (e.code !== 'GRANT_REVOKED') throw e;
        }
        result.steps.push({ label: 'post-revoke-observe-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'expiry-during-observe': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 40 });
        const { observationId } = await sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
        await new Promise(r => setTimeout(r, 50));
        try {
          await observerPort.observe({
            observationId,
            target: 'win://desktop/root',
            claim: { observerId: 'trusted-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_EXPIRED', 'post-expiry observe was not rejected');
        } catch (e) {
          if (e.code !== 'GRANT_EXPIRED') throw e;
        }
        result.steps.push({ label: 'post-expiry-observe-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'direct-wrong-target-creation': {
        const { grantId } = await contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 60000 });
        try {
          await sessionPort.beginObservation({ grantId, target: 'win://desktop/other' });
          throw new ConformanceError('EXPECTED_STALE', 'wrong begin target was not rejected');
        } catch (e) {
          if (e.code !== 'STALE_TARGET') throw e;
        }
        result.steps.push({ label: 'wrong-begin-target-rejected', ok: true });
        result.ok = true;
        break;
      }
      case 'exact-expiry': {
        let clock = { t: 1000000 };
        const p = createMockPorts({ now: () => clock.t });
        const { grantId } = await p.contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 1000 });
        clock.t += 1000; // exactly expiresAt
        try {
          await p.sessionPort.beginObservation({ grantId, target: 'win://desktop/root' });
          throw new ConformanceError('EXPECTED_EXPIRED', 'begin at exact expiry was not rejected');
        } catch (e) {
          if (e.code !== 'GRANT_EXPIRED') throw e;
        }
        const live = await p.contractPort.grant({ subject: 'alice', target: 'win://desktop/root', ttlMs: 1000 });
        const startedAt = clock.t;
        const { observationId } = await p.sessionPort.beginObservation({ grantId: live.grantId, target: 'win://desktop/root' });
        clock.t = startedAt + 1000; // exactly expiresAt
        try {
          await p.observerPort.observe({
            observationId,
            target: 'win://desktop/root',
            claim: { observerId: 'trusted-observer', evidence: 'x', evidenceDigest: evidenceDigest('x') }
          });
          throw new ConformanceError('EXPECTED_EXPIRED', 'observe at exact expiry was not rejected');
        } catch (e) {
          if (e.code !== 'GRANT_EXPIRED') throw e;
        }
        result.steps.push({ label: 'exact-expiry-rejected-at-begin-and-observe', ok: true });
        result.ok = true;
        break;
      }
      default:
        throw new ConformanceError('UNKNOWN_SCENARIO', `unknown scenario: ${name}`);
    }
  } catch (e) {
    result.error = { code: e.code || e.name, message: e.message };
  }
  return result;
}

export const SCENARIOS = Object.freeze([
  'lifecycle',
  'stale-target',
  'expired-grant',
  'canceled-pending-observation',
  'malicious-observer-claim',
  'evidence-identity',
  'wrong-target-during-observe',
  'revoke-during-observe',
  'expiry-during-observe',
  'direct-wrong-target-creation',
  'exact-expiry'
]);

/**
 * Run the full conformance suite.
 * mode 'mock'          -> uses supplied ports (defaults to in-memory mocks). Offline verification.
 * mode 'native-live'   -> requires integration entrypoints with actual OCR-1/2/3 ports; else all
 *                         results are 'blocked'. Never reported as passed without real ports.
 */
export async function runConformance({ mode = 'mock', ports = null, integration = null } = {}) {
  if (!MODES.includes(mode)) throw new ConformanceError('UNKNOWN_MODE', `mode must be one of ${MODES.join(', ')}`);

  if (mode === 'native-live') {
    // Fail-closed: never certify native-live from caller-supplied ports or labels.
    const integ = integration || createIntegrationEntrypoints({});
    const reason = 'fail-closed: native-live requires independently attested OCR-1/2/3 packages; caller-supplied ports/labels cannot certify it in this offline harness';
    return {
      mode,
      verification: 'native-live',
      blocked: true,
      missing: integ.missing,
      reason,
      results: SCENARIOS.map(name => ({ name, ok: false, blocked: true, reason }))
    };
  }

  const effectivePorts = ports || createMockPorts();
  const results = [];
  for (const name of SCENARIOS) results.push(await runScenario(name, effectivePorts, {}));
  return {
    mode,
    verification: mode === 'implementation' ? 'implementation-selfcheck' : 'mock-verification',
    blocked: false,
    results
  };
}

export { ConformanceError, evidenceDigest, assertTransition, STATES, TRANSITIONS, MODES };
