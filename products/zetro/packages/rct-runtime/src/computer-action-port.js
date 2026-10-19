import { createHash } from 'node:crypto';

export const COMPUTER_ACTION_SCHEMA_VERSION = 'zetro.computer.action_request.v1';
export const COMPUTER_RECEIPT_SCHEMA_VERSION = 'zetro.computer.action_receipt.v1';

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/**
 * Validates a target window / display descriptor.
 * @param {any} target
 * @returns {Readonly<{ targetId: string, processId: number, windowHandle: string|number, title?: string, displayId?: string|number }>}
 */
export function validateComputerTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('Target must be a non-null object');
  }
  const { targetId, processId, windowHandle, title, displayId, processStartedAt, generation } = target;
  if (typeof targetId !== 'string' || !ID_REGEX.test(targetId)) {
    throw new Error('target.targetId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw new Error('target.processId must be a positive safe integer');
  }
  if (typeof windowHandle !== 'string' && typeof windowHandle !== 'number') {
    throw new Error('target.windowHandle must be a string or number');
  }
  if (typeof windowHandle === 'string' && windowHandle.trim().length === 0) {
    throw new Error('target.windowHandle string must not be empty');
  }
  if (typeof windowHandle === 'number' && (!Number.isSafeInteger(windowHandle) || windowHandle < 0)) {
    throw new Error('target.windowHandle number must be a non-negative integer');
  }
  if (processStartedAt !== undefined) {
    if (typeof processStartedAt !== 'number' || !Number.isFinite(processStartedAt) || processStartedAt <= 0) {
      throw new Error('target.processStartedAt must be a positive number');
    }
  }
  if (generation !== undefined) {
    if ((typeof generation !== 'string' && typeof generation !== 'number') || String(generation).trim().length === 0) {
      throw new Error('target.generation must be a non-empty string or number');
    }
  }
  return Object.freeze({
    targetId,
    processId,
    windowHandle,
    ...(typeof title === 'string' ? { title } : {}),
    ...(displayId !== undefined ? { displayId } : {}),
    ...(processStartedAt !== undefined ? { processStartedAt } : {}),
    ...(generation !== undefined ? { generation: String(generation) } : {})
  });
}

/**
 * Validates an action request.
 * @param {any} request
 * @returns {Readonly<Object>}
 */
