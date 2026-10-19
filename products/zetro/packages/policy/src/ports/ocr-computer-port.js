/**
 * @file ports/ocr-computer-port.js
 * Injected Authority Port Adapter for OCR & ComputerSession runtimes (Wave 5 AGR-1).
 * Bridges @zetro/policy and @zetro/protocol with ComputerSession in packages/computer-runtime.
 *
 * Enforces:
 * - Literal boolean `allowed === true` (fail-closed; non-boolean values fail closed).
 * - Exact identity confinement: principalId, sessionId, taskId, attemptId, canonicalRoot.
 * - WorkspaceAdmission (zetro.protocol.workspace_admission.v1) binding.
 * - Target display / window boundary checking (target_outside_grant_scope).
 * - Atomic one-use consumption semantics (authorizeAndConsume) and effect-time rechecking.
 * - Deterministic, offline-only authority evaluation with zero native or provider calls.
 *
 * NOTE: OcrComputerAuthorityAdapter enforces policy at the application/API layer.
 * It does NOT claim or provide OS-level hardware/kernel sandboxing.
 */

import {
  createActionRequest,
  ActionType,
  SCHEMA_VERSIONS,
  validateWorkspaceAdmission,
  validateComputerActionRequest,
  ComputerOperation,
  UNQUALIFIED_INPUT_OPERATIONS
} from '../../../protocol/src/index.js';
import { PolicyDeniedError } from '../errors.js';

export class OcrComputerAuthorityAdapter {
  /**
   * @param {import('../policy-service.js').PolicyService} policyService - Shared PolicyService
   * @param {object} [options]
   * @param {object} [options.workspaceAdmission] - Validated or raw WorkspaceAdmission object
   * @param {boolean} [options.requireAdmission=true] - Require valid WorkspaceAdmission for evaluation
   * @param {string} [options.principalId] - Pre-bound authoritative principalId
   * @param {string} [options.sessionId] - Pre-bound authoritative sessionId
   * @param {string|number} [options.targetDisplayId] - Pre-bound target display ID
   * @param {Array<string|number>} [options.allowedDisplays] - Allowed display identifiers
   * @param {Array<string|object>} [options.allowedTargets] - Allowed target/window specifications
   * @param {boolean} [options.consumeByDefault=false] - If true, evaluateScreenCapture consumes approval atomically
   * @param {boolean} [options.oneUseByDefault=false] - If true, one-use grants are revoked upon consumption
   * @param {string} [options.taskId] - Fallback taskId if workspaceAdmission is not provided
   * @param {number|string} [options.attemptId=1] - Fallback attemptId if workspaceAdmission is not provided
   */
  constructor(policyServiceOrOptions, options = {}) {
    let policyService = policyServiceOrOptions;
    let opts = options;
    if (policyServiceOrOptions && typeof policyServiceOrOptions === 'object' && policyServiceOrOptions.policyService) {
      policyService = policyServiceOrOptions.policyService;
      opts = policyServiceOrOptions;
    }

    if (!policyService) {
      throw new Error('OcrComputerAuthorityAdapter requires a PolicyService instance');
    }
    this.policyService = policyService;

    this._workspaceAdmission = null;
    if (opts.workspaceAdmission) {
      this._workspaceAdmission = validateWorkspaceAdmission(opts.workspaceAdmission, {
        throwOnError: true,
        verifyDigest: Boolean(opts.workspaceAdmission.admissionDigest)
      });
    }

    this._requireAdmission = opts.requireAdmission ?? true;
    this._principalId = opts.principalId ?? null;
    this._sessionId = opts.sessionId ?? null;
    this._targetDisplayId = opts.targetDisplayId !== undefined ? opts.targetDisplayId : null;
    this._allowedDisplays = opts.allowedDisplays ? [...opts.allowedDisplays] : null;
    this._allowedTargets = opts.allowedTargets ? [...opts.allowedTargets] : null;
    this._consumeByDefault = Boolean(opts.consumeByDefault ?? opts.consume);
    this._oneUseByDefault = Boolean(opts.oneUseByDefault ?? opts.oneUse);
    this._taskId = opts.taskId ?? this._workspaceAdmission?.taskId ?? null;
    this._attemptId = opts.attemptId ?? this._workspaceAdmission?.attemptId ?? 1;

    // Track consumed grant IDs under this adapter instance for quota/replay detection
    this._consumedGrantIds = new Set();
    this._seq = 1;

    // Map of known target window generations (hwnd -> generation)
    this._knownTargetGenerations = new Map();
  }

