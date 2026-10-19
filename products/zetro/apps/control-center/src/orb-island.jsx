import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import MagicRings from './components/MagicRings.jsx';
import ThoughtLine from './components/ThoughtLine.jsx';
import { createSmartStatus } from '../../../packages/computer-agent/src/smart-status.js';

export { createSmartStatus };

function OrbWrapper({ initialMode = 'off', initialQuiet = false, onMount }) {
  const [mode, setMode] = useState(initialMode);
  const [quiet, setQuiet] = useState(initialQuiet);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (mq) {
      setReducedMotion(mq.matches);
      const onMotionChange = e => setReducedMotion(e.matches);
      mq.addEventListener('change', onMotionChange);
      return () => mq.removeEventListener('change', onMotionChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (onMount) {
      onMount({
        setState: newMode => setMode(newMode),
        setQuiet: isQuiet => setQuiet(isQuiet)
      });
    }
  }, [onMount]);

  // Paused / stopped / quiet / reducedmotion MUST freeze:
  // speed=0, spin=0, expansion=0, and disable pointer reactions (followMouse=false, hoverScale=1.0, clickBurst=false, hoverIntensity=0)
  const isFrozen = mode === 'paused' || mode === 'stopped' || quiet || reducedMotion;
  const isActionOrThinking = mode === 'acting' || mode === 'thinking' || mode === 'activating' || mode === 'observing';
  const motion = isActionOrThinking ? 'pulse' : 'breathe';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MagicRings
        theme="light"
        color="#303b51"
        colorTwo="#68758d"
        motion={motion}
        ringCount={6}
        speed={isFrozen ? 0 : 1}
        lineThickness={2.2}
        glow={0.7}
        taper={1.15}
        expansion={isFrozen ? 0 : 0.1}
        spin={0}
        hoverScale={isFrozen ? 1.0 : 1.2}
        hoverIntensity={isFrozen ? 0 : 1}
        parallax={isFrozen ? 0 : 0.05}
        mouseInfluence={isFrozen ? 0 : 0.2}
        clickBurst={!isFrozen}
        followMouse={!isFrozen}
        intro={!isFrozen}
      />
    </div>
  );
}

function ThoughtLineWrapper({ initialSnapshot = null, onMount }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot || {
    phase: 'off',
    text: 'Ready when you are',
    working: false,
    elapsedMs: 0,
    verifiedSteps: [],
    currentStep: null,
    intent: null,
    settledReason: null
  });

  const stepsHistoryRef = useRef([]);
  const lastTaskIdRef = useRef(null);

  useEffect(() => {
    if (onMount) {
      onMount({
        setSnapshot: s => setSnapshot(s)
      });
    }
  }, [onMount]);

  const {
    taskId = null,
    phase = 'off',
    text = 'Ready when you are',
    working = false,
    elapsedMs = 0,
    verifiedSteps = [],
    currentStep = null,
    intent = null,
    settledReason = null
  } = snapshot;

  // 1. Primary Line: Lifecycle state only (calm product language)
  let primaryLabel = 'Ready when you are';
  if (working) {
    primaryLabel = 'Working…';
  } else if (settledReason === 'completed' || phase === 'completed') {
    primaryLabel = 'Done';
  } else if (settledReason === 'paused' || phase === 'paused') {
    primaryLabel = 'Paused';
  } else if (settledReason === 'stopped' || phase === 'stopped' || settledReason === 'cancelled') {
    primaryLabel = 'Stopped';
  } else if (settledReason === 'blocked' || settledReason === 'failed' || settledReason === 'uncertain') {
    primaryLabel = 'Needs attention';
  } else if (phase === 'off') {
    primaryLabel = 'Ready when you are';
  }

  // 2. Done label for settled state
  const doneLabel = primaryLabel;

  // 3. Smart subtext: quieter task-specific message
  let smartSubtext = null;
  if (working) {
    smartSubtext = text && text !== 'Working…' ? text : null;
  } else if (settledReason === 'completed' || phase === 'completed') {
    if (intent && intent.targetLabel) {
      smartSubtext = `\u2018${intent.targetLabel}\u2019 is ready.`;
    } else if (text && text !== 'Done' && text !== 'Task verified and completed') {
      smartSubtext = text;
    } else {
      smartSubtext = 'Task completed.';
    }
  } else if (settledReason === 'stopped' || phase === 'stopped' || settledReason === 'cancelled') {
    smartSubtext = 'Session stopped.';
  } else if (settledReason === 'paused' || phase === 'paused') {
    smartSubtext = 'Waiting to resume.';
  } else if (settledReason === 'blocked' || settledReason === 'failed' || settledReason === 'uncertain') {
    smartSubtext = text || 'Action could not be verified.';
  }

  // 4. Cumulative trace steps accumulation
  if (taskId !== lastTaskIdRef.current) {
    lastTaskIdRef.current = taskId;
    stepsHistoryRef.current = [];
  }

  if (working && currentStep && currentStep.text) {
    const stepText = currentStep.text;
    if (!stepsHistoryRef.current.includes(stepText)) {
      stepsHistoryRef.current.push(stepText);
    }
  } else if (working && smartSubtext && !stepsHistoryRef.current.includes(smartSubtext)) {
    stepsHistoryRef.current.push(smartSubtext);
  }

  for (const step of verifiedSteps) {
    if (step && step.text && !stepsHistoryRef.current.includes(step.text)) {
      stepsHistoryRef.current.push(step.text);
    }
  }

  if (!working && (settledReason === 'completed' || phase === 'completed') && smartSubtext) {
    if (!stepsHistoryRef.current.includes(smartSubtext)) {
      stepsHistoryRef.current.push(smartSubtext);
    }
  }

  const traceSteps = [...stepsHistoryRef.current];
  const hasSteps = traceSteps.length > 0;

  const isDoneState = !working && (settledReason === 'completed' || phase === 'completed' || primaryLabel === 'Done');
  const isTerminalOrUrgent = settledReason === 'stopped' || phase === 'stopped' || settledReason === 'cancelled';
  const settleDuration = isTerminalOrUrgent ? 0 : 350;
  const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : undefined;
  const showTimer = working || (elapsedMs > 0 && phase !== 'off');

  return (
    <div className="thoughtline-presence-block">
      {/* Single ThoughtLine: lifecycle label + timer + chevron + steps trace */}
      <ThoughtLine
        working={working}
        label={primaryLabel}
        doneLabel={doneLabel}
        glyph="none"
        steps={traceSteps}
        collapsible={hasSteps}
        collapseOnSettle={isDoneState}
        collapseDelay={1000}
        showTimer={showTimer}
        elapsed={working ? undefined : elapsedSeconds}
        fontSize={15}
        color="#1c1e1c"
        breathPeriod={2.0}
        shimmerDuration={2.2}
        settleDuration={settleDuration}
        settleAfter={0}
      />

      {/* Quiet subline: only show when there is no step trace, eliminating duplicate details */}
      {!hasSteps && smartSubtext ? (
        <div className="thoughtline-subtext" aria-hidden="true">
          <span className="subtext-content">{smartSubtext}</span>
        </div>
      ) : null}
    </div>
  );
}

