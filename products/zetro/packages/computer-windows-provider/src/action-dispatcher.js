/**
 * @zetro/computer-windows-provider - Canonical Action Dispatcher
 *
 * Dispatches validated canonical ComputerAction commands to the bounded
 * Windows native process runner. Normalizes all action execution and ensures
 * zero vendor coupling to any specific LLM provider.
 */

import { validateComputerAction, RiskLevel } from '@zetro/model-gateway';

export class ActionDispatchError extends Error {
  constructor(message, { code = 'ACTION_DISPATCH_FAILED', action = null, cause = null } = {}) {
    super(message);
    this.name = 'ActionDispatchError';
    this.code = code;
    this.action = action;
    this.cause = cause;
  }
}

/**
 * Creates an ActionDispatcher bound to a Windows process runner.
 *
 * @param {object} params
 * @param {object} params.runner Instance of createWindowsProcessRunner.
 * @param {object} [params.policy]
 * @param {boolean} [params.policy.inputEnabled=false] Whether input actions are permitted.
 * @param {number} [params.policy.maxExecutionMs=30000] Maximum action execution timeout.
 * @param {Function} [params.onTakeover] Callback invoked if human takeover is detected.
 * @returns {{
 *   dispatch(action: object, context?: object): Promise<object>
 * }}
 */
