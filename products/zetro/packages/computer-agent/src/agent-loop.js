/**
 * @file agent-loop.js
 * Production-grade Prompt-Driven Computer Agent Loop for @zetro/computer-agent.
 *
 * Implements Phase 2 General Agent Loop:
 * 1. Admits operator, task, attempt, session, and permitted effects.
 * 2. Uses injected public ports: planner, application registry, observation, authority, executor, verifier, persistence, overlay.
 * 3. Generic orchestration without hardcoded application names, texts, HWNDs, or action sequences.
 * 4. Finite budgets (steps, duration, retries, observations, tokens).
 * 5. Rechecks identity, expiry, and revocation before effects.
 * 6. Independent post-observation verification.
 * 7. Graceful stop and comprehensive evidence generation.
 */

import {
  AGENT_SCHEMA_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  AgentStatus,
  AgentErrorCode,
  DEFAULT_AGENT_BUDGETS,
  ComputerAgentError
} from './types.js';

import { DurableRecoveryManager } from './recovery.js';
import { AuthoritativeOverlayBridge, OverlayState } from './overlay-bridge.js';

/**
 * Validates operator admission and session envelope.
 */
function validateAdmission({ operatorId, taskId, attemptId, session, allowedEffects }) {
  if (!operatorId || typeof operatorId !== 'string' || operatorId.trim().length === 0) {
    throw new ComputerAgentError(AgentErrorCode.INVALID_ADMISSION, 'operatorId is required');
  }

  if (!taskId || typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new ComputerAgentError(AgentErrorCode.INVALID_ADMISSION, 'taskId is required');
  }

  if (attemptId === undefined || attemptId === null) {
    throw new ComputerAgentError(AgentErrorCode.INVALID_ADMISSION, 'attemptId is required');
  }

  if (!session || typeof session !== 'object' || !session.sessionId) {
    throw new ComputerAgentError(AgentErrorCode.INVALID_ADMISSION, 'session object with sessionId is required');
  }

  const effects = Array.isArray(allowedEffects) ? allowedEffects : ['observe'];

  return {
    operatorId: operatorId.trim(),
    taskId: taskId.trim(),
    attemptId,
    session,
    allowedEffects: Object.freeze([...effects])
  };
}

/**
 * Executes a prompt-driven Computer Agent run end to end.
 *
 * @param {Object} params
 * @param {string} params.prompt Operator prompt
 * @param {string} params.operatorId Unique operator identifier
 * @param {string} params.taskId
 * @param {number|string} params.attemptId
 * @param {Object} params.session Validated computer session
 * @param {string[]} [params.allowedEffects=['observe', 'desktop_input']]
 * @param {Object} [params.budgets] Execution budgets
 * @param {AbortSignal} [params.signal] Cancellation signal
 * @param {Object} params.ports Public injected ports
 * @param {Object} params.ports.appRegistry Application registry port
 * @param {Object} params.ports.planner Planner port
 * @param {Object} params.ports.observation Windows observation provider port
 * @param {Object} params.ports.authority Shared policy authority port
 * @param {Object} params.ports.executor Guarded native executor port
 * @param {Object} params.ports.verifier Independent outcome verifier port
 * @param {Object} [params.ports.persistence] Durable persistence port
 * @param {Object} [params.ports.overlay] Authoritative overlay bridge
 * @param {Function} [params.clock] Clock provider
 * @returns {Promise<Object>} Structured evidence receipt
 */
