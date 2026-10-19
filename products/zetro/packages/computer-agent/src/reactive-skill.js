import { runUniversalComputerAgent } from './universal/universal-loop.js';
import { createDesktopOverlay } from './desktop-overlay.js';

// Hosts supply approved model, observation, authority, execution and verification ports.
export function createReactiveComputingSkill({
  ports,
  session,
  overlay = true,
  reducedMotion = false,
  overlayFactory = createDesktopOverlay,
  smartStatus = null,
  createSmartStatus = null
} = {}) {
  if (!session?.sessionId || !session.targetId || !Number.isFinite(session.expiresAt)) {
    throw new Error('An admitted session and target are required');
  }
  if (!['router', 'observer', 'policyGate', 'actionDispatcher', 'verifier'].every(name => ports?.[name])) {
    throw new Error('Reactive computing requires all five trusted ports');
  }
  let active = null;
  return {
    get active() { return active !== null; },
    stop() { active?.abort(new Error('Computing stopped by operator')); },
    async run(goal, { signal, ...budgets } = {}) {
      if (active) throw new Error('This computing session is already running');
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let bridge;
      try {
        const effectiveSmartStatus = session?.smartStatus || smartStatus || (typeof createSmartStatus === 'function' ? createSmartStatus() : null);
        const effectiveTaskId = session?.taskId || session?.sessionId;
        bridge = overlayFactory({
          sessionId: session.sessionId,
          taskId: effectiveTaskId,
          expiresAt: session.expiresAt,
          enabled: overlay === true,
          reducedMotion,
          intent: session.intent || null,
          smartStatus: effectiveSmartStatus,
          createSmartStatus,
          onStopRequested: reason => controller.abort(new Error(`Computing stopped: ${reason}`))
        });
        if (effectiveSmartStatus && typeof bridge?.setSmartStatus === 'function' && !bridge.hasSmartStatus) {
          bridge.setSmartStatus(effectiveSmartStatus);
        }
        if (session?.intent && typeof bridge?.setIntent === 'function' && !bridge.hasIntent) {
          bridge.setIntent(session.intent);
        }
        if (effectiveTaskId && bridge && !bridge.taskId) {
          bridge.taskId = effectiveTaskId;
        }
        return await runUniversalComputerAgent({
          ...budgets, ...ports, goal,
          session: effectiveSmartStatus ? { ...session, smartStatus: effectiveSmartStatus, taskId: effectiveTaskId } : session,
          overlayBridge: bridge, signal: controller.signal
        });
      } finally {
        signal?.removeEventListener('abort', abort);
        bridge?.close();
        active = null;
      }
    }
  };
}