export function validateComputerActionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Action request must be a non-null object');
  }
  const {
    schemaVersion = COMPUTER_ACTION_SCHEMA_VERSION,
    actionId,
    actionType,
    target,
    parameters = {},
    sessionId,
    taskId,
    attemptId,
    createdAt = Date.now()
  } = request;

  if (schemaVersion !== COMPUTER_ACTION_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: expected '${COMPUTER_ACTION_SCHEMA_VERSION}', got '${schemaVersion}'`);
  }
  if (typeof actionId !== 'string' || !ID_REGEX.test(actionId)) {
    throw new Error('actionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof actionType !== 'string' || actionType.trim().length === 0) {
    throw new Error('actionType must be a non-empty string');
  }
  const validatedTarget = validateComputerTarget(target);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('parameters must be a non-null object');
  }
  if (typeof sessionId !== 'string' || !ID_REGEX.test(sessionId)) {
    throw new Error('sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof taskId !== 'string' || !ID_REGEX.test(taskId)) {
    throw new Error('taskId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof attemptId === 'number') {
    if (!Number.isSafeInteger(attemptId) || attemptId < 1) {
      throw new Error('attemptId (numeric) must be a positive safe integer');
    }
  } else if (typeof attemptId === 'string') {
    if (!ID_REGEX.test(attemptId)) {
      throw new Error('attemptId (string) must match ^[a-zA-Z0-9_-]{1,64}$');
    }
  } else {
    throw new Error('attemptId is required and must be a positive integer or identifier string');
  }

  return Object.freeze({
    schemaVersion,
    actionId,
    actionType,
    target: validatedTarget,
    parameters: Object.freeze({ ...parameters }),
    sessionId,
    taskId,
    attemptId,
    createdAt: typeof createdAt === 'number' && createdAt > 0 ? createdAt : Date.now()
  });
}

/**
 * Validates a session object binding taskId, attemptId, target, status, and expiry.
 * @param {any} session
 * @returns {Readonly<Object>}
 */
export function validateComputerSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error('Session must be a non-null object');
  }
  const { sessionId, taskId, attemptId, status = 'active', expiresAt, principal = 'worker', target } = session;

  if (typeof sessionId !== 'string' || !ID_REGEX.test(sessionId)) {
    throw new Error('session.sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof taskId !== 'string' || !ID_REGEX.test(taskId)) {
    throw new Error('session.taskId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (typeof attemptId !== 'number' && typeof attemptId !== 'string') {
    throw new Error('session.attemptId must be a number or string');
  }
  if (!['active', 'paused', 'stopped', 'expired'].includes(status)) {
    throw new Error(`Invalid session status: '${status}'`);
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('session.expiresAt must be a positive epoch ms number');
  }

  return Object.freeze({
    sessionId,
    taskId,
    attemptId,
    status,
    expiresAt,
    principal,
    target: target ? validateComputerTarget(target) : null
  });
}

/**
 * Execute an action through injected Computer action-execution ports.
 * Never performs direct OS/Win32 calls. All native capability execution is mediated
 * through injected, bounded executor, observer, authority, and verifier ports.
 *
 * Invariants enforced:
 * 1. nativeInputEnabled must be literal `true` in options; default is `false`. (Deny 0 executor calls)
 * 2. Pre-check cancellation, session status, expiry, and attempt/task binding. (Deny 0 executor calls)
 * 3. Authority evaluation immediately before observation. (Deny 0 executor calls)
 * 4. Fresh pre-effect target observation required; exact target identity rechecked. (Deny 0 executor calls)
 * 5. Immediate pre-effect recheck of cancellation, expiry, revocation right before executor call. (Deny 0 executor calls)
 * 6. Bounded executor execution with timeout.
 * 7. NO RETRY ON UNCERTAIN INPUT: if executor reports uncertain or fails ambiguously, fail closed immediately.
 * 8. Independent post-effect observation.
 * 9. Mark verified ONLY if trusted injected verifier certifies verified: true.
 *
 * @param {Object} params
 * @param {Object} params.actionRequest - Validated action request
 * @param {Object} params.session - Validated session state
 * @param {Object} params.authorityPort - Injected authority / policy port
 * @param {Object} params.observer - Injected target observer port
 * @param {Object} params.executor - Injected native executor port
 * @param {Object} [params.verifier] - Injected trusted verifier port
 * @param {Object} [params.options] - Execution options
 * @param {boolean} [params.options.nativeInputEnabled=false] - Must be literal true
 * @param {number} [params.options.timeoutMs=5000] - Bounded executor timeout
 * @param {number} [params.options.maxObservationAgeMs=5000] - Observation freshness bound
 * @param {AbortSignal} [params.options.signal] - Cancellation signal
 * @returns {Promise<Object>} Immutable execution receipt
 */
export async function executeComputerAction({
  actionRequest: rawRequest,
  session: rawSession,
  authorityPort,
  observer,
  executor,
  verifier = null,
  options = {}
} = {}) {
  let executorCalls = 0;

  // 1. Explicit nativeInputEnabled gate: default false, literal true required
  if (options.nativeInputEnabled !== true) {
    const err = new Error('Native input disabled: options.nativeInputEnabled must be literal true to execute computer action');
    err.name = 'NativeInputDisabledError';
    err.executorCalls = 0;
    throw err;
  }

  const signal = options.signal;
  if (signal?.aborted) {
    const err = new Error('Computer action aborted before execution');
    err.name = 'AbortError';
    err.executorCalls = 0;
    throw err;
  }

  // 2. Validate request and session
  const actionRequest = validateComputerActionRequest(rawRequest);
  const session = validateComputerSession(rawSession);

  // Bind exact session, task, attempt
  if (actionRequest.sessionId !== session.sessionId) {
    const err = new Error(`Session mismatch: actionRequest.sessionId '${actionRequest.sessionId}' does not match session '${session.sessionId}'`);
    err.name = 'SessionMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (actionRequest.taskId !== session.taskId) {
    const err = new Error(`Task mismatch: actionRequest.taskId '${actionRequest.taskId}' does not match session '${session.taskId}'`);
    err.name = 'TaskMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (actionRequest.attemptId !== session.attemptId) {
    const err = new Error(`Attempt mismatch (stale attempt rejection): actionRequest.attemptId '${actionRequest.attemptId}' does not match session attempt '${session.attemptId}'`);
    err.name = 'AttemptMismatchError';
    err.executorCalls = 0;
    throw err;
  }

  // Session state checks
  if (session.status !== 'active') {
    const err = new Error(`Session is not active: status is '${session.status}'`);
    err.name = 'InactiveSessionError';
    err.executorCalls = 0;
    throw err;
  }
  if (Date.now() >= session.expiresAt) {
    const err = new Error('Session has expired');
    err.name = 'SessionExpiredError';
    err.executorCalls = 0;
    throw err;
  }

  // Session target boundary check (if session is bound to a specific target)
  if (session.target) {
    if (session.target.targetId !== actionRequest.target.targetId ||
        session.target.processId !== actionRequest.target.processId ||
        session.target.windowHandle !== actionRequest.target.windowHandle ||
        (session.target.processStartedAt !== undefined && actionRequest.target.processStartedAt !== undefined && session.target.processStartedAt !== actionRequest.target.processStartedAt) ||
        (session.target.generation !== undefined && actionRequest.target.generation !== undefined && String(session.target.generation) !== String(actionRequest.target.generation))) {
      const err = new Error('Target outside authorized session scope: target identity does not match session target');
      err.name = 'TargetScopeViolationError';
      err.executorCalls = 0;
      throw err;
    }
  }

  // 3. Authority evaluation
  if (!authorityPort || typeof authorityPort.evaluateAction !== 'function') {
    const err = new Error('Missing authorityPort: authorityPort.evaluateAction must be implemented');
    err.name = 'MissingAuthorityPortError';
    err.executorCalls = 0;
    throw err;
  }

  const authorityResult = await authorityPort.evaluateAction({
    actionRequest,
    session,
    target: actionRequest.target
  });

  if (!authorityResult || authorityResult.granted !== true) {
    const reason = authorityResult?.reason || 'Authority evaluation denied action';
    const err = new Error(`Authority denial: ${reason}`);
    err.name = 'AuthorityDenialError';
    err.details = authorityResult;
    err.executorCalls = 0;
    throw err;
  }

  if (signal?.aborted) {
    const err = new Error('Computer action aborted after authority evaluation');
    err.name = 'AbortError';
    err.executorCalls = 0;
    throw err;
  }

  // 4. Pre-effect Target Observation & Exact Identity Verification
  if (!observer || typeof observer.observeTarget !== 'function') {
    const err = new Error('Missing observer: observer.observeTarget must be implemented');
    err.name = 'MissingObserverError';
    err.executorCalls = 0;
    throw err;
  }

  const preObservation = await observer.observeTarget(actionRequest.target, { signal });
  if (!preObservation || typeof preObservation !== 'object') {
    const err = new Error('Target observation failed: observer returned null or invalid observation');
    err.name = 'TargetObservationError';
    err.executorCalls = 0;
    throw err;
  }

  // Verify observation freshness
  const now = Date.now();
  const maxObservationAgeMs = options.maxObservationAgeMs || 5000;
  if (typeof preObservation.observedAt !== 'number' || now - preObservation.observedAt > maxObservationAgeMs) {
    const err = new Error(`Stale observation rejection: observation age (${now - (preObservation.observedAt || 0)}ms) exceeds ceiling (${maxObservationAgeMs}ms)`);
    err.name = 'StaleObservationError';
    err.executorCalls = 0;
    throw err;
  }

  // Exact target identity verification
  if (preObservation.targetId !== actionRequest.target.targetId) {
    const err = new Error(`Target identity mismatch: observed targetId '${preObservation.targetId}' does not match requested '${actionRequest.target.targetId}'`);
    err.name = 'TargetIdentityMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (preObservation.processId !== actionRequest.target.processId) {
    const err = new Error(`Target identity mismatch: observed processId '${preObservation.processId}' does not match requested '${actionRequest.target.processId}'`);
    err.name = 'TargetIdentityMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (preObservation.windowHandle !== actionRequest.target.windowHandle) {
    const err = new Error(`Target identity mismatch: observed windowHandle '${preObservation.windowHandle}' does not match requested '${actionRequest.target.windowHandle}'`);
    err.name = 'TargetIdentityMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (actionRequest.target.processStartedAt !== undefined &&
      preObservation.processStartedAt !== undefined &&
      preObservation.processStartedAt !== actionRequest.target.processStartedAt) {
    const err = new Error(`Target identity mismatch: observed processStartedAt '${preObservation.processStartedAt}' does not match requested '${actionRequest.target.processStartedAt}' (recycled PID detected)`);
    err.name = 'TargetIdentityMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (actionRequest.target.generation !== undefined &&
      preObservation.generation !== undefined &&
      String(preObservation.generation) !== String(actionRequest.target.generation)) {
    const err = new Error(`Target identity mismatch: observed generation '${preObservation.generation}' does not match requested '${actionRequest.target.generation}'`);
    err.name = 'TargetIdentityMismatchError';
    err.executorCalls = 0;
    throw err;
  }
  if (preObservation.active !== true) {
    const err = new Error('Target window is not active, minimized, or closed');
    err.name = 'InactiveTargetWindowError';
    err.executorCalls = 0;
    throw err;
  }
  if (preObservation.isForeground === false) {
    const err = new Error('Target window is not in foreground (focus changed)');
    err.name = 'ForegroundChangedError';
    err.executorCalls = 0;
    throw err;
  }

  // 5. Immediate Pre-Effect Recheck (Cancellation, Expiry, Revocation, Foreground)
  if (signal?.aborted) {
    const err = new Error('Computer action aborted immediately before effect execution');
    err.name = 'AbortError';
    err.executorCalls = 0;
    throw err;
  }
  if (Date.now() >= session.expiresAt) {
    const err = new Error('Session expired immediately before effect execution');
    err.name = 'SessionExpiredError';
    err.executorCalls = 0;
    throw err;
  }
  if (typeof authorityPort.isRevoked === 'function' && authorityPort.isRevoked(authorityResult.grantId)) {
    const err = new Error('Action grant was revoked immediately before effect execution');
    err.name = 'GrantRevokedError';
    err.executorCalls = 0;
    throw err;
  }
  if (typeof observer.isForeground === 'function' && !observer.isForeground(actionRequest.target)) {
    const err = new Error('Foreground window changed immediately before effect execution');
    err.name = 'ForegroundChangedError';
    err.executorCalls = 0;
    throw err;
  }

  // 6. Bounded Executor Execution
  if (!executor || typeof executor.executeAction !== 'function') {
    const err = new Error('Missing executor: executor.executeAction must be implemented');
    err.name = 'MissingExecutorError';
    err.executorCalls = 0;
    throw err;
  }

  const timeoutMs = options.timeoutMs || 5000;
  executorCalls = 1;

  let executionResult;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const timeoutErr = new Error(`Executor timed out after ${timeoutMs}ms`);
        timeoutErr.name = 'ExecutorTimeoutError';
        reject(timeoutErr);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const abortErr = new Error('Computer action aborted during executor execution');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, { once: true });
      }
    });

    executionResult = await Promise.race([
      executor.executeAction(actionRequest, preObservation, { signal, timeoutMs }),
      timeoutPromise
    ]);
  } catch (execErr) {
    // If executor failed or aborted, record failure and fail closed without retrying
    const receipt = {
      schemaVersion: COMPUTER_RECEIPT_SCHEMA_VERSION,
      actionId: actionRequest.actionId,
      actionType: actionRequest.actionType,
      sessionId: session.sessionId,
      taskId: session.taskId,
      attemptId: session.attemptId,
      status: execErr.name === 'AbortError' ? 'aborted' : (execErr.name === 'ExecutorTimeoutError' ? 'timeout' : 'failed'),
      target: actionRequest.target,
      preObservation,
      postObservation: null,
      executionResult: { ok: false, error: execErr.message },
      uncertain: execErr.name === 'ExecutorTimeoutError',
      verified: false,
      failureReason: execErr.message,
      executorCalls: 1,
      evidenceHash: null
    };
    receipt.evidenceHash = sha256(receipt);
    return Object.freeze(receipt);
  }

  // 7. No Retry on Uncertain Input
  if (!executionResult || executionResult.uncertain === true) {
    const receipt = {
      schemaVersion: COMPUTER_RECEIPT_SCHEMA_VERSION,
      actionId: actionRequest.actionId,
      actionType: actionRequest.actionType,
      sessionId: session.sessionId,
      taskId: session.taskId,
      attemptId: session.attemptId,
      status: 'uncertain',
      target: actionRequest.target,
      preObservation,
      postObservation: null,
      executionResult: executionResult || { ok: false, uncertain: true },
      uncertain: true,
      verified: false,
      failureReason: 'Uncertain input execution state: effect could not be confirmed without ambiguity; no retry allowed on uncertain input',
      executorCalls: 1,
      evidenceHash: null
    };
    receipt.evidenceHash = sha256(receipt);
    return Object.freeze(receipt);
  }

  // 8. Independent Post-Effect Observation
  let postObservation = null;
  try {
    postObservation = await observer.observeTarget(actionRequest.target, { signal });
  } catch (postObsErr) {
    postObservation = { error: postObsErr.message, observedAt: Date.now() };
  }

  // 9. Independent Trusted Verification
  let verification = { verified: false, reason: 'No trusted verifier supplied' };
  let verified = false;

  if (verifier && typeof verifier.verifyEffect === 'function') {
    if (!postObservation || postObservation.error) {
      verification = {
        verified: false,
        reason: `Post-observation missing or errored: ${postObservation?.error || 'null observation'}`
      };
      verified = false;
    } else {
      try {
        const vResult = await verifier.verifyEffect({
          actionRequest,
          preObservation,
          postObservation,
          executionResult
        });
        if (vResult && typeof vResult === 'object') {
          verified = vResult.verified === true;
          verification = {
            verified,
            reason: vResult.reason || (verified ? 'Verified by trusted verifier' : 'Verification failed'),
            ...(vResult.checks ? { checks: vResult.checks } : {}),
            ...(vResult.evidenceHash ? { verifierEvidenceHash: vResult.evidenceHash } : {})
          };
        }
      } catch (vErr) {
        verification = { verified: false, reason: `Verifier error: ${vErr.message}` };
        verified = false;
      }
    }
  }

  const status = !executionResult.ok ? 'failed' : (verified ? 'completed' : 'unverified_effect');

  const receipt = {
    schemaVersion: COMPUTER_RECEIPT_SCHEMA_VERSION,
    actionId: actionRequest.actionId,
    actionType: actionRequest.actionType,
    sessionId: session.sessionId,
    taskId: session.taskId,
    attemptId: session.attemptId,
    status,
    target: actionRequest.target,
    preObservation,
    postObservation,
    executionResult,
    uncertain: false,
    verified,
    verification,
    executorCalls: 1,
    evidenceHash: null
  };
  receipt.evidenceHash = sha256(receipt);

  return Object.freeze(receipt);
}

/**
 * Port class wrapping action execution with bound defaults and session.
 */
export class ComputerActionPort {
  /**
   * @param {Object} [params]
   * @param {Object} [params.session] - Bound session
   * @param {Object} [params.authorityPort] - Injected authority port
   * @param {Object} [params.observer] - Injected observer port
   * @param {Object} [params.executor] - Injected executor port
   * @param {Object} [params.verifier] - Injected verifier port
   * @param {Object} [params.defaultOptions] - Default execution options
   */
  constructor({
    session = null,
    authorityPort = null,
    observer = null,
    executor = null,
    verifier = null,
    defaultOptions = {}
  } = {}) {
    this.session = session;
    this.authorityPort = authorityPort;
    this.observer = observer;
    this.executor = executor;
    this.verifier = verifier;
    this.defaultOptions = defaultOptions;
  }

  async execute(actionRequest, callOptions = {}) {
    return executeComputerAction({
      actionRequest,
      session: callOptions.session || this.session,
      authorityPort: callOptions.authorityPort || this.authorityPort,
      observer: callOptions.observer || this.observer,
      executor: callOptions.executor || this.executor,
      verifier: callOptions.verifier || this.verifier,
      options: { ...this.defaultOptions, ...callOptions }
    });
  }
}
