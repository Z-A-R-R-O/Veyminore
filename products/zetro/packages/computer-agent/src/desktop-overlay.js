import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AuthoritativeOverlayBridge } from './overlay-bridge.js';

// This process draws only. It cannot capture the desktop or inject input.
export function createDesktopOverlay({
  sessionId, expiresAt, intent = null, enabled = false, reducedMotion = false,
  spawnImpl = spawn, onStopRequested = () => {},
  helperPath = fileURLToPath(new URL('../native-overlay/ZetroAccessOverlay.exe', import.meta.url))
} = {}) {
  if (typeof sessionId !== 'string' || !/^[\w-]{1,128}$/.test(sessionId)) {
    throw new Error('Overlay requires exact session ID');
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Overlay requires finite future expiry');
  }
  let child = null;
  let heartbeat = null;
  let current = null;
  let stopped = false;
  let intentionalStop = false;
  let noRespawn = false;
  let callbackFired = false;

  function notifyStop(reason) {
    if (callbackFired) return;
    callbackFired = true;
    try {
      onStopRequested(reason);
    } catch {
      // Prevent listener errors from interfering with cleanup
    }
  }

  function requestStop(reason) {
    if (stopped) return;
    stopped = true;
    intentionalStop = true;
    noRespawn = true;
    stopChild();
    notifyStop(reason);
  }

  function stopChild() {
    const closing = child;
    child = null;
    clearInterval(heartbeat);
    if (!closing) return;
    try {
      if (closing.stdin && typeof closing.stdin.end === 'function') {
        closing.stdin.end();
      }
    } catch {}
    const deadline = setTimeout(() => {
      if (closing.exitCode === null && typeof closing.kill === 'function') {
        closing.kill();
      }
    }, 1000);
    deadline.unref?.();
    closing.once?.('exit', () => clearTimeout(deadline));
  }

  function send() {
    const writing = child;
    if (!writing || !current || stopped) return;
    if (!writing.stdin?.writable) {
      if (child === writing) {
        requestStop('Native overlay write failed');
      }
      return;
    }
    try {
      const line = JSON.stringify({ ...current, reducedMotion }) + '\n';
      writing.stdin.write(line, (err) => {
        if (child !== writing) return;
        if (err && !stopped && !intentionalStop) {
          requestStop(err.message || 'Native overlay write failed');
        }
      });
    } catch (err) {
      if (child !== writing) return;
      requestStop(err?.message || 'Native overlay write failed');
    }
  }

  const bridge = new AuthoritativeOverlayBridge({
    sessionId, expiresAt, intent,
    emitEvent(_type, event) {
      current = event;
      if (['stopped', 'expired', 'disconnected'].includes(event.state)) {
        intentionalStop = true;
        stopped = true;
        noRespawn = true;
        stopChild();
        return;
      }
      if (event.auraActive && enabled && !child && !stopped && !noRespawn) {
        validateDisplay(event.controlledDisplay);
        const launched = spawnImpl(helperPath, ['--session', sessionId], {
          stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false
        });
        child = launched;
        const disconnected = () => {
          if (child !== launched || intentionalStop || stopped) return;
          requestStop('Native overlay disconnected');
        };
        let output = '';
        launched.stdout?.on('data', chunk => {
          output += chunk.toString();
          if (output.length > 16384) { requestStop('Invalid overlay output'); return; }
          let newline;
          while ((newline = output.indexOf('\n')) >= 0) {
            const line = output.slice(0, newline); output = output.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (message.event === 'stop_requested') requestStop(message.reason);
            } catch { requestStop('Invalid overlay event'); }
          }
        });
        launched.once?.('error', disconnected);
        launched.once?.('exit', disconnected);
        launched.stdin?.on?.('error', () => {
          if (child !== launched || intentionalStop || stopped) return;
          requestStop('Native overlay write failed');
        });
        heartbeat = setInterval(send, 1000);
        heartbeat.unref?.();
      }
      send();
      if (!event.auraActive) stopChild();
    }
  });
  if (bridge.intent === undefined) {
    bridge.intent = intent;
  }

  const originalClose = bridge.close.bind(bridge);
  bridge.close = () => {
    intentionalStop = true;
    stopped = true;
    noRespawn = true;
    stopChild();
    originalClose();
  };

  return bridge;
}

function validateDisplay(display) {
  if (!display || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(display[key])) ||
      display.width < 100 || display.height < 100 || display.width > 16384 || display.height > 16384) {
    throw new Error('Native overlay requires exact display bounds');
  }
}
