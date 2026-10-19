import { isSessionViewModel, SESSION_STATES } from './model.js';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const EVIDENCE_REF_REGEX = /^[a-zA-Z0-9_.\-/]{1,128}$/;
const MAX_ERRORS = 20;
const MAX_EVIDENCE_REFS = 16;

export const STALE_AFTER_MS = 30000;
export const MAX_EVIDENCE_REFS_LIMIT = MAX_EVIDENCE_REFS;

export const RUN_STATES = Object.freeze({
  REQUESTED: 'requested',
  ADMITTED: 'admitted',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  CANCELLED: 'cancelled',
  DISCONNECTED: 'disconnected',
  UNCERTAIN: 'uncertain',
  FAILED: 'failed',
  COMPLETED: 'completed'
});

export const PAGE_LIFECYCLES = Object.freeze({
  REQUESTED: 'requested',
  ADMITTED: 'admitted',
  OBSERVING: 'observing',
  ACTING: 'acting',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  CANCELLED: 'cancelled',
  DISCONNECTED: 'disconnected',
  UNCERTAIN: 'uncertain',
  FAILED: 'failed',
  VERIFIED_COMPLETION: 'verified_completion'
});

export const WORKER_REPORT_OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted'
});

const RUN_KEYS = [
  'taskId', 'runId', 'conversationId', 'workerId', 'workspaceId',
  'sessionId', 'targetId', 'authorityId', 'observationId',
  'state', 'simulation', 'sequence', 'timestamp', 'expiry', 'completion'
];
const IDENTITY_KEYS = [
  'taskId', 'runId', 'conversationId', 'workerId', 'workspaceId',
  'sessionId', 'targetId', 'authorityId', 'observationId'
];
const UPDATE_KEYS = [
  'sequence', 'timestamp', 'kind', 'runState', 'workerReport', 'verification', 'claimedPermissions',
  ...IDENTITY_KEYS
];
const PERMISSION_KEYS = ['observe', 'control', 'requestControl', 'stop', 'escape'];
const UPDATE_KINDS = ['run_status', 'worker_report', 'verification'];
const TERMINAL_LIFECYCLES = [
  PAGE_LIFECYCLES.STOPPED,
  PAGE_LIFECYCLES.CANCELLED,
  PAGE_LIFECYCLES.FAILED,
  PAGE_LIFECYCLES.VERIFIED_COMPLETION
];
const RUN_INACTIVE = [
  RUN_STATES.STOPPED,
  RUN_STATES.CANCELLED,
  RUN_STATES.FAILED,
  RUN_STATES.COMPLETED
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEpochMs(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isId(value) {
  return typeof value === 'string' && ID_REGEX.test(value);
}

function push(errors, message) {
  if (errors.length < MAX_ERRORS) {
    errors.push(message);
  }
}

function validateEvidenceRefs(refs, errors, label) {
  if (!Array.isArray(refs)) {
    push(errors, `${label} must be an array`);
    return null;
  }
  if (refs.length > MAX_EVIDENCE_REFS) {
    push(errors, `${label} must have at most ${MAX_EVIDENCE_REFS} entries`);
    return null;
  }
  const clean = [];
  for (let i = 0; i < refs.length; i++) {
    if (typeof refs[i] !== 'string' || !EVIDENCE_REF_REGEX.test(refs[i])) {
      push(errors, `${label}[${i}] must be a bounded reference string`);
      return null;
    }
    clean.push(refs[i]);
  }
  return clean;
}

function validateRun(run, errors) {
  if (!isPlainObject(run)) {
    push(errors, 'run must be a plain object');
    return;
  }
  for (const key of Object.keys(run)) {
    if (!RUN_KEYS.includes(key)) {
      push(errors, `run: unknown field '${key}' is not allowed`);
    }
  }
  for (const idKey of IDENTITY_KEYS) {
    if (!isId(run[idKey])) {
      push(errors, `run.${idKey} must be a string matching ^[a-zA-Z0-9_-]{1,64}$`);
    }
  }
  if (typeof run.state !== 'string' || !Object.values(RUN_STATES).includes(run.state)) {
    push(errors, `run.state must be one of: ${Object.values(RUN_STATES).join(', ')}`);
  }
  if (typeof run.simulation !== 'boolean') {
    push(errors, 'run.simulation must be a boolean');
  }
  if (!Number.isSafeInteger(run.sequence) || run.sequence < 0) {
    push(errors, 'run.sequence must be a non-negative safe integer');
  }
  if (!isEpochMs(run.timestamp)) {
    push(errors, 'run.timestamp must be a positive finite epoch ms integer');
  }
  if (!isEpochMs(run.expiry)) {
    push(errors, 'run.expiry must be a positive finite epoch ms integer');
  }
  if (run.completion !== undefined) {
    if (!isPlainObject(run.completion)) {
      push(errors, 'run.completion must be an object');
    } else {
      for (const key of Object.keys(run.completion)) {
        if (!['kind', 'evidenceRefs'].includes(key)) {
          push(errors, `run.completion: unknown field '${key}' is not allowed`);
        }
      }
      if (run.completion.kind === 'verified') {
        const refs = validateEvidenceRefs(run.completion.evidenceRefs, errors, 'run.completion.evidenceRefs');
        if (Array.isArray(refs) && refs.length === 0) {
          push(errors, 'run.completion.verified requires at least one evidenceRef');
        }
      } else if (run.completion.kind === 'worker_reported') {
        if (run.completion.evidenceRefs !== undefined) {
          push(errors, 'evidenceRefs are only accepted on verified completion (worker self-reports carry no evidence)');
        }
      } else {
        push(errors, "run.completion.kind must be 'verified' or 'worker_reported'");
      }
    }
  }
}

function validateUpdate(update, run, now, errors) {
  if (update === undefined) {
    return { claimedPermissions: null };
  }
  if (!isPlainObject(update)) {
    push(errors, 'update must be a plain object');
    return { claimedPermissions: null };
  }
  for (const key of Object.keys(update)) {
    if (!UPDATE_KEYS.includes(key)) {
      push(errors, `update: unknown field '${key}' is not allowed`);
    }
  }
  for (const idKey of IDENTITY_KEYS) {
    const value = update[idKey];
    if (value === undefined) {
      push(errors, `update.${idKey} is required (every update must carry the bound identity)`);
    } else if (typeof value !== 'string' || !ID_REGEX.test(value)) {
      push(errors, `update.${idKey} must be a string matching ^[a-zA-Z0-9_-]{1,64}$`);
    } else if (isPlainObject(run) && isId(run[idKey]) && value !== run[idKey]) {
      push(errors, `update.${idKey} '${value}' does not match run.${idKey} '${run[idKey]}'`);
    }
  }
  if (!Number.isSafeInteger(update.sequence) || update.sequence < 0) {
    push(errors, 'update.sequence must be a non-negative safe integer');
  } else if (isPlainObject(run) && Number.isSafeInteger(run.sequence) && update.sequence <= run.sequence) {
    push(errors, `update.sequence ${update.sequence} must be greater than run.sequence ${run.sequence}`);
  }
  if (!isEpochMs(update.timestamp)) {
    push(errors, 'update.timestamp must be a positive finite epoch ms integer');
  } else {
    if (isPlainObject(run) && isEpochMs(run.timestamp) && update.timestamp < run.timestamp) {
      push(errors, `update.timestamp ${update.timestamp} is stale (older than run.timestamp ${run.timestamp})`);
    }
    if (update.timestamp > now) {
      push(errors, `update.timestamp ${update.timestamp} is beyond now ${now} (future updates are rejected)`);
    }
    if (isPlainObject(run) && isEpochMs(run.expiry) && update.timestamp >= run.expiry) {
      push(errors, `update.timestamp ${update.timestamp} is at or after run expiry ${run.expiry}`);
    }
  }
  if (typeof update.kind !== 'string' || !UPDATE_KINDS.includes(update.kind)) {
    push(errors, `update.kind must be one of: ${UPDATE_KINDS.join(', ')}`);
  } else if (update.kind === 'run_status') {
    if (typeof update.runState !== 'string' || !Object.values(RUN_STATES).includes(update.runState)) {
      push(errors, `update.runState must be one of: ${Object.values(RUN_STATES).join(', ')}`);
    }
    if (update.workerReport !== undefined || update.verification !== undefined) {
      push(errors, 'run_status updates must not carry workerReport or verification');
    }
  } else if (update.kind === 'worker_report') {
    if (!isPlainObject(update.workerReport)) {
      push(errors, 'update.workerReport must be an object');
    } else {
      for (const key of Object.keys(update.workerReport)) {
        if (key !== 'outcome') {
          push(errors, `update.workerReport: unknown field '${key}' is not allowed`);
        }
      }
      if (
        typeof update.workerReport.outcome !== 'string' ||
        !Object.values(WORKER_REPORT_OUTCOMES).includes(update.workerReport.outcome)
      ) {
        push(errors, `update.workerReport.outcome must be one of: ${Object.values(WORKER_REPORT_OUTCOMES).join(', ')}`);
      }
    }
    if (update.runState !== undefined || update.verification !== undefined) {
      push(errors, 'worker_report updates must not carry runState or verification');
    }
  } else if (update.kind === 'verification') {
    if (!isPlainObject(update.verification)) {
      push(errors, 'update.verification must be an object');
    } else {
      for (const key of Object.keys(update.verification)) {
        if (!['verified', 'evidenceRefs'].includes(key)) {
          push(errors, `update.verification: unknown field '${key}' is not allowed`);
        }
      }
      if (typeof update.verification.verified !== 'boolean') {
        push(errors, 'update.verification.verified must be a boolean');
      } else if (update.verification.verified === true) {
        const refs = validateEvidenceRefs(update.verification.evidenceRefs, errors, 'update.verification.evidenceRefs');
        if (Array.isArray(refs) && refs.length === 0) {
          push(errors, 'verification.verified true requires at least one evidenceRef');
        }
      } else if (update.verification.evidenceRefs !== undefined) {
        validateEvidenceRefs(update.verification.evidenceRefs, errors, 'update.verification.evidenceRefs');
      }
    }
    if (update.runState !== undefined || update.workerReport !== undefined) {
      push(errors, 'verification updates must not carry runState or workerReport');
    }
  }
  let claimedPermissions = null;
  if (update.claimedPermissions !== undefined) {
    if (!isPlainObject(update.claimedPermissions)) {
      push(errors, 'update.claimedPermissions must be an object');
    } else {
      for (const key of Object.keys(update.claimedPermissions)) {
        if (!PERMISSION_KEYS.includes(key)) {
          push(errors, `update.claimedPermissions: unknown field '${key}' is not allowed`);
        } else if (typeof update.claimedPermissions[key] !== 'boolean') {
          push(errors, `update.claimedPermissions.${key} must be a boolean`);
        }
      }
      claimedPermissions = update.claimedPermissions;
    }
  }
  return { claimedPermissions };
}

function subtextFor(lifecycle, context) {
  const { simulation, session, expired, selfReported } = context;
  switch (lifecycle) {
    case PAGE_LIFECYCLES.REQUESTED:
      return session.status === SESSION_STATES.REQUESTING_CONTROL
        ? 'Control requested; awaiting authority'
        : simulation
          ? 'Worker requested a session (simulated)'
          : 'Worker requested a session';
    case PAGE_LIFECYCLES.ADMITTED:
      return simulation ? 'Run admitted (simulated); observation not started' : 'Run admitted; observation not started';
    case PAGE_LIFECYCLES.OBSERVING:
      return simulation ? 'Observing target (simulated run)' : 'Observing target';
    case PAGE_LIFECYCLES.ACTING:
      return simulation
        ? 'Control active (simulated only)'
        : 'Control active (contract view; no native access claimed)';
    case PAGE_LIFECYCLES.PAUSED:
      return 'Paused';
    case PAGE_LIFECYCLES.STOPPED:
      return 'Stopped';
    case PAGE_LIFECYCLES.CANCELLED:
      return 'Cancelled';
    case PAGE_LIFECYCLES.DISCONNECTED:
      return 'Disconnected; access cleared';
    case PAGE_LIFECYCLES.UNCERTAIN:
      return expired
        ? 'Session expired; state uncertain'
        : selfReported
          ? 'Worker reported completion; not independently verified'
          : 'State uncertain';
    case PAGE_LIFECYCLES.FAILED:
      return 'Failed';
    case PAGE_LIFECYCLES.VERIFIED_COMPLETION:
      return 'Completed (verified)';
    default:
      return 'State uncertain';
  }
}

export function projectComputerPage(input = {}, options = {}) {
  const errors = [];
  const fail = () => Object.freeze({ ok: false, errors: Object.freeze([...errors]) });

  if (!isPlainObject(options)) {
    push(errors, 'options must be a plain object');
    return fail();
  }
  const now = options.now;
  for (const key of Object.keys(options)) {
    if (key !== 'now') {
      push(errors, `options: unknown option '${key}' is not allowed`);
    }
  }
  if (!isEpochMs(now)) {
    push(errors, 'options.now must be a positive finite epoch ms integer');
  }

  if (!isPlainObject(input)) {
    push(errors, 'input must be a plain object');
    return fail();
  }
  const { run, session, update } = input;
  for (const key of Object.keys(input)) {
    if (!['run', 'session', 'update'].includes(key)) {
      push(errors, `input: unknown field '${key}' is not allowed`);
    }
  }

  validateRun(run, errors);
  if (!isSessionViewModel(session)) {
    push(errors, 'session must be a valid computer session view model');
  }
  const { claimedPermissions } = validateUpdate(update, run, now, errors);

  if (errors.length > 0) {
    return fail();
  }

  if (run.sessionId !== session.sessionId) {
    push(errors, `sessionId mismatch: run '${run.sessionId}' vs session '${session.sessionId}'`);
  }
  if (run.targetId !== session.targetId) {
    push(errors, `targetId mismatch: run '${run.targetId}' vs session '${session.targetId}'`);
  }
  if (run.timestamp > now) {
    push(errors, `run.timestamp ${run.timestamp} is beyond now ${now} (future runs are rejected)`);
  }
  if (errors.length > 0) {
    return fail();
  }

  const expired = now >= run.expiry || session.status === SESSION_STATES.EXPIRED;
  const baseTerminal =
    run.state === RUN_STATES.STOPPED ||
    run.state === RUN_STATES.CANCELLED ||
    run.state === RUN_STATES.FAILED ||
    run.state === RUN_STATES.DISCONNECTED ||
    session.status === SESSION_STATES.STOPPED ||
    session.status === SESSION_STATES.DISCONNECTED;
  const canVerify = !expired && !baseTerminal;

  let effectiveState = run.state;
  let verified = false;
  let evidenceRefs = [];
  let selfReported = false;

  if (run.completion !== undefined) {
    if (run.completion.kind === 'verified') {
      if (canVerify) {
        verified = true;
        evidenceRefs = run.completion.evidenceRefs;
        effectiveState = RUN_STATES.COMPLETED;
      }
    } else {
      selfReported = true;
      effectiveState = RUN_STATES.UNCERTAIN;
    }
  }
  if (update !== undefined && update !== null) {
    if (update.kind === 'run_status') {
      effectiveState = update.runState;
    } else if (update.kind === 'worker_report') {
      selfReported = true;
      effectiveState =
        update.workerReport.outcome === WORKER_REPORT_OUTCOMES.COMPLETED
          ? RUN_STATES.UNCERTAIN
          : RUN_STATES.FAILED;
    } else if (update.kind === 'verification') {
      if (update.verification.verified === true) {
        if (canVerify) {
          verified = true;
          evidenceRefs = update.verification.evidenceRefs;
          effectiveState = RUN_STATES.COMPLETED;
        } else {
          verified = false;
          evidenceRefs = [];
        }
      } else {
        verified = false;
        evidenceRefs = [];
        effectiveState = RUN_STATES.FAILED;
      }
    }
  }

  const effectiveTerminal =
    effectiveState === RUN_STATES.STOPPED ||
    effectiveState === RUN_STATES.CANCELLED ||
    effectiveState === RUN_STATES.FAILED ||
    effectiveState === RUN_STATES.DISCONNECTED;
  if (verified && (expired || baseTerminal || effectiveTerminal)) {
    verified = false;
    evidenceRefs = [];
  }

  let lifecycle;
  if (expired) {
    lifecycle = PAGE_LIFECYCLES.UNCERTAIN;
  } else if (verified) {
    lifecycle = PAGE_LIFECYCLES.VERIFIED_COMPLETION;
  } else if (effectiveState === RUN_STATES.FAILED) {
    lifecycle = PAGE_LIFECYCLES.FAILED;
  } else if (session.status === SESSION_STATES.STOPPED || effectiveState === RUN_STATES.STOPPED) {
    lifecycle = PAGE_LIFECYCLES.STOPPED;
  } else if (effectiveState === RUN_STATES.CANCELLED) {
    lifecycle = PAGE_LIFECYCLES.CANCELLED;
  } else if (session.status === SESSION_STATES.DISCONNECTED || effectiveState === RUN_STATES.DISCONNECTED) {
    lifecycle = PAGE_LIFECYCLES.DISCONNECTED;
  } else if (effectiveState === RUN_STATES.UNCERTAIN || selfReported) {
    lifecycle = PAGE_LIFECYCLES.UNCERTAIN;
  } else if (effectiveState === RUN_STATES.PAUSED || session.status === SESSION_STATES.PAUSED) {
    lifecycle = PAGE_LIFECYCLES.PAUSED;
  } else if (effectiveState === RUN_STATES.REQUESTED) {
    lifecycle = PAGE_LIFECYCLES.REQUESTED;
  } else if (effectiveState === RUN_STATES.ADMITTED) {
    lifecycle = PAGE_LIFECYCLES.ADMITTED;
  } else if (effectiveState === RUN_STATES.RUNNING) {
    if (session.status === SESSION_STATES.ACTING) {
      lifecycle = PAGE_LIFECYCLES.ACTING;
    } else if (session.status === SESSION_STATES.OBSERVING) {
      lifecycle = PAGE_LIFECYCLES.OBSERVING;
    } else if (session.status === SESSION_STATES.REQUESTING_CONTROL) {
      lifecycle = PAGE_LIFECYCLES.REQUESTED;
    } else {
      lifecycle = PAGE_LIFECYCLES.ADMITTED;
    }
  } else {
    lifecycle = PAGE_LIFECYCLES.UNCERTAIN;
  }

  const runActive = !RUN_INACTIVE.includes(effectiveState) && !expired;
  const permissions = Object.freeze({
    observe: runActive && [SESSION_STATES.OBSERVING, SESSION_STATES.ACTING, SESSION_STATES.PAUSED].includes(session.status),
    control: runActive && session.status === SESSION_STATES.ACTING,
    requestControl:
      runActive && session.observationOnly === false && session.status === SESSION_STATES.OBSERVING,
    stop: runActive,
    escape: true
  });

  if (claimedPermissions !== null) {
    for (const key of PERMISSION_KEYS) {
      if (claimedPermissions[key] === true && permissions[key] !== true) {
        push(
          errors,
          `update.claimedPermissions.${key} exceeds derived permissions (authority-growing updates are rejected)`
        );
      }
    }
  }
  if (errors.length > 0) {
    return fail();
  }

  const ageMs = now - run.timestamp;
  const freshness = Object.freeze({
    status: expired ? 'expired' : ageMs < 0 ? 'future' : ageMs > STALE_AFTER_MS ? 'stale' : 'fresh',
    ageMs,
    asOf: now
  });

  const terminal = TERMINAL_LIFECYCLES.includes(lifecycle);
  const stopAvailable = runActive && !terminal;
  const page = Object.freeze({
    lifecycle,
    simulation: run.simulation,
    subtext: subtextFor(lifecycle, { simulation: run.simulation, session, expired, selfReported }),
    permissions,
    freshness,
    stopAvailable,
    escapeAvailable: true,
    evidenceRefs: Object.freeze(verified ? [...evidenceRefs] : []),
    identity: Object.freeze({
      taskId: run.taskId,
      runId: run.runId,
      conversationId: run.conversationId,
      workerId: run.workerId,
      workspaceId: run.workspaceId,
      sessionId: run.sessionId,
      targetId: run.targetId,
      authorityId: run.authorityId,
      observationId: run.observationId
    })
  });

  return Object.freeze({ ok: true, page });
}