  /**
   * Bound WorkspaceAdmission (deeply frozen if validated).
   */
  get workspaceAdmission() {
    return this._workspaceAdmission;
  }

  get requireAdmission() {
    return this._requireAdmission;
  }

  get principalId() {
    return this._principalId;
  }

  get sessionId() {
    return this._sessionId;
  }

  get targetDisplayId() {
    return this._targetDisplayId;
  }

  get allowedDisplays() {
    return this._allowedDisplays ? Object.freeze([...this._allowedDisplays]) : null;
  }

  get consumeByDefault() {
    return this._consumeByDefault;
  }

  get taskId() {
    return this._taskId;
  }

  get attemptId() {
    return this._attemptId;
  }

  /**
   * Binds a validated WorkspaceAdmission contract to this adapter.
   *
   * @param {object} admission
   * @returns {this}
   */
  bindWorkspaceAdmission(admission) {
    if (!admission) {
      throw new Error('WorkspaceAdmission is required to bind');
    }
    this._workspaceAdmission = validateWorkspaceAdmission(admission, {
      throwOnError: true,
      verifyDigest: Boolean(admission.admissionDigest)
    });
    this._taskId = this._workspaceAdmission.taskId;
    this._attemptId = this._workspaceAdmission.attemptId;
    return this;
  }