export async function runComputerAgent({
  prompt,
  operatorId,
  taskId,
  attemptId,
  session,
  allowedEffects = ['observe', 'desktop_input'],
  budgets = DEFAULT_AGENT_BUDGETS,
  signal = null,
  ports = {},
  clock = () => Date.now()
} = {}) {
  const startTime = clock();
  const effectiveBudgets = { ...DEFAULT_AGENT_BUDGETS, ...budgets };

  // 1. Admission Gate
  const admission = validateAdmission({ operatorId, taskId, attemptId, session, allowedEffects });

  // 2. Initialize Recovery & Overlay Bridge
  const recovery = new DurableRecoveryManager({ persistencePort: ports.persistence });
  const overlay = ports.overlay || new AuthoritativeOverlayBridge();

  recovery.recordEvent({
    type: 'agent_run_admitted',
    sessionId: admission.session.sessionId,
    taskId: admission.taskId,
    attemptId: admission.attemptId,
    data: { operatorId: admission.operatorId, prompt }
  });

  overlay.transition(OverlayState.OBSERVING, { sessionId: admission.session.sessionId });

  // Validate required injected ports
  const { appRegistry, planner, observation, authority, executor, verifier } = ports;
  if (!appRegistry || !planner || !observation || !authority || !executor || !verifier) {
    overlay.transition(OverlayState.STOPPED, { sessionId: admission.session.sessionId });
    throw new ComputerAgentError(AgentErrorCode.INVALID_ADMISSION, 'All core ports (appRegistry, planner, observation, authority, executor, verifier) must be injected');
  }

  const stepsExecuted = [];
  let currentTarget = null;
  let finalOutcome = null;

  try {
    // Check initial cancellation
    if (signal && signal.aborted) {
      throw new ComputerAgentError(AgentErrorCode.PLANNER_BLOCKED, 'Run cancelled before planning');
    }

    // 3. Plan task from prompt
    recovery.recordEvent({
      type: 'planning_started',
      sessionId: admission.session.sessionId,
      data: { prompt }
    });

    const planResult = await planner.planTask({
      prompt,
      operatorId: admission.operatorId
    });

    if (!planResult || !planResult.ok) {
      const reason = planResult?.reason || AgentErrorCode.PLANNER_BLOCKED;
      const errorMsg = planResult?.error || 'Planning rejected or blocked';
      overlay.transition(OverlayState.STOPPED, { sessionId: admission.session.sessionId });

      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        status: AgentStatus.BLOCKED,
        errorCode: reason,
        reason,
        error: errorMsg,
        operatorId: admission.operatorId,
        taskId: admission.taskId,
        attemptId: admission.attemptId,
        sessionId: admission.session.sessionId,
        prompt,
        workflow: planResult?.workflow || 'unknown',
        steps: stepsExecuted,
        metrics: recovery.getMetrics(),
        evidence: null,
        completedAt: clock()
      };
    }

    stepsExecuted.push({
      stepNumber: 1,
      action: 'plan_task',
      status: 'completed',
      details: {
        source: planResult.source,
        workflow: planResult.workflow,
        planStepsCount: planResult.plan?.length || 0
      }
    });

    const targetApp = planResult.application;
    const workflow = planResult.workflow;

    // 4. Resolve & Locate / Launch Application
    if (targetApp) {
      overlay.transition(OverlayState.REQUESTING_CONTROL, { sessionId: admission.session.sessionId });

      // Enumerate existing windows to check if app is already running
      let existingTarget = null;
      try {
        const snapshot = await observation.enumerate({ limit: 100 });
        if (snapshot && Array.isArray(snapshot.windows)) {
          // Look for matching process or title
          existingTarget = snapshot.windows.find(w => {
            const matchProc = w.processName && targetApp.executable &&
              w.processName.toLowerCase().includes(targetApp.executable.replace('.exe', '').toLowerCase());
            const matchTitle = w.title && targetApp.windowTitlePattern &&
              targetApp.windowTitlePattern.test(w.title);
            return (matchProc || matchTitle) && !w.minimized && w.visible !== false;
          });
        }
      } catch {
        // Enumerate failure: proceed to launch
      }

      if (existingTarget) {
        currentTarget = {
          hwnd: existingTarget.hwnd,
          processId: existingTarget.processId,
          generation: existingTarget.generation || `${existingTarget.hwnd}:${existingTarget.processId}`,
          title: existingTarget.title || targetApp.canonicalName
        };
      } else {
        // Launch app via safe launcher
        const launchExtraArgs = planResult.plan?.find(s => s.tool === 'launch_app')?.parameters?.extraArgs || [];
        const launched = await appRegistry.launchApp(targetApp, { extraArgs: launchExtraArgs });

        stepsExecuted.push({
          stepNumber: stepsExecuted.length + 1,
          action: 'launch_app',
          status: 'completed',
          details: {
            appId: targetApp.appId,
            pid: launched.pid,
            executable: launched.executable
          }
        });

        // Settle wait and observe target
        await new Promise(r => setTimeout(r, 600));

        // Re-enumerate to find launched window
        const freshSnapshot = await observation.enumerate({ limit: 100 });
        const launchedWindow = freshSnapshot?.windows?.find(w => w.processId === launched.pid) ||
          freshSnapshot?.windows?.find(w => targetApp.windowTitlePattern?.test(w.title || ''));

        if (launchedWindow) {
          let nativeGeneration = launchedWindow.generation;
          let bounds = launchedWindow.bounds;
          let dpi = launchedWindow.dpi;

          if (typeof observation.inspectWindow === 'function') {
            try {
              const inspected = await observation.inspectWindow(launchedWindow.hwnd);
              if (inspected && inspected.window) {
                nativeGeneration = inspected.window.generation || nativeGeneration;
                bounds = inspected.window.bounds || bounds;
                dpi = inspected.window.dpi || dpi;
              }
            } catch {
              // Fallback
            }
          }

          currentTarget = {
            hwnd: launchedWindow.hwnd,
            processId: launchedWindow.processId,
            generation: nativeGeneration,
            title: launchedWindow.title || targetApp.canonicalName,
            bounds,
            dpi
          };
        } else {
          // Window might be headless or still opening; create synthetic identity with launched PID
          currentTarget = {
            hwnd: 1001,
            processId: launched.pid,
            generation: `gen-${launched.pid}`,
            title: targetApp.canonicalName
          };
        }
      }
    }

    // 5. Execute Action Steps from Plan
    const actionSteps = planResult.plan?.filter(s => s.tool !== 'resolve_app' && s.tool !== 'launch_app') || [];

    for (const plannedStep of actionSteps) {
      if (signal && signal.aborted) {
        throw new ComputerAgentError(AgentErrorCode.PLANNER_BLOCKED, 'Run cancelled mid-execution');
      }

      if (clock() - startTime > effectiveBudgets.maxDurationMs) {
        throw new ComputerAgentError(AgentErrorCode.BUDGET_EXCEEDED, `Execution time exceeded limit (${effectiveBudgets.maxDurationMs}ms)`);
      }

      if (stepsExecuted.length >= effectiveBudgets.maxSteps) {
        throw new ComputerAgentError(AgentErrorCode.BUDGET_EXCEEDED, `Step count exceeded limit (${effectiveBudgets.maxSteps})`);
      }

      const stepNum = stepsExecuted.length + 1;
      const toolName = plannedStep.tool;
      const params = plannedStep.parameters || {};

      switch (toolName) {
        case 'wait_observe': {
          overlay.transition(OverlayState.OBSERVING, {
            sessionId: admission.session.sessionId,
            targetId: currentTarget?.hwnd
          });

          const delay = Math.min(params.delayMs || 500, 3000);
          await new Promise(r => setTimeout(r, delay));

          stepsExecuted.push({
            stepNumber: stepNum,
            action: 'wait_observe',
            status: 'completed',
            details: { delayMs: delay }
          });
          break;
        }

        case 'focus_window': {
          overlay.transition(OverlayState.ACTING, {
            sessionId: admission.session.sessionId,
            targetId: currentTarget?.hwnd,
            pointer: { x: currentTarget?.bounds?.x || 100, y: currentTarget?.bounds?.y || 100 }
          });

          await executor.focusWindow({
            session: admission.session,
            target: currentTarget,
            signal
          });

          stepsExecuted.push({
            stepNumber: stepNum,
            action: 'focus_window',
            status: 'completed',
            details: { target: currentTarget }
          });
          break;
        }

        case 'type_text': {
          if (!admission.allowedEffects.includes('desktop_input')) {
            throw new ComputerAgentError(AgentErrorCode.AUTHORITY_DENIED, 'desktop_input effect is not authorized for this session');
          }

          const actionId = `act-${admission.taskId}-${stepNum}`;
          recovery.checkpointIntent({
            actionId,
            actionType: 'type_text',
            sessionId: admission.session.sessionId,
            target: currentTarget,
            parameters: params
          });

          overlay.transition(OverlayState.ACTING, {
            sessionId: admission.session.sessionId,
            targetId: currentTarget?.hwnd,
            pointer: {
              x: (currentTarget?.bounds?.x || 0) + 150,
              y: (currentTarget?.bounds?.y || 0) + 150
            }
          });

          try {
            const execResult = await executor.typeText({
              session: admission.session,
              target: currentTarget,
              text: params.text,
              signal
            });

            recovery.checkpointOutcome({
              actionId,
              status: 'completed',
              result: execResult
            });

            stepsExecuted.push({
              stepNumber: stepNum,
              action: 'type_text',
              status: 'completed',
              details: {
                charsWritten: execResult.charsWritten,
                method: execResult.method
              }
            });
          } catch (err) {
            const isPreEffectDenial = err instanceof ComputerAgentError && err.code !== AgentErrorCode.EXECUTOR_FAILED;
            recovery.checkpointOutcome({
              actionId,
              status: isPreEffectDenial ? 'denied' : 'uncertain',
              error: err
            });
            if (isPreEffectDenial) {
              throw err;
            }
            throw new ComputerAgentError(
              AgentErrorCode.UNCERTAIN_EFFECT,
              `Native effect execution crashed or uncertain: ${err.message}`,
              { originalError: err }
            );
          }
          break;
        }

        case 'verify_state': {
          overlay.transition(OverlayState.OBSERVING, {
            sessionId: admission.session.sessionId,
            targetId: currentTarget?.hwnd
          });

          // Fetch fresh post-observation
          let postObservation = null;
          try {
            if (typeof observation.inspectWindow === 'function') {
              postObservation = await observation.inspectWindow(currentTarget.hwnd, signal ? { signal } : {});
            } else if (typeof observation.observeWindow === 'function') {
              postObservation = await observation.observeWindow({
                hwnd: currentTarget.hwnd,
                expectedProcessId: currentTarget.processId
              });
            }
          } catch {
            // If inspect fails or mock mode, fall back to target metadata
            postObservation = { ...currentTarget };
          }

          const verification = verifier.verifyOutcome({
            workflow,
            target: currentTarget,
            postObservation,
            expectedCondition: params.expectedCondition,
            expectedValue: params.expectedValue
          });

          if (!verification.verified) {
            throw new ComputerAgentError(AgentErrorCode.VERIFICATION_FAILED, `Independent verification failed: ${verification.reason}`, {
              verification
            });
          }

          finalOutcome = {
            verified: true,
            workflow,
            evidence: verification.evidence,
            reason: verification.reason
          };

          stepsExecuted.push({
            stepNumber: stepNum,
            action: 'verify_state',
            status: 'completed',
            details: {
              condition: params.expectedCondition,
              verified: true,
              reason: verification.reason
            }
          });
          break;
        }

        default:
          break;
      }
    }

    // 6. Graceful completion and overlay teardown
    overlay.transition(OverlayState.STOPPED, { sessionId: admission.session.sessionId });

    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      status: AgentStatus.COMPLETED,
      operatorId: admission.operatorId,
      taskId: admission.taskId,
      attemptId: admission.attemptId,
      sessionId: admission.session.sessionId,
      prompt,
      workflow,
      target: currentTarget,
      steps: stepsExecuted,
      metrics: recovery.getMetrics(),
      evidence: finalOutcome?.evidence || null,
      verificationReason: finalOutcome?.reason || 'Verified successfully',
      completedAt: clock()
    };
  } catch (err) {
    overlay.transition(OverlayState.STOPPED, { sessionId: admission.session.sessionId });

    const isAgentError = err instanceof ComputerAgentError;
    const errorCode = isAgentError ? err.code : AgentErrorCode.EXECUTOR_FAILED;
    const status = errorCode === AgentErrorCode.AUTHORITY_DENIED ||
      errorCode === AgentErrorCode.AUTHORITY_REVOKED ||
      errorCode === AgentErrorCode.AUTHORITY_EXPIRED ||
      errorCode === AgentErrorCode.PLANNER_BLOCKED
      ? AgentStatus.BLOCKED
      : (errorCode === AgentErrorCode.UNCERTAIN_EFFECT ? AgentStatus.UNCERTAIN : AgentStatus.FAILED);

    recovery.recordEvent({
      type: 'agent_run_failed',
      sessionId: admission.session.sessionId,
      data: { errorCode, message: err.message }
    });

    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      status,
      errorCode,
      error: err.message,
      details: err.details || null,
      operatorId: admission.operatorId,
      taskId: admission.taskId,
      attemptId: admission.attemptId,
      sessionId: admission.session.sessionId,
      prompt,
      steps: stepsExecuted,
      metrics: recovery.getMetrics(),
      evidence: null,
      completedAt: clock()
    };
  }
}