export class ZetroOrb {
  constructor(container, statusContainer = (typeof document !== 'undefined' ? document.querySelector('#state') : null)) {
    this.container = container;
    this.statusContainer = statusContainer;
    this.orbRoot = null;
    this.statusRoot = null;
    this.orbController = null;
    this.statusController = null;
    this.pendingMode = 'off';
    this.pendingQuiet = false;
    this.init();
  }

  init() {
    if (this.container) {
      this.orbRoot = createRoot(this.container);
      this.orbRoot.render(
        <OrbWrapper
          initialMode={this.pendingMode}
          initialQuiet={this.pendingQuiet}
          onMount={c => {
            this.orbController = c;
            if (this.pendingMode !== 'off') c.setState(this.pendingMode);
            if (this.pendingQuiet) c.setQuiet(this.pendingQuiet);
          }}
        />
      );
    }
    const statusTarget = this.statusContainer || (typeof document !== 'undefined' ? document.querySelector('#state') : null);
    if (statusTarget) {
      this.statusRoot = createRoot(statusTarget);
      this.statusRoot.render(
        <ThoughtLineWrapper
          onMount={c => {
            this.statusController = c;
          }}
        />
      );
    }
  }

  setSnapshot(snapshot) {
    if (this.statusController) this.statusController.setSnapshot(snapshot);
    if (this.orbController && snapshot.phase) {
      this.orbController.setState(snapshot.phase);
    }
  }

  setState(mode, text = null) {
    this.pendingMode = mode;
    if (this.orbController) this.orbController.setState(mode);
    if (this.statusController) {
      const isWorking = mode === 'activating' || mode === 'thinking' || mode === 'observing' || mode === 'acting';
      const isSettled = mode === 'stopped' || mode === 'paused' || mode === 'completed';
      this.statusController.setSnapshot({
        phase: mode,
        text: text || (mode === 'stopped' ? 'Stopped' : mode === 'paused' ? 'Paused' : 'Ready when you are'),
        working: isWorking,
        elapsedMs: 0,
        verifiedSteps: [],
        currentStep: null,
        settledReason: isSettled ? mode : null
      });
    }
  }

  setStatusText(text) {
    if (this.statusController && text) {
      const isWorking = this.pendingMode === 'activating' || this.pendingMode === 'thinking' || this.pendingMode === 'observing' || this.pendingMode === 'acting';
      const isSettled = this.pendingMode === 'stopped' || this.pendingMode === 'paused' || this.pendingMode === 'completed';
      this.statusController.setSnapshot({
        phase: this.pendingMode,
        text,
        working: isWorking,
        elapsedMs: 0,
        verifiedSteps: [],
        currentStep: null,
        settledReason: isSettled ? this.pendingMode : null
      });
    }
  }

  setQuiet(quiet) {
    this.pendingQuiet = quiet;
    if (this.orbController) this.orbController.setQuiet(quiet);
  }

  destroy() {
    if (this.orbRoot) {
      this.orbRoot.unmount();
      this.orbRoot = null;
      this.orbController = null;
    }
    if (this.statusRoot) {
      this.statusRoot.unmount();
      this.statusRoot = null;
      this.statusController = null;
    }
  }
}
