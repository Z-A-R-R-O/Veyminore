import { ZetroOrb, createSmartStatus } from './orb.js';
import { mountDock } from '/dock.js';

// --- FIXED PUBLIC SYNTHETIC TASK FIXTURES ---
// Standalone visual preview scenarios. Zero real inputs, zero network calls, zero private data.
export const SYNTHETIC_FIXTURES = {
  create_folder: {
    label: "Create ‘hello’ in Downloads",
    intent: { operation: 'create_folder', targetLabel: 'hello', destinationLabel: 'Downloads', allowDisplayLabels: true },
    steps: [
      { phase: 'intention', mode: 'activating', desc: 'Simulated intention · no computer access', dwell: 1800 },
      { phase: 'thinking', mode: 'thinking', desc: 'Simulated planning · no model connected', dwell: 1800 },
      { phase: 'observing', mode: 'observing', desc: 'Simulated observation · no screen capture', dwell: 2000 },
      { phase: 'acting', mode: 'acting', desc: 'Simulated movement · no input sent', dwell: 2200 },
      { phase: 'checking', mode: 'thinking', verified: true, stepId: 'step-folder-created', desc: 'Simulated check · verified folder created', dwell: 1800 },
      { phase: 'completed', mode: 'off', verified: true, desc: 'Simulated completion · visual preview only', dwell: 2400 }
    ]
  },
  open_app: {
    label: 'Open Browser',
    intent: { operation: 'open_app', application: 'Browser', allowDisplayLabels: true },
    steps: [
      { phase: 'intention', mode: 'activating', desc: 'Simulated intention · no computer access', dwell: 1800 },
      { phase: 'thinking', mode: 'thinking', desc: 'Simulated planning · no model connected', dwell: 1800 },
      { phase: 'observing', mode: 'observing', desc: 'Simulated observation · no screen capture', dwell: 2000 },
      { phase: 'acting', mode: 'acting', desc: 'Simulated movement · no input sent', dwell: 2200 },
      { phase: 'checking', mode: 'thinking', verified: true, stepId: 'step-app-launched', desc: 'Simulated check · verified browser launched', dwell: 1800 },
      { phase: 'completed', mode: 'off', verified: true, desc: 'Simulated completion · visual preview only', dwell: 2400 }
    ]
  },
  move_pointer: {
    label: 'Move pointer',
    intent: { operation: 'move_pointer', targetLabel: 'workspace', allowDisplayLabels: true },
    steps: [
      { phase: 'intention', mode: 'activating', desc: 'Simulated intention · no computer access', dwell: 1800 },
      { phase: 'thinking', mode: 'thinking', desc: 'Simulated planning · no model connected', dwell: 1800 },
      { phase: 'observing', mode: 'observing', desc: 'Simulated observation · no screen capture', dwell: 2000 },
      { phase: 'acting', mode: 'acting', desc: 'Simulated movement · no input sent', dwell: 2200 },
      { phase: 'checking', mode: 'thinking', verified: true, stepId: 'step-coord-verified', desc: 'Simulated check · verified coordinates', dwell: 1800 },
      { phase: 'completed', mode: 'off', verified: true, desc: 'Simulated completion · visual preview only', dwell: 2400 }
    ]
  },
  delayed_target: {
    label: 'Delayed target',
    intent: { operation: 'search', application: 'Workspace', allowDisplayLabels: true },
    steps: [
      { phase: 'intention', mode: 'activating', desc: 'Simulated intention · search target', dwell: 1500 },
      { phase: 'observing', mode: 'observing', desc: 'Simulated search · observing > 8s', dwell: 8500 },
      { phase: 'acting', mode: 'acting', desc: 'Target found · simulated action', dwell: 2000 },
      { phase: 'checking', mode: 'thinking', verified: true, stepId: 'step-search-done', desc: 'Simulated check · verified result', dwell: 1500 },
      { phase: 'completed', mode: 'off', verified: true, desc: 'Simulated completion · visual preview only', dwell: 2400 }
    ]
  },
  verification_failed: {
    label: 'Verification failure',
    intent: { operation: 'create_folder', targetLabel: 'system_root', destinationLabel: 'Protected', allowDisplayLabels: true },
    steps: [
      { phase: 'intention', mode: 'activating', desc: 'Simulated intention · protected folder', dwell: 1500 },
      { phase: 'thinking', mode: 'thinking', desc: 'Simulated planning · checking permissions', dwell: 1500 },
      { phase: 'acting', mode: 'acting', desc: 'Simulated attempt · permission denied', dwell: 1800 },
      { phase: 'checking', mode: 'thinking', verified: false, desc: 'Verification failed · folder not created', dwell: 1800 },
      { phase: 'failed', mode: 'stopped', verified: false, desc: 'Operation blocked · simulated failure', dwell: 2400 }
    ]
  }
};

