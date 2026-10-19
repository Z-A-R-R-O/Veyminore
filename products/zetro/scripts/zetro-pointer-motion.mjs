import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createReactiveComputingSkill } from '../packages/computer-agent/src/reactive-skill.js';
import { createWindowsProcessRunner } from '../packages/computer-windows-provider/src/index.js';

export function verifyPointerStep({ action, after, tolerance = 3 }) {
  if (action?.type === 'wait') {
    return {
      verified: true,
      method: 'coordinate',
      details: {
        actionType: 'wait',
        tolerance
      }
    };
  }
  const hasExpected = Number.isFinite(action?.target?.x) && Number.isFinite(action?.target?.y);
  const hasObserved = Number.isFinite(after?.pointer?.x) && Number.isFinite(after?.pointer?.y);
  const expected = hasExpected ? { x: action.target.x, y: action.target.y } : null;
  const observed = hasObserved ? { x: after.pointer.x, y: after.pointer.y } : null;

  let rawDistance = null;
  let distance = null;
  let verified = false;

  if (hasExpected && hasObserved) {
    const raw = Math.hypot(observed.x - expected.x, observed.y - expected.y);
    if (Number.isFinite(raw)) {
      rawDistance = raw;
      verified = raw <= tolerance;
      distance = Number(raw.toFixed(3));
    }
  }

  return {
    verified,
    method: 'coordinate',
    details: {
      expected,
      observed,
      rawDistance,
      distance,
      tolerance
    }
  };
}

const isDirectRun = Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isDirectRun) {
  if (!process.argv.includes('--allow-native-movement')) throw new Error('Explicit movement authorization is required');
  const runner = createWindowsProcessRunner({ helperPath: new URL('../packages/computer-windows-provider/helper/ZetroWindowHelper.exe', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  const { target: identity } = JSON.parse(readFileSync(new URL('../docs/verification/2026-10-18-native-explorer-1792340323787.json', import.meta.url), 'utf8'));
  const initial = await runner.explorerState(identity.hwnd, identity);
  const display = initial.displayBounds;
  if (display.x !== 0 || display.y !== 0) throw new Error('This movement diagnostic currently requires the primary display');
  const controller = new AbortController();
  const sessionId = `motion-${randomUUID()}`;
  const stopPath = new URL(`../scratch/${sessionId}.stop`, import.meta.url);
  const startedAt = Date.now(), endAt = startedAt + 300000;
  const session = { sessionId, targetId: `hwnd-${identity.hwnd}`, target: identity, expiresAt: endAt + 5000, displayBounds: display };
  const grant = { hwnd: identity.hwnd, expectedPid: identity.processId, expectedStart: identity.generation, sessionId, grantExpiry: endAt, inputEnabled: true, signal: controller.signal };

  const left = Math.max(display.x + 70, identity.bounds.x + 70);
  const right = Math.min(display.x + display.width - 70, identity.bounds.x + identity.bounds.width - 70);
  const top = Math.max(display.y + 90, identity.bounds.y + 90);
  const bottom = Math.min(display.y + display.height - 90, identity.bounds.y + identity.bounds.height - 70);
  if (right - left < 150 || bottom - top < 150) throw new Error('The admitted window is too small for this movement session');
  const midX = Math.round((left + right) / 2), midY = Math.round((top + bottom) / 2);
  const points = [{ x: left, y: midY }, { x: right, y: midY }, { x: midX, y: top }, { x: midX, y: bottom }];
  let pointIndex = 0, moves = 0, nextProgress = startedAt + 45000;
  let lastVerification = null;
  const stop = () => controller.abort(new Error('Movement session stopped'));
  process.once('SIGINT', stop);
  const stopWatcher = setInterval(() => { if (existsSync(stopPath)) stop(); }, 100);
  const observer = { async observe() {
    const raw = await runner.explorerState(identity.hwnd, identity, { signal: controller.signal, timeoutMs: 3000 });
    return { ...raw, timestamp: Date.now(), target: { ...raw.window, targetId: session.targetId, displayBounds: display } };
  } };
  const ports = {
    observer,
    router: { async proposeWithFallback({ observation }) {
      if (Date.now() >= endAt) return { modelId: 'local-movement-only', action: { type: 'finish', success: true } };
      if (endAt - Date.now() < 1800) return { modelId: 'local-movement-only', action: { type: 'wait', durationMs: Math.max(1, endAt - Date.now()) } };
      const goal = points[pointIndex];
      const current = observation.pointer;
      const distance = Math.hypot(goal.x - current.x, goal.y - current.y);
      if (distance < 3) pointIndex = (pointIndex + 1) % points.length;
      const destination = points[pointIndex];
      const dx = destination.x - current.x, dy = destination.y - current.y;
      const fraction = Math.min(1, 120 / Math.max(1, Math.hypot(dx, dy)));
      return { modelId: 'local-movement-only', action: { type: 'mouseMove', durationMs: 350,
        target: { x: Math.max(left, Math.min(right, Math.round(current.x + dx * fraction))), y: Math.max(top, Math.min(bottom, Math.round(current.y + dy * fraction))) } } };
    } },
    policyGate: { async evaluate({ action }) {
      return { allowed: !controller.signal.aborted && Date.now() < session.expiresAt &&
        (action.type === 'wait' || (action.type === 'mouseMove' && Date.now() < endAt && action.target.x >= left && action.target.x <= right && action.target.y >= top && action.target.y <= bottom)) };
    } },
    actionDispatcher: { async dispatch(action) {
      if (action.type === 'wait') { await delay(action.durationMs, undefined, { signal: controller.signal }); return { success: true }; }
      try {
        await runner.mouseAction({ ...grant, actionType: 'move', x: action.target.x, y: action.target.y, duration: 350 }, { signal: controller.signal, timeoutMs: 2000 });
        moves++;
        if (Date.now() >= nextProgress) { console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), moves })); nextProgress += 45000; }
        return { success: true };
      } catch (error) { if (error.code === 'HUMAN_TAKEOVER_INTERRUPTED') return { interrupted: true }; throw error; }
    } },
    verifier: {
      async verifyStep({ action, after }) {
        const verification = verifyPointerStep({ action, after, tolerance: 3 });
        lastVerification = verification;
        return verification;
      },
      async verifyGoal() { return { verified: Date.now() >= endAt && moves > 0 }; }
    }
  };
  console.log(JSON.stringify({ sessionId, pid: process.pid, startedAt, durationSeconds: 300, movementOnly: true, stopFile: stopPath.pathname }));
  try {
    const skill = createReactiveComputingSkill({ ports, session });
    const result = await skill.run('Move the pointer left to right and top to bottom for five minutes. No clicks or typing.', { signal: controller.signal, maxSteps: 1000, maxWallMs: 310000, portTimeoutMs: 5000 });
    const receipt = { sessionId, status: result.status, summary: result.summary, startedAt, finishedAt: Date.now(), elapsedSeconds: (Date.now() - startedAt) / 1000, moves, clicks: 0, typedCharacters: 0, lastVerification, journal: result.journal.toJSON() };
    writeFileSync(new URL(`../docs/verification/2026-10-18-five-minute-motion-${startedAt}.json`, import.meta.url), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ status: result.status, summary: result.summary, elapsedSeconds: receipt.elapsedSeconds, moves, clicks: 0, typedCharacters: 0 }));
    process.exitCode = result.success ? 0 : 1;
  } finally { clearInterval(stopWatcher); process.removeListener('SIGINT', stop); controller.abort(); }
}
