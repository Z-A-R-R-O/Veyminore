import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lstatSync, realpathSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWindowsProcessRunner, parseHelperEnumerateOutput } from '../../computer-windows-provider/src/index.js';
import { parseDeterministicIntent } from './planner.js';
import { createReactiveComputingSkill } from './reactive-skill.js';
import { verifyFileExplorerFolder, isSafeFolderName } from './folder-verifier.js';

// A bounded native host. Other goals need their own admitted planner and verifier.
export async function runExplorerFolderTask({ prompt, inputEnabled = false, overlay = true, signal, runner, launcher = launchExplorer } = {}) {
  const intent = parseDeterministicIntent(prompt);
  const name = intent.payload?.folderName?.trim();
  if (!intent.ok || intent.workflow !== 'file_explorer_folder' || intent.payload.targetDir !== 'Downloads' || !isSafeFolderName(name)) {
    throw new Error('This host accepts one safe folder creation goal in Downloads');
  }
  if (inputEnabled !== true) return { success: false, status: 'blocked', summary: 'Explicit native input authorization is required' };
  runner ||= createWindowsProcessRunner({ helperPath: fileURLToPath(new URL('../../computer-windows-provider/helper/ZetroWindowHelper.exe', import.meta.url)) });
  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) forward();
  const deadline = setTimeout(() => controller.abort(new Error('Native task deadline exceeded')), 60000);
  const options = { signal: controller.signal, timeoutMs: 5000 };
  let session;
  try {
    const parent = realpathSync(await runner.downloadsPath(options));
    const path = join(parent, name);
    const baseline = { existed: exists(path), observedAt: Date.now() };
    await launcher(parent, options);
    const selected = await findExplorer(runner, parent, options);
    if (baseline.existed) return { success: false, status: 'already_exists', folderPath: path, summary: 'Folder already exists; no creation attempted' };
    session = { sessionId: `explorer-${randomUUID()}`, targetId: `hwnd-${selected.window.hwnd}`, target: selected.window, expiresAt: Date.now() + 45000, state: 'active', displayBounds: selected.displayBounds };
    const nativeOptions = { ...options, expectedPid: selected.window.processId, expectedStart: selected.window.generation, sessionId: session.sessionId, grantExpiry: session.expiresAt, inputEnabled: true, expectedLocation: parent };
    await runner.focusWindow(selected.window.hwnd, nativeOptions);
    let phase = 0, latestObservation = null;
    const actions = [
      { type: 'pressKeys', keys: ['Control', 'Shift', 'N'], riskLevel: 'reversible_ui' },
      { type: 'typeText', text: name, riskLevel: 'reversible_ui' },
      { type: 'pressKeys', keys: ['Enter'], riskLevel: 'reversible_ui' }
    ];
    const read = async () => {
      const raw = await runner.explorerState(selected.window.hwnd, selected.window, options);
      if (pathKey(raw.location) !== pathKey(parent)) throw new Error('Explorer left the approved Downloads directory');
      latestObservation = { ...raw, timestamp: Date.now(), target: { ...raw.window, targetId: session.targetId, displayBounds: raw.displayBounds } };
      return latestObservation;
    };
    const goalVerified = observation => verifyFileExplorerFolder({ target: selected.window, postObservation: observation, expectedFolderName: name, expectedParentPath: parent, baseline });
    const observer = { async observe() {
      for (let attempt = 0; attempt < 20; attempt++) {
        const observation = await read();
        if (phase === 0 || (phase === 1 && observation.renameActive) ||
            (phase === 2 && observation.renameActive && observation.focusedEdit === name) ||
            (phase === 3 && goalVerified(observation).verified && !observation.renameActive)) return observation;
        await delay(100, undefined, { signal: controller.signal });
      }
      throw new Error('Expected Explorer UI transition was not independently observed; no retry');
    } };
    const ports = {
      observer,
      router: { async proposeWithFallback() {
        return { modelId: 'bounded-local-explorer', action: actions[phase] || { type: 'finish', success: true } };
      } },
      policyGate: { async evaluate({ action, observation }) {
        const approved = actions[phase];
        return { allowed: session.state === 'active' && !controller.signal.aborted && Date.now() < session.expiresAt &&
          observation.target.targetId === session.targetId && pathKey(observation.location) === pathKey(parent) &&
          action.type === approved?.type && (action.type !== 'typeText' || (action.text === name && observation.renameActive)) &&
          (action.type !== 'pressKeys' || action.keys.join('+') === approved.keys.join('+')) };
      } },
      actionDispatcher: { async dispatch(action) {
        if (action.type === 'typeText') await runner.typeFocusedText(selected.window.hwnd, action.text, { ...nativeOptions, expectedFocusClass: latestObservation.focusClass });
        else await runner.pressKeys({ keys: action.keys.join('+'), hwnd: selected.window.hwnd, ...nativeOptions, expectedFocusClass: phase === 2 ? latestObservation.focusClass : undefined }, options);
        phase++;
        return { success: true };
      } },
      verifier: {
        async verifyStep({ after }) {
          if (phase === 1) return { verified: after.renameActive === true };
          if (phase === 2) return { verified: after.renameActive === true && after.focusedEdit === name };
          return goalVerified(after);
        },
        async verifyGoal({ observation }) { return goalVerified(observation); }
      }
    };
    const skill = createReactiveComputingSkill({ ports, session, overlay });
    const result = await skill.run(prompt, { signal: controller.signal, maxSteps: 4, maxWallMs: 45000, portTimeoutMs: 8000 });
    return { success: result.success, status: result.status, summary: result.summary, folderPath: path, native: true,
      sessionId: session.sessionId, target: selected.window, steps: result.steps, journal: result.journal.toJSON() };
  } catch (error) {
    return { success: false, status: controller.signal.aborted ? 'cancelled' : 'blocked', native: true, summary: String(error.message).slice(0, 200), code: error.code };
  } finally {
    if (session) session.state = 'stopped';
    controller.abort(new Error('Native task ended'));
    clearTimeout(deadline);
    signal?.removeEventListener('abort', forward);
  }
}

async function findExplorer(runner, parent, options) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { stdout } = await runner.explorerWindows(options);
    const candidates = parseHelperEnumerateOutput(stdout).windows.filter(window => window.processName.toLowerCase().replace(/\.exe$/, '') === 'explorer' && window.visible && !window.minimized);
    const matches = [];
    for (const candidate of candidates) {
      try {
        const state = await runner.explorerState(candidate.hwnd, candidate, options);
        if (pathKey(state.location) === pathKey(parent)) matches.push(state);
      } catch (error) { if (options.signal.aborted) throw error; }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('Multiple Downloads windows match; input was not sent');
    await delay(200, undefined, { signal: options.signal });
  }
  throw new Error('An exact Downloads Explorer window was not found');
}

function launchExplorer(path, { signal }) {
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), [path], { shell: false, windowsHide: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
function exists(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function pathKey(path) { return normalize(path).replace(/[\\/]+$/, '').toLowerCase(); }