const defaultLabels = {
  off: ['Ready when you are', 'Orb preview · no computer access'],
  activating: ['Waking up…', 'Simulated activation'],
  thinking: ['Thinking…', 'Simulated planning · no model connected'],
  observing: ['Locating target…', 'Simulated observation · no screen capture'],
  acting: ['Moving mouse…', 'Simulated movement · no input sent'],
  paused: ['Paused', 'Preview suspended'],
  stopped: ['Stopped', 'Preview ended · no computer access']
};

// --- COMPONENT TEMPLATE & LIFECYCLE ---

export function getComputerPreviewHtml() {
  return `
    <div class="computer-preview-wrap">
      <div class="hero">
        <span class="eyebrow">01 — COMPUTER ACCESS</span>
        <h1>A little presence.<br><span>A new perspective.</span></h1>
        <p class="intro">A little assistance. A clear sense of control.<br>Every action, beautifully visible.</p>
      </div>
      <div class="simulation">VISUAL SIMULATION · No computer access</div>
      <section class="canvas" aria-label="Simulated desktop">
        <div class="canvas-top">
          <span class="window-dot"></span>
          <span class="window-dot"></span>
          <span class="window-dot"></span>
          <span>Workspace / Preview</span>
        </div>
        <div class="document">
          <span>02 — YOUR SPACE, ASSISTED</span>
          <h2>Room to do<br>your best work.</h2>
          <p>This is a visual prototype. No windows are captured.<br>No mouse or keyboard actions are sent.</p>
          <div class="lines"><i></i><i></i><i></i></div>
        </div>
        <div class="pointer" aria-hidden="true">
          <svg viewBox="-10 -10 620 720" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ref-outline" x2=".85" y2="1"><stop stop-color="#f9fcff"/><stop offset="1" stop-color="#d8e2eb"/></linearGradient>
              <linearGradient id="ref-body" x2=".85" y2="1"><stop stop-color="#030405"/><stop offset="1" stop-color="#1c2025"/></linearGradient>
              <linearGradient id="ref-upper" x2=".85" y2="1"><stop stop-color="#080b0e"/><stop offset="1" stop-color="#525a63"/></linearGradient>
              <linearGradient id="ref-left" x2=".85" y2="1"><stop stop-color="#040506"/><stop offset="1" stop-color="#101418"/></linearGradient>
              <linearGradient id="ref-slit" x2=".85" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#e6edf2"/></linearGradient>
              <linearGradient id="ref-spine" x2=".85" y2="1"><stop stop-color="#010203"/><stop offset="1" stop-color="#101418"/></linearGradient>
              <linearGradient id="ref-center" x2=".85" y2="1"><stop stop-color="#424a52"/><stop offset="1" stop-color="#050709"/></linearGradient>
              <linearGradient id="ref-right" x2=".85" y2="1"><stop stop-color="#161b20"/><stop offset="1" stop-color="#06080a"/></linearGradient>
              <linearGradient id="ref-lower" x2=".85" y2="1"><stop stop-color="#040608"/><stop offset="1" stop-color="#272d34"/></linearGradient>
              <linearGradient id="ref-stem" x2=".85" y2="1"><stop stop-color="#06080a"/><stop offset="1" stop-color="#343b43"/></linearGradient>
              <linearGradient id="ref-stemFold" x2=".85" y2="1"><stop stop-color="#020304"/><stop offset="1" stop-color="#14191e"/></linearGradient>
            </defs>
            <polygon points="0,0 594,489 378,433 495,691 258,503 181,609 77,174 59,154" fill="url(#ref-outline)"/>
            <polygon points="21,25 525,450 312,404 183,591 78,176" fill="url(#ref-body)"/>
            <polygon points="24,27 266,291 370,328" fill="url(#ref-upper)"/>
            <polygon points="25,35 123,201 173,400 156,462 85,180" fill="url(#ref-left)"/>
            <polygon points="123,201 146,233 182,379 180,410 156,462 173,399" fill="url(#ref-slit)"/>
            <polygon points="37,52 243,352 278,316 300,337 183,576" fill="url(#ref-spine)"/>
            <polygon points="183,576 300,337 278,316 242,352" fill="url(#ref-center)"/>
            <polygon points="278,316 300,337 475,382 370,328" fill="url(#ref-right)"/>
            <polygon points="300,337 475,382 525,450 312,404" fill="url(#ref-lower)"/>
            <polygon points="260,496 315,414 476,661" fill="url(#ref-stem)"/>
            <polygon points="315,414 370,430 374,454 476,661" fill="url(#ref-stemFold)"/>
            <polyline points="24,27 266,291 370,328" fill="none" stroke="#c7d0db" stroke-opacity=".8" stroke-width="1.2"/>
            <polyline points="183,576 300,337 475,382" fill="none" stroke="#bac7d2" stroke-opacity=".8" stroke-width="1.2"/>
            <polyline points="260,496 476,661" fill="none" stroke="#f8fbff" stroke-opacity=".8" stroke-width="5"/>
            <polyline points="378,433 495,691" fill="none" stroke="#ffffff" stroke-opacity=".8" stroke-width="2"/>
            <polygon points="123,201 146,233 182,379 180,410 156,462 173,399" fill="url(#ref-slit)"/>
          </svg>
        </div>
        <div class="canvas-edge" aria-hidden="true"></div>
      </section>

      <div class="control-heading"><span>03 — SIMULATED TASKS</span><small>Smart Intent-Status</small></div>
      <section class="task-selector" aria-label="Simulated tasks">
        <div class="task-chips" role="group" aria-label="Task presets">
          <button type="button" class="task-chip" data-task="create_folder" aria-pressed="true">Create ‘hello’ in Downloads</button>
          <button type="button" class="task-chip" data-task="open_app" aria-pressed="false">Open Browser</button>
          <button type="button" class="task-chip" data-task="move_pointer" aria-pressed="false">Move pointer</button>
          <button type="button" class="task-chip" data-task="delayed_target" aria-pressed="false">Delayed target</button>
          <button type="button" class="task-chip" data-task="verification_failed" aria-pressed="false">Verification failure</button>
        </div>
        <button type="button" id="play-task" class="play-btn" aria-label="Play task simulation">Play simulation</button>
      </section>

      <div class="control-heading"><span>04 — EXPLORE THE ORB</span><small>Preview only</small></div>
      <section class="controls" aria-label="Preview access states">
        <button type="button" data-mode="activating">Wake</button>
        <button type="button" data-mode="thinking">Think</button>
        <button type="button" data-mode="observing">Observe</button>
        <button type="button" data-mode="acting">Act</button>
        <button type="button" data-mode="paused">Pause</button>
        <button type="button" data-mode="stopped" class="stop">End</button>
      </section>
      <div class="control-heading"><span>05 — REACT BITS ORB SHOWCASE</span><small>WebGL2 Interactive Preview</small></div>
      <section class="orb-presence-section" aria-label="Simulated orb presence">
        <div id="zetro-orb" class="orb-showcase" aria-hidden="true"></div>
        <div class="status-container">
          <strong id="state" class="state-thoughtline">Ready when you are</strong>
          <small id="description">Orb preview · no computer access</small>
        </div>
      </section>

      <p class="caption">The pointer and light represent simulated activity inside this page only.</p>
    </div>
  `;
}

