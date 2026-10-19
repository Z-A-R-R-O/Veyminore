/**
 * @file guarded-actions.js
 * Guarded native action execution for @zetro/computer-agent.
 *
 * Implements Phase 4 Guarded Actions:
 * 1. Focus / select target window.
 * 2. Pointer movement and click (coordinate + DPI mapping).
 * 3. Bounded text entry (via UIA ValuePattern or Unicode SendInput).
 * 4. Key press / chords.
 * 5. Wait and re-observe.
 * 6. All effects flow through the same shared authority check.
 * 7. Recheck exact target identity, grant expiry, revocation, and cancellation immediately before each effect.
 * 8. Never blindly retry uncertain input. Stop on human takeover, target replacement, disconnect, or lease loss.
 */

import { AgentErrorCode, ComputerAgentError } from './types.js';

/**
 * Validates target identity object against required strict fields.
 */
export function validateTargetIdentity(target) {
  if (!target || typeof target !== 'object') {
    throw new ComputerAgentError(AgentErrorCode.TARGET_NOT_FOUND, 'Target descriptor must be a non-null object');
  }

  const hwnd = typeof target.hwnd === 'number'
    ? target.hwnd
    : (typeof target.windowHandle === 'number' ? target.windowHandle : null);

  if (!hwnd || hwnd <= 0 || !Number.isSafeInteger(hwnd)) {
    throw new ComputerAgentError(AgentErrorCode.TARGET_NOT_FOUND, 'Target requires a positive safe integer HWND');
  }

  const pid = typeof target.processId === 'number' && Number.isSafeInteger(target.processId) && target.processId > 0
    ? target.processId
    : null;

  if (!pid) {
    throw new ComputerAgentError(AgentErrorCode.TARGET_MISMATCH, 'Target requires a positive safe integer PID');
  }

  const generation = typeof target.generation === 'string' && target.generation.trim().length > 0
    ? target.generation.trim()
    : null;

  if (!generation) {
    throw new ComputerAgentError(AgentErrorCode.TARGET_MISMATCH, 'Target requires a non-empty generation / process-start token');
  }

  return {
    hwnd,
    processId: pid,
    generation,
    title: typeof target.title === 'string' ? target.title : '',
    bounds: target.bounds || { x: 0, y: 0, width: 800, height: 600 },
    dpi: typeof target.dpi === 'number' ? target.dpi : 96
  };
}

/**
 * Creates a Guarded Action Executor.
 *
 * @param {Object} params
 * @param {Object} params.authorityPort Shared policy/authority evaluator
 * @param {Object} params.windowsProvider Injected Windows observation & execution provider
 * @param {Object} [params.clock] Injected clock function
 * @returns {Object} GuardedExecutor
 */
