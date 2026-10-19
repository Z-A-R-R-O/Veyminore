/**
 * @file ports/computer-port.js
 * Injected Authority Port for ZETRO Computer providers (M6/M7).
 * Mediates screen capture, desktop input, scoped filesystem, shell, and browser actions.
 * Enforces pre-effect authority evaluation and atomic one-use approval consumption.
 *
 * NOTE: ComputerPolicyPort enforces policy at the application/API layer.
 * It does NOT claim or provide OS-level hardware/kernel sandboxing.
 */

import {
  createActionRequest,
  ActionType,
  SCHEMA_VERSIONS
} from '../../../protocol/src/index.js';
import { PolicyDeniedError } from '../errors.js';

export class ComputerPolicyPort {
  /**
   * @param {import('../policy-service.js').PolicyService} policyService
   */
  constructor(policyService) {
    if (!policyService) {
      throw new Error('ComputerPolicyPort requires a PolicyService instance');
    }
    this.policyService = policyService;
  }

  /**
   * Evaluates screen capture permission.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string} [params.taskId='computer-task']
   * @param {string|number} [params.displayId=0]
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object }}
   */
  evaluateScreenCapture(params, options = {}) {
    let req;
    try {
      req = createActionRequest({
        taskId: params.taskId || 'computer-task',
        attemptId: params.attemptId || 1,
        principalId: params.principalId,
        sessionId: params.sessionId,
        actionType: ActionType.SCREEN_CAPTURE,
        parameters: {
          displayId: params.displayId ?? 0,
          bounds: params.bounds || null
        }
      });
    } catch (err) {
      return { allowed: false, reason: 'invalid_request', details: { error: err.message } };
    }

    const res = options.consume
      ? this.policyService.authorizeAndConsume(req, options)
      : this.policyService.evaluate(req, options);

    return {
      allowed: res.granted,
      reason: res.reason,
      grantId: res.grantId,
      details: res.details,
      requestDigest: req.requestDigest
    };
  }

  /**
   * Evaluates desktop input permission (mouse/keyboard).
   * Supports immediate pre-effect authority recheck and atomic approval consumption.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string} params.action - 'mouse_click', 'mouse_move', 'key_down', 'key_up', 'type_text'
   * @param {object} [params.coordinates]
   * @param {string} [params.text]
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object }}
   */
  evaluateDesktopInput(params, options = {}) {
    let req;
    try {
      req = createActionRequest({
        taskId: params.taskId || 'computer-task',
        attemptId: params.attemptId || 1,
        principalId: params.principalId,
        sessionId: params.sessionId,
        actionType: ActionType.DESKTOP_INPUT,
        parameters: {
          action: params.action,
          coordinates: params.coordinates || null,
          text: params.text || null
        }
      });
    } catch (err) {
      return { allowed: false, reason: 'invalid_request', details: { error: err.message } };
    }

    const res = options.consume
      ? this.policyService.authorizeAndConsume(req, options)
      : this.policyService.evaluate(req, options);

    return {
      allowed: res.granted,
      reason: res.reason,
      grantId: res.grantId,
      details: res.details,
      requestDigest: req.requestDigest
    };
  }

  /**
   * Evaluates shell execution permission under fixed command profiles.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string[]} params.command - Command and arguments array
   * @param {string} params.cwd - Explicit working directory
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object }}
   */
  evaluateShellExecution(params, options = {}) {
    let req;
    try {
      req = createActionRequest({
        taskId: params.taskId || 'computer-task',
        attemptId: params.attemptId || 1,
        principalId: params.principalId,
        sessionId: params.sessionId,
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: params.command,
          cwd: params.cwd
        }
      });
    } catch (err) {
      return { allowed: false, reason: 'invalid_request', details: { error: err.message } };
    }

    const res = options.consume
      ? this.policyService.authorizeAndConsume(req, options)
      : this.policyService.evaluate(req, options);

    return {
      allowed: res.granted,
      reason: res.reason,
      grantId: res.grantId,
      details: res.details,
      requestDigest: req.requestDigest
    };
  }

  /**
   * Evaluates filesystem access permission (read, write, create, delete).
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string} params.actionType - ActionType.FILE_READ, FILE_WRITE, FILE_CREATE, or FILE_DELETE
   * @param {string} params.path - Target relative path
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object }}
   */
  evaluateFileAccess(params, options = {}) {
    let req;
    try {
      req = createActionRequest({
        taskId: params.taskId || 'computer-task',
        attemptId: params.attemptId || 1,
        principalId: params.principalId,
        sessionId: params.sessionId,
        actionType: params.actionType || ActionType.FILE_READ,
        parameters: {
          path: params.path,
          content: params.content || null
        }
      });
    } catch (err) {
      return { allowed: false, reason: 'invalid_request', details: { error: err.message } };
    }

    const res = options.consume
      ? this.policyService.authorizeAndConsume(req, options)
      : this.policyService.evaluate(req, options);

    return {
      allowed: res.granted,
      reason: res.reason,
      grantId: res.grantId,
      details: res.details,
      requestDigest: req.requestDigest
    };
  }

  /**
   * Rechecks authority immediately before effect execution.
   * If authority is denied, throws PolicyDeniedError to prevent unpermitted effect mutation.
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
   * Helper to issue a standard Computer session grant.
   *
   * @param {object} params
   * @param {string} params.principalId
   * @param {string} params.sessionId
   * @param {string[]} [params.actionTypes]
   * @param {string[]} [params.allowedPaths]
   * @param {string[]} [params.allowedCommands]
   * @param {number} [params.ttlMs=600000]
   * @returns {object} Stored Grant
   */
  createComputerGrant(params) {
    const clock = this.policyService.getCurrentTime();
    const grant = {
      schemaVersion: SCHEMA_VERSIONS.GRANT,
      grantId: `grant-computer-${params.principalId}-${Date.now()}`,
      principalId: params.principalId,
      sessionId: params.sessionId,
      scope: {
        actionTypes: params.actionTypes || [
          ActionType.SCREEN_CAPTURE,
          ActionType.DESKTOP_INPUT,
          ActionType.FILE_READ,
          ActionType.FILE_WRITE,
          ActionType.SHELL_EXEC
        ],
        allowedPaths: params.allowedPaths || ['packages', 'src', '.'],
        allowedCommands: params.allowedCommands || ['npm', 'node', 'git', 'dir']
      },
      issuedAt: clock,
      expiresAt: clock + (params.ttlMs || 600000),
      revoked: false,
      issuerId: params.issuerId || 'computer_supervisor'
    };

    return this.policyService.issueGrant(grant);
  }
}