export function mountComputerPreview(root = document) {
  const orbCanvas = root.querySelector('#zetro-orb');
  const stateEl = root.querySelector('#state');
  const orb = orbCanvas ? new ZetroOrb(orbCanvas, stateEl) : null;
  const pointer = root.querySelector('.pointer');
  const motionPreference = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: () => {}, removeEventListener: () => {} };

  let smartStatus = createSmartStatus();
  let currentSeq = 0;
  let statusPollTimer = null;

  let wakeTimer = null;
  let simulationTimer = null;
  let fadeTimer = null;
  let isSimulating = false;
  let currentTaskKey = 'create_folder';

  let frameId = 0;
  let lastTime = 0;
  let elapsed = 0;

  function syncSnapshot() {
    if (!smartStatus) return;
    const snap = smartStatus.getSnapshot();
    if (orb) {
      orb.setSnapshot(snap);
    }
  }

  function startStatusPolling() {
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = setInterval(syncSnapshot, 200);
  }

  function stopStatusPolling() {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  function cancelAllTimers() {
    stopStatusPolling();
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    if (simulationTimer) {
      clearTimeout(simulationTimer);
      simulationTimer = null;
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    isSimulating = false;
    updatePlayButton();
  }

  function updatePlayButton() {
    const playBtn = root.querySelector('#play-task');
    if (playBtn) {
      playBtn.textContent = isSimulating ? 'Stop simulation' : 'Play simulation';
      playBtn.dataset.playing = String(isSimulating);
    }
  }

  function setStatusText(primary, secondary, immediate = false) {
    const descEl = root.querySelector('#description');
    const container = root.querySelector('.status-container');
    if (!descEl) return;

    if (descEl.textContent === secondary) {
      return;
    }

    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }

    if (immediate || !container) {
      if (container) container.classList.remove('text-fading');
      descEl.textContent = secondary;
      return;
    }

    container.classList.add('text-fading');
    fadeTimer = setTimeout(() => {
      descEl.textContent = secondary;
      container.classList.remove('text-fading');
      fadeTimer = null;
    }, 140);
  }

  function setState(mode, overrideText = null, overrideDesc = null) {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }

    document.body.dataset.state = mode;
    root.querySelectorAll('[data-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });

    const entry = defaultLabels[mode] || defaultLabels.off;
    const primary = overrideText || entry[0];
    const secondary = overrideDesc || entry[1];
    const immediate = mode === 'stopped' || mode === 'paused';

    if (orb) orb.setState(mode, primary);
    syncMotion();

    setStatusText(primary, secondary, immediate);

    if (mode === 'activating' && !isSimulating) {
      wakeTimer = setTimeout(() => setState('thinking'), 500);
    }
  }

  function playTaskSimulation(taskKey) {
    cancelAllTimers();
    const fixture = SYNTHETIC_FIXTURES[taskKey] || SYNTHETIC_FIXTURES.create_folder;
    isSimulating = true;
    updatePlayButton();
    currentSeq = 0;

    smartStatus = createSmartStatus();
    startStatusPolling();

    let stepIdx = 0;
    function runStep() {
      if (!isSimulating) return;
      if (stepIdx >= fixture.steps.length) {
        cancelAllTimers();
        return;
      }

      const step = fixture.steps[stepIdx];
      currentSeq++;
      smartStatus.update({
        taskId: taskKey,
        sequence: currentSeq,
        phase: step.phase,
        intent: fixture.intent,
        actionType: step.actionType,
        verified: step.verified,
        stepId: step.stepId
      });

      const snap = smartStatus.getSnapshot();
      setState(step.mode, snap.text, step.desc);
      syncSnapshot();
      stepIdx++;

      simulationTimer = setTimeout(runStep, step.dwell);
    }

    runStep();
  }

  // --- MANUAL & INTERACTIVE CONTROLS ---

  const modeListeners = [];
  root.querySelectorAll('[data-mode]').forEach(button => {
    const handler = () => {
      cancelAllTimers();
      const mode = button.dataset.mode;
      const phase = mode === 'activating' ? 'intention' : mode;
      currentSeq++;
      if (smartStatus) {
        smartStatus.update({
          taskId: currentTaskKey || 'manual_explore',
          sequence: currentSeq,
          phase
        });
        syncSnapshot();
      }
      setState(mode);
    };
    button.addEventListener('click', handler);
    modeListeners.push({ button, handler });
  });

  const chipListeners = [];
  root.querySelectorAll('.task-chip').forEach(chip => {
    const handler = () => {
      const task = chip.dataset.task;
      if (task) {
        currentTaskKey = task;
        root.querySelectorAll('.task-chip').forEach(c => {
          c.setAttribute('aria-pressed', String(c === chip));
        });
        playTaskSimulation(currentTaskKey);
      }
    };
    chip.addEventListener('click', handler);
    chipListeners.push({ chip, handler });
  });

  const playBtn = root.querySelector('#play-task');
  const playHandler = () => {
    if (isSimulating) {
      cancelAllTimers();
      if (smartStatus) {
        smartStatus.update({
          taskId: currentTaskKey || 'manual_explore',
          sequence: ++currentSeq,
          phase: 'stopped'
        });
        syncSnapshot();
      }
      setState('stopped');
    } else {
      playTaskSimulation(currentTaskKey);
    }
  };
  if (playBtn) playBtn.addEventListener('click', playHandler);

  const motionSelect = root.querySelector('#motion') || document.querySelector('#motion');
  const motionHandler = event => {
    const quiet = event.target.value === 'quiet';
    document.body.classList.toggle('quiet', quiet);
    if (orb) orb.setQuiet(quiet);
    syncMotion();
  };
  if (motionSelect) motionSelect.addEventListener('change', motionHandler);

  const lightSelect = root.querySelector('#light') || document.querySelector('#light');
  const lightHandler = event => {
    document.body.classList.toggle('subtle', event.target.value === 'subtle');
  };
  if (lightSelect) lightSelect.addEventListener('change', lightHandler);

  function animatePointer(time) {
    if (!pointer) return;
    const dt = Math.min((time - lastTime) || 16, 40);
    lastTime = time;
    const acting = document.body.dataset.state === 'acting';
    const quiet = document.body.classList.contains('quiet') || motionPreference.matches;
    if (acting && !quiet) {
      elapsed += dt;
      const phase = elapsed / 1600;
      pointer.style.transform = `translate(${-65 + Math.cos(phase) * 65}px,${24 + Math.sin(phase * 0.8) * 24}px)`;
    } else {
      lastTime = 0;
      elapsed = 0;
      pointer.style.transform = 'none';
    }
    frameId = acting && !quiet ? requestAnimationFrame(animatePointer) : 0;
  }

  function syncMotion() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastTime = 0;
    animatePointer(performance.now());
  }

  if (motionPreference.addEventListener) {
    motionPreference.addEventListener('change', syncMotion);
  }

  // Initial state
  setState('off');

  return {
    destroy() {
      cancelAllTimers();
      cancelAnimationFrame(frameId);
      if (motionPreference.removeEventListener) {
        motionPreference.removeEventListener('change', syncMotion);
      }
      modeListeners.forEach(({ button, handler }) => button.removeEventListener('click', handler));
      chipListeners.forEach(({ chip, handler }) => chip.removeEventListener('click', handler));
      if (playBtn) playBtn.removeEventListener('click', playHandler);
      if (motionSelect) motionSelect.removeEventListener('change', motionHandler);
      if (lightSelect) lightSelect.removeEventListener('change', lightHandler);
      if (smartStatus) smartStatus.close();
      if (orb) orb.destroy();
      document.body.removeAttribute('data-state');
    }
  };
}

// Standalone fallback: if loaded on /computer-preview/ directly without SPA shell
if (typeof document !== 'undefined' && window.location.pathname.startsWith('/computer-preview')) {
  let standaloneController = null;
  let dock = null;

  const initStandalone = () => {
    standaloneController = mountComputerPreview(document);
    const dockRoot = document.querySelector('#dock-root');
    if (dockRoot && !dock) {
      dock = mountDock(dockRoot, {
        initialView: 'computer'
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStandalone);
  } else {
    initStandalone();
  }

  window.addEventListener('pagehide', () => {
    if (standaloneController) standaloneController.destroy();
    if (dock) dock.destroy();
  });
}