  /**
   * Binds session identity to this adapter.
   *
   * @param {string} sessionId
   * @param {string} [principalId]
   * @returns {this}
   */
  bindSession(sessionId, principalId = null) {
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('sessionId must be a non-empty string');
    }
    this._sessionId = sessionId;
    if (principalId) {
      this._principalId = principalId;
    }
    return this;
  }

  /**
   * Binds target display scope.
   *
   * @param {string|number} displayId
   * @returns {this}
   */
  bindTargetDisplay(displayId) {
    this._targetDisplayId = displayId;
    return this;
  }

  /**
   * Sets or updates known generation for a target window handle (HWND).
   *
   * @param {number} hwnd
   * @param {string|number} generation
   * @returns {this}
   */
  setTargetGeneration(hwnd, generation) {
    if (typeof hwnd !== 'number' || !Number.isSafeInteger(hwnd) || hwnd <= 0) {
      throw new Error('hwnd must be a positive safe integer');
    }
    this._knownTargetGenerations.set(hwnd, generation);
    return this;
  }

  /**
   * Registers a window target's identity and generation.
   *
   * @param {object} target
   * @param {number} target.hwnd
   * @param {string|number} target.generation
   * @returns {this}
   */
  registerWindowTarget(target) {
    if (!target || typeof target.hwnd !== 'number') {
      throw new Error('target must have an hwnd number');
    }
    if (target.generation !== undefined && target.generation !== null) {
      this._knownTargetGenerations.set(target.hwnd, target.generation);
    }
    return this;
  }

  /**
   * Evaluates screen capture permission for ComputerSession.observe().
   * Conforms strictly to ComputerSession authorityPort interface:
   *   evaluateScreenCapture({ principalId, sessionId, displayId, frames }, options)
   * Returns:
   *   { allowed: boolean, reason?: string, grantId?: string, details?: object, requestDigest?: string }
   * Enforces: literal boolean `allowed === true` on success; any failure or denial returns `allowed: false`.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string|number} [params.displayId=0]
   * @param {number} [params.frames=1]
   * @param {object} [params.bounds]
   * @param {string} [params.taskId]
   * @param {number|string} [params.attemptId]
   * @param {object} [params.workspaceAdmission]
   * @param {object} [options]
   * @param {boolean} [options.consume] - Atomically consume approval
   * @param {boolean} [options.oneUse] - Revoke one-use grant upon consumption
   * @param {string} [options.grantId] - Explicit grant ID to evaluate against
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object, requestDigest?: string }}
   */
  evaluateScreenCapture(params, options = {}) {
    // 1. Strict input validation
    if (!params || typeof params !== 'object') {
      return { allowed: false, reason: 'invalid_request', details: { error: 'params must be a non-null object' } };
    }

    // 2. Workspace admission resolution & enforcement
    let effectiveAdmission = this._workspaceAdmission;
    if (params.workspaceAdmission) {
      try {
        effectiveAdmission = validateWorkspaceAdmission(params.workspaceAdmission, {
          throwOnError: true,
          verifyDigest: Boolean(params.workspaceAdmission.admissionDigest)
        });
      } catch (err) {
        return { allowed: false, reason: 'invalid_workspace_admission', details: { error: err.message } };
      }
    }

    if (this._requireAdmission && !effectiveAdmission) {
      return {
        allowed: false,
        reason: 'missing_workspace_admission',
        details: { message: 'Screen capture evaluation requires an active, validated WorkspaceAdmission' }
      };
    }

    // 3. Principal and session identity verification
    if (this._principalId !== null && params.principalId && params.principalId !== this._principalId) {
      return {
        allowed: false,
        reason: 'principal_mismatch',
        details: { expected: this._principalId, received: params.principalId }
      };
    }

    if (this._sessionId !== null && params.sessionId && params.sessionId !== this._sessionId) {
      return {
        allowed: false,
        reason: 'session_mismatch',
        details: { expected: this._sessionId, received: params.sessionId }
      };
    }

    // 4. Task and attempt identity binding verification against admission
    if (effectiveAdmission) {
      if (params.taskId && params.taskId !== effectiveAdmission.taskId) {
        return {
          allowed: false,
          reason: 'unadmitted_session',
          details: { expected: effectiveAdmission.taskId, received: params.taskId }
        };
      }
      if (params.attemptId && params.attemptId !== effectiveAdmission.attemptId) {
        return {
          allowed: false,
          reason: 'unadmitted_session',
          details: { expected: effectiveAdmission.attemptId, received: params.attemptId }
        };
      }
      if (params.workspaceRoot && params.workspaceRoot !== effectiveAdmission.canonicalRoot) {
        return {
          allowed: false,
          reason: 'workspace_root_mismatch',
          details: { expected: effectiveAdmission.canonicalRoot, received: params.workspaceRoot }
        };
      }
    }

    // 5. Target display / window scoping
    const requestedDisplay = params.displayId !== undefined && params.displayId !== null
      ? params.displayId
      : 0;

    if (this._targetDisplayId !== null && this._targetDisplayId !== undefined) {
      if (String(requestedDisplay) !== String(this._targetDisplayId)) {
        return {
          allowed: false,
          reason: 'target_outside_grant_scope',
          details: { expected: this._targetDisplayId, requested: requestedDisplay }
        };
      }
    }

    if (this._allowedDisplays && this._allowedDisplays.length > 0) {
      const isAllowed = this._allowedDisplays.some(d => String(d) === String(requestedDisplay));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'target_outside_grant_scope',
          details: { allowedDisplays: this._allowedDisplays, requested: requestedDisplay }
        };
      }
    }

    // 6. Build versioned ActionRequest
    const taskId = effectiveAdmission?.taskId ?? params.taskId ?? this._taskId;
    const attemptId = effectiveAdmission?.attemptId ?? params.attemptId ?? this._attemptId ?? 1;

    if (!taskId) {
      return {
        allowed: false,
        reason: 'missing_task_id',
        details: { message: 'taskId could not be resolved from admission or options' }
      };
    }

    let req;
    try {
      req = createActionRequest({
        taskId,
        attemptId,
        principalId: params.principalId,
        sessionId: params.sessionId,
        actionType: ActionType.SCREEN_CAPTURE,
        parameters: {
          displayId: requestedDisplay,
          frames: params.frames ?? 1,
          ...(params.bounds ? { bounds: params.bounds } : {}),
          ...(effectiveAdmission ? { workspaceRoot: effectiveAdmission.canonicalRoot } : {})
        }
      });
    } catch (err) {
      return {
        allowed: false,
        reason: 'invalid_request',
        details: { error: err.message }
      };
    }

    // 7. Atomic consumption or non-consuming evaluation
    const shouldConsume = Boolean(options.consume ?? this._consumeByDefault);
    const shouldOneUse = Boolean(options.oneUse ?? this._oneUseByDefault);
    const evalOptions = {
      ...options,
      oneUse: shouldOneUse,
      ...(options.grantId ? { grantId: options.grantId } : {})
    };

    const res = shouldConsume
      ? this.policyService.authorizeAndConsume(req, evalOptions)
      : this.policyService.evaluate(req, evalOptions);

    // 8. Strict literal boolean allowed sanitization
    // If not granted, check if grant was one_use_consumed to provide clear reason
    if (res.granted !== true) {
      let denialReason = res.reason || 'denied';
      if (res.reason === 'grant_revoked' && res.details?.revocationReason === 'one_use_consumed') {
        denialReason = 'request_already_consumed';
      } else if (res.grantId) {
        const grantRecord = this.policyService.getGrant(res.grantId);
        if (grantRecord?.revoked && grantRecord?.revocationReason === 'one_use_consumed') {
          denialReason = 'request_already_consumed';
        }
      }
      return {
        allowed: false,
        reason: denialReason,
        grantId: res.grantId ?? null,
        details: res.details ?? null
      };
    }

    // Record consumption if authorized
    if (shouldConsume && res.grantId) {
      this._consumedGrantIds.add(res.grantId);
    }

    return {
      allowed: true,
      reason: res.reason || 'authorized',
      grantId: res.grantId ?? null,
      details: res.details ?? null,
      requestDigest: req.requestDigest
    };
  }

  /**
   * Helper to issue an observation grant in PolicyService for an admitted session.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {Array<string|number>} [params.allowedDisplays]
   * @param {Array<string|object>} [params.allowedTargets]
   * @param {string} [params.exactRequestDigest]
   * @param {string} [params.workspaceRoot]
   * @param {number} [params.ttlMs=600000]
   * @param {boolean} [params.oneUse=false]
   * @param {string} [params.issuerId='ocr_coordinator']
   * @returns {object} Public frozen Grant
   */
  createObservationGrant(params) {
    const clock = this.policyService.getCurrentTime();
    const effectiveRoot = params.workspaceRoot ?? this._workspaceAdmission?.canonicalRoot;

    const grant = {
      schemaVersion: SCHEMA_VERSIONS.GRANT,
      grantId: params.grantId || `grant-ocr-${params.principalId}-${clock}-${this._seq++}`,
      principalId: params.principalId,
      sessionId: params.sessionId,
      scope: {
        actionTypes: [ActionType.SCREEN_CAPTURE],
        ...(params.allowedDisplays ? { allowedDisplays: params.allowedDisplays } : {}),
        ...(params.allowedTargets ? { allowedTargets: params.allowedTargets } : {}),
        ...(params.exactRequestDigest ? { exactRequestDigest: params.exactRequestDigest } : {}),
        ...(effectiveRoot ? { workspaceRoot: effectiveRoot } : {})
      },
      issuedAt: params.issuedAt ?? clock,
      expiresAt: params.expiresAt ?? (clock + (params.ttlMs || 600000)),
      revoked: false,
      issuerId: params.issuerId || 'ocr_coordinator',
      ...(params.oneUse ? { oneUse: true } : {})
    };

    return this.policyService.issueGrant(grant);
  }

  /**
   * Rechecks authority immediately before effect execution.
   *
   * @param {object} actionRequest
   * @param {string} grantId
   * @param {object} [options]
   * @returns {{ granted: boolean, reason: string, details?: object }}
   */
  recheckAtEffectTime(actionRequest, grantId, options = {}) {
    return this.policyService.recheckAtEffectTime(actionRequest, grantId, options);
  }

  /**
   * Executes an asynchronous effect behind atomic pre-effect recheck.
   * Throws PolicyDeniedError if authority was revoked or expired in flight.
   *
   * @param {object} actionRequest
   * @param {string} grantId
   * @param {() => Promise<any>|any} effectExecutor
   * @returns {Promise<any>}
   */
  async executeGuardedEffect(actionRequest, grantId, effectExecutor) {
    const recheck = this.policyService.recheckAtEffectTime(actionRequest, grantId, { consume: true });
    if (!recheck.granted) {
      throw new PolicyDeniedError(recheck.reason, recheck.details, actionRequest, grantId);
    }
    return await effectExecutor();
  }
  /**
   * Evaluates a native ComputerActionRequest (zetro.protocol.computer_request.v1).
   * Enforces:
   * - Strict input validation against zetro.protocol.computer_request.v1.
   * - Proposed input actions (move, click, scroll, key, text) are DISABLED pending native qualification.
   * - Stale generation rejection: if target generation mismatches known target generation.
   * - Exact identity confinement (principal, session, task, attempt, display, root).
   * - Expiry boundary and revocation enforcement.
   * - Literal boolean allowed === true only.
   *
   * @param {object} computerRequest
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object, requestDigest?: string }}
   */
  evaluateComputerAction(computerRequest, options = {}) {
    // 1. Validate request schema
    let validReq;
    try {
      validReq = validateComputerActionRequest(computerRequest, {
        throwOnError: true,
        verifyDigest: Boolean(computerRequest?.requestDigest)
      });
    } catch (err) {
      return {
        allowed: false,
        reason: 'invalid_request',
        details: { error: err.message, errors: err.errors }
      };
    }

    // 2. Input actions DISABLED pending native qualification
    if (UNQUALIFIED_INPUT_OPERATIONS.includes(validReq.operation)) {
      return {
        allowed: false,
        reason: 'input_actions_disabled_pending_qualification',
        details: {
          operation: validReq.operation,
          message: `Proposed native input action '${validReq.operation}' is disabled pending native qualification`
        }
      };
    }

    // 3. Stale generation check for targeted windows
    if (validReq.target?.hwnd) {
      const knownGen = this._knownTargetGenerations.get(validReq.target.hwnd);
      if (knownGen !== undefined && String(validReq.target.generation) !== String(knownGen)) {
        return {
          allowed: false,
          reason: 'stale_generation',
          details: {
            hwnd: validReq.target.hwnd,
            expectedGeneration: knownGen,
            receivedGeneration: validReq.target.generation
          }
        };
      }
    }

    // 4. Expiry boundary check
    const clock = this.policyService.getCurrentTime();
    if (clock >= validReq.expiresAt) {
      return {
        allowed: false,
        reason: 'grant_expired',
        details: {
          expiresAt: validReq.expiresAt,
          currentTime: clock
        }
      };
    }

    // 5. Identity confinement
    if (this._principalId !== null && validReq.principalId !== this._principalId) {
      return {
        allowed: false,
        reason: 'principal_mismatch',
        details: { expected: this._principalId, received: validReq.principalId }
      };
    }

    if (this._sessionId !== null && validReq.sessionId !== this._sessionId) {
      return {
        allowed: false,
        reason: 'session_mismatch',
        details: { expected: this._sessionId, received: validReq.sessionId }
      };
    }

    if (this._requireAdmission && !this._workspaceAdmission) {
      return {
        allowed: false,
        reason: 'missing_workspace_admission',
        details: { message: 'Native computer action requires an active, validated WorkspaceAdmission' }
      };
    }

    if (this._workspaceAdmission) {
      if (validReq.taskId !== this._workspaceAdmission.taskId) {
        return {
          allowed: false,
          reason: 'unadmitted_session',
          details: { expected: this._workspaceAdmission.taskId, received: validReq.taskId }
        };
      }
      if (validReq.attemptId !== this._workspaceAdmission.attemptId) {
        return {
          allowed: false,
          reason: 'unadmitted_session',
          details: { expected: this._workspaceAdmission.attemptId, received: validReq.attemptId }
        };
      }
    }

    // 6. Target display boundary check
    const requestedDisplay = validReq.target?.displayId;
    if (this._targetDisplayId !== null && this._targetDisplayId !== undefined) {
      if (String(requestedDisplay) !== String(this._targetDisplayId)) {
        return {
          allowed: false,
          reason: 'target_outside_grant_scope',
          details: { expected: this._targetDisplayId, requested: requestedDisplay }
        };
      }
    }

    if (this._allowedDisplays && this._allowedDisplays.length > 0) {
      const isAllowed = this._allowedDisplays.some(d => String(d) === String(requestedDisplay));
      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'target_outside_grant_scope',
          details: { allowedDisplays: this._allowedDisplays, requested: requestedDisplay }
        };
      }
    }

    // 7. Evaluate ActionRequest against PolicyService
    let actReq;
    try {
      actReq = createActionRequest({
        taskId: validReq.taskId,
        attemptId: validReq.attemptId,
        principalId: validReq.principalId,
        sessionId: validReq.sessionId,
        actionType: ActionType.SCREEN_CAPTURE,
        parameters: {
          displayId: requestedDisplay ?? 0,
          hwnd: validReq.target?.hwnd ?? null,
          generation: validReq.target?.generation ?? null,
          operation: validReq.operation,
          ...(this._workspaceAdmission ? { workspaceRoot: this._workspaceAdmission.canonicalRoot } : {})
        }
      });
    } catch (err) {
      return {
        allowed: false,
        reason: 'invalid_request',
        details: { error: err.message }
      };
    }

    const shouldConsume = Boolean(options.consume ?? this._consumeByDefault);
    const shouldOneUse = Boolean(options.oneUse ?? this._oneUseByDefault);
    const evalOptions = {
      ...options,
      oneUse: shouldOneUse,
      ...(options.grantId ? { grantId: options.grantId } : {})
    };

    const res = shouldConsume
      ? this.policyService.authorizeAndConsume(actReq, evalOptions)
      : this.policyService.evaluate(actReq, evalOptions);

    if (res.granted !== true) {
      let denialReason = res.reason || 'denied';
      if (res.reason === 'grant_revoked' && res.details?.revocationReason === 'one_use_consumed') {
        denialReason = 'request_already_consumed';
      } else if (res.grantId) {
        const grantRecord = this.policyService.getGrant(res.grantId);
        if (grantRecord?.revoked && grantRecord?.revocationReason === 'one_use_consumed') {
          denialReason = 'request_already_consumed';
        }
      }
      return {
        allowed: false,
        reason: denialReason,
        grantId: res.grantId ?? null,
        details: res.details ?? null
      };
    }

    return {
      allowed: true,
      reason: res.reason || 'authorized',
      grantId: res.grantId ?? null,
      details: res.details ?? null,
      requestDigest: validReq.requestDigest
    };
  }
}