export function createActionDispatcher({ runner, policy = {}, onTakeover = null }) {
  if (!runner || typeof runner !== 'object') {
    throw new ActionDispatchError('runner is required to create ActionDispatcher', {
      code: 'RUNNER_REQUIRED'
    });
  }

  const {
    inputEnabled = false,
    maxExecutionMs = 30000
  } = policy;

  /**
   * Dispatches a canonical ComputerAction.
   *
   * @param {object} rawAction - Candidate ComputerAction object.
   * @param {object} [context] - Execution context (session, grantExpiry, abort signal).
   * @returns {Promise<{
   *   actionId: string,
   *   kind: string,
   *   status: 'succeeded' | 'failed' | 'approval_required',
   *   result?: object,
   *   error?: string
   * }>}
   */
  async function dispatch(rawAction, context = {}) {
    // 1. Strict canonical action validation
    let action;
    try {
      const candidate = {
        ...rawAction,
        type: rawAction?.type || rawAction?.kind,
        target: rawAction?.target || (typeof rawAction?.x === 'number' && typeof rawAction?.y === 'number' ? { x: rawAction.x, y: rawAction.y } : undefined),
        start: rawAction?.start || (typeof rawAction?.startX === 'number' && typeof rawAction?.startY === 'number' ? { x: rawAction.startX, y: rawAction.startY } : undefined),
        end: rawAction?.end || (typeof rawAction?.endX === 'number' && typeof rawAction?.endY === 'number' ? { x: rawAction.endX, y: rawAction.endY } : undefined),
        anchor: rawAction?.anchor || (typeof rawAction?.x === 'number' && typeof rawAction?.y === 'number' ? { x: rawAction.x, y: rawAction.y } : undefined)
      };
      action = validateComputerAction(candidate);
    } catch (err) {
      return {
        actionId: rawAction?.id || 'unknown',
        type: rawAction?.type || rawAction?.kind || 'unknown',
        kind: rawAction?.type || rawAction?.kind || 'unknown',
        status: 'failed',
        error: `Action validation failed: ${err.message}`
      };
    }

    // 2. High consequential actions require explicit approval if not pre-approved
    if (action.type === 'requestApproval' || ([RiskLevel.CONSEQUENTIAL, RiskLevel.CRITICAL].includes(action.riskLevel) && context.isApproved !== true)) {
      return {
        actionId: action.id,
        type: action.type,
        kind: action.type,
        status: 'approval_required',
        riskLevel: action.riskLevel,
        description: action.description || 'Consequential action requires user confirmation'
      };
    }

    // 3. Input enablement policy check
    if (action.type !== 'observe' && action.type !== 'wait' && !inputEnabled) {
      return {
        actionId: action.id,
        type: action.type,
        kind: action.type,
        status: 'failed',
        error: 'Input actions are disabled by current security policy'
      };
    }

    const runnerOptions = {
      signal: context.signal,
      timeoutMs: context.timeoutMs || maxExecutionMs
    };

    try {
      let result;

      switch (action.type) {
        case 'observe': {
          result = await runner.captureScreen({ outputFile: action.outputFile }, runnerOptions);
          break;
        }

        case 'click': {
          result = await runner.mouseAction({
            actionType: 'click',
            x: action.target?.x,
            y: action.target?.y,
            button: action.button,
            clickType: action.clickType,
            inputEnabled,
            grantExpiry: context.grantExpiry,
            sessionId: context.sessionId
          }, runnerOptions);
          break;
        }

        case 'mouseMove': {
          result = await runner.mouseAction({
            actionType: 'move',
            x: action.target?.x,
            y: action.target?.y,
            duration: action.durationMs,
            inputEnabled,
            grantExpiry: context.grantExpiry,
            sessionId: context.sessionId
          }, runnerOptions);
          break;
        }

        case 'drag': {
          result = await runner.mouseAction({
            actionType: 'drag',
            x: action.start?.x,
            y: action.start?.y,
            endX: action.end?.x,
            endY: action.end?.y,
            button: action.button,
            duration: action.durationMs,
            inputEnabled,
            grantExpiry: context.grantExpiry,
            sessionId: context.sessionId
          }, runnerOptions);
          break;
        }

        case 'typeText': {
          if (typeof action.hwnd === 'number' && action.hwnd > 0) {
            result = await runner.writeText(action.hwnd, action.text, {
              inputEnabled,
              grantExpiry: context.grantExpiry,
              sessionId: context.sessionId,
              expectedPid: context.expectedPid,
              expectedStart: context.expectedStart,
              ...runnerOptions
            });
          } else {
            // Foreground / focused control injection
            result = await runner.writeText(context.targetHwnd || 0, action.text, {
              inputEnabled,
              grantExpiry: context.grantExpiry,
              sessionId: context.sessionId,
              expectedPid: context.expectedPid,
              expectedStart: context.expectedStart,
              ...runnerOptions
            });
          }
          break;
        }

        case 'pressKeys': {
          const keysStr = Array.isArray(action.keys) ? action.keys.join('+') : String(action.keys);
          result = await runner.pressKeys({
            keys: keysStr,
            inputEnabled,
            grantExpiry: context.grantExpiry,
            sessionId: context.sessionId
          }, runnerOptions);
          break;
        }

        case 'scroll': {
          result = await runner.mouseAction({
            actionType: 'scroll',
            x: action.anchor?.x,
            y: action.anchor?.y,
            deltaX: action.deltaX,
            deltaY: action.deltaY,
            inputEnabled,
            grantExpiry: context.grantExpiry,
            sessionId: context.sessionId
          }, runnerOptions);
          break;
        }

        case 'wait': {
          const waitMs = Math.max(1, Math.min(60000, action.durationMs || 1000));
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, waitMs);
            if (context.signal) {
              context.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Wait action aborted'));
              }, { once: true });
            }
          });
          result = { status: 'completed', waitedMs: waitMs };
          break;
        }

        default:
          throw new ActionDispatchError(`Unsupported action type: ${action.type}`, {
            code: 'UNSUPPORTED_ACTION',
            action
          });
      }

      return {
        actionId: action.id,
        type: action.type,
        kind: action.type,
        status: 'succeeded',
        result
      };
    } catch (err) {
      if (err.code === 'HUMAN_TAKEOVER_INTERRUPTED') {
        if (typeof onTakeover === 'function') {
          try { onTakeover({ action, err }); } catch { }
        }
      }

      return {
        actionId: action.id,
        type: action.type,
        kind: action.type,
        status: 'failed',
        error: err.message,
        code: err.code || 'EXECUTION_FAILED'
      };
    }
  }

  return { dispatch };
}