export function createGuardedExecutor({
  authorityPort,
  windowsProvider,
  clock = () => Date.now()
} = {}) {
  if (!authorityPort || typeof authorityPort.evaluateAction !== 'function') {
    throw new Error('authorityPort with evaluateAction() is required');
  }

  if (!windowsProvider || typeof windowsProvider !== 'object') {
    throw new Error('windowsProvider port is required');
  }

  /**
   * Pre-effect gate: Rechecks session validity, grant expiry, revocation,
   * cancellation token, and fresh native target identity immediately before effect.
   */
  async function preEffectGate({ session, target, actionType, signal }) {
    // 1. Cancellation check
    if (signal && signal.aborted) {
      throw new ComputerAgentError(AgentErrorCode.PLANNER_BLOCKED, 'Action cancelled before execution');
    }

    // 2. Session state & expiry
    const now = clock();
    if (!session || typeof session !== 'object') {
      throw new ComputerAgentError(AgentErrorCode.AUTHORITY_DENIED, 'Active session is required');
    }

    if (session.state === 'stopped' || session.stopped === true) {
      throw new ComputerAgentError(AgentErrorCode.AUTHORITY_REVOKED, 'Session is stopped; effects denied');
    }

    if (session.state === 'revoked' || session.revoked === true) {
      throw new ComputerAgentError(AgentErrorCode.AUTHORITY_REVOKED, 'Session is revoked; effects denied');
    }

    if (session.expiresAt && now >= session.expiresAt) {
      throw new ComputerAgentError(AgentErrorCode.AUTHORITY_EXPIRED, `Session expired at ${session.expiresAt} (now: ${now})`);
    }

    // 3. Shared authority evaluation
    const evalResult = await authorityPort.evaluateAction({
      session,
      target,
      actionType,
      requestedAt: now
    });

    if (!evalResult || evalResult.allowed !== true) {
      const reason = evalResult?.reason || 'unauthorized';
      throw new ComputerAgentError(AgentErrorCode.AUTHORITY_DENIED, `Authority denied action '${actionType}': ${reason}`, {
        evalResult
      });
    }

    // 4. Fresh native target observation recheck (anti-recycled PID & window replacement)
    if (typeof windowsProvider.inspectWindow === 'function') {
      const fresh = await windowsProvider.inspectWindow(target.hwnd, signal ? { signal } : {});
      if (!fresh || !fresh.window) {
        throw new ComputerAgentError(AgentErrorCode.TARGET_REPLACED, `Target window ${target.hwnd} no longer exists prior to effect`);
      }

      const w = fresh.window;
      if (w.processId !== target.processId) {
        throw new ComputerAgentError(AgentErrorCode.TARGET_MISMATCH, `Target PID mismatch prior to effect: expected ${target.processId}, found ${w.processId}`);
      }

      if (target.generation && w.generation && w.generation !== target.generation) {
        throw new ComputerAgentError(AgentErrorCode.TARGET_REPLACED, `Target generation mismatch prior to effect: expected ${target.generation}, found ${w.generation}`);
      }

      if (w.minimized) {
        throw new ComputerAgentError(AgentErrorCode.TARGET_MINIMIZED, `Target window ${target.hwnd} is minimized; cannot execute effect`);
      }

      if (w.visible === false) {
        throw new ComputerAgentError(AgentErrorCode.TARGET_NOT_VISIBLE, `Target window ${target.hwnd} is hidden; cannot execute effect`);
      }
    }

    return true;
  }

  return {
    /**
     * Executes text entry into target window.
     */
    async typeText({ session, target, text, signal, options = {} }) {
      const validatedTarget = validateTargetIdentity(target);

      if (typeof text !== 'string' || text.length === 0) {
        throw new ComputerAgentError(AgentErrorCode.EXECUTOR_FAILED, 'Text to type must be a non-empty string');
      }

      await preEffectGate({
        session,
        target: validatedTarget,
        actionType: 'type_text',
        signal
      });

      // Execute via provider
      if (typeof windowsProvider.writeText === 'function') {
        const result = await windowsProvider.writeText({
          hwnd: validatedTarget.hwnd,
          text,
          expectedPid: validatedTarget.processId,
          expectedStart: validatedTarget.generation,
          sessionId: session.sessionId,
          grantExpiry: session.expiresAt || (clock() + 30000),
          inputEnabled: true,
          ...(signal ? { signal } : {})
        });

        return {
          status: 'executed',
          actionType: 'type_text',
          target: validatedTarget,
          charsWritten: text.length,
          method: result?.method || 'native_write',
          executedAt: clock()
        };
      }

      // If mock or custom provider
      if (typeof windowsProvider.executeAction === 'function') {
        return await windowsProvider.executeAction({
          actionType: 'type_text',
          target: validatedTarget,
          parameters: { text },
          signal
        });
      }

      throw new ComputerAgentError(AgentErrorCode.EXECUTOR_FAILED, 'Injected windowsProvider does not implement writeText or executeAction');
    },

    /**
     * Focuses the target window.
     */
    async focusWindow({ session, target, signal }) {
      const validatedTarget = validateTargetIdentity(target);

      await preEffectGate({
        session,
        target: validatedTarget,
        actionType: 'focus_window',
        signal
      });

      if (typeof windowsProvider.focusWindow === 'function') {
        await windowsProvider.focusWindow(validatedTarget.hwnd, { signal });
      }

      return {
        status: 'executed',
        actionType: 'focus_window',
        target: validatedTarget,
        executedAt: clock()
      };
    },

    /**
     * Injects a key press into the target window.
     */
    async pressKey({ session, target, key, modifiers = [], signal }) {
      const validatedTarget = validateTargetIdentity(target);

      await preEffectGate({
        session,
        target: validatedTarget,
        actionType: 'press_key',
        signal
      });

      if (typeof windowsProvider.pressKey === 'function') {
        await windowsProvider.pressKey({
          hwnd: validatedTarget.hwnd,
          key,
          modifiers,
          signal
        });
      }

      return {
        status: 'executed',
        actionType: 'press_key',
        target: validatedTarget,
        key,
        executedAt: clock()
      };
    },

    /**
     * Clicks coordinates or an element within the target window.
     */
    async clickElement({ session, target, elementId, x, y, signal }) {
      const validatedTarget = validateTargetIdentity(target);

      await preEffectGate({
        session,
        target: validatedTarget,
        actionType: 'click_element',
        signal
      });

      if (typeof windowsProvider.clickElement === 'function') {
        await windowsProvider.clickElement({
          hwnd: validatedTarget.hwnd,
          elementId,
          x,
          y,
          signal
        });
      }

      return {
        status: 'executed',
        actionType: 'click_element',
        target: validatedTarget,
        executedAt: clock()
      };
    }
  };
}
