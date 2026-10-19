/**
 * @zetro/computer-windows-provider - Bounded Process Runner Port
 *
 * Implements the ProcessRunner interface for @zetro/computer-observer.
 * Spawns the native helper executable via safe, non-shell child process execution
 * with strict byte limits, execution timeouts, and cancellation signals.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildHelperEnumerateArgs,
  buildHelperInspectArgs,
  buildHelperReadTextArgs,
  parseHelperReadTextOutput,
  buildHelperWriteTextArgs,
  parseHelperWriteTextOutput,
  buildHelperMouseActionArgs,
  parseHelperMouseActionOutput,
  buildHelperPressKeysArgs,
  parseHelperPressKeysOutput,
  buildHelperCaptureScreenArgs,
  parseHelperCaptureScreenOutput
} from './protocol.js';

const execFileAsync = promisify(execFile);

export class ProcessRunnerError extends Error {
  constructor(message, { code = 'RUNNER_ERROR', cause = null, details = {} } = {}) {
    super(message);
    this.name = 'ProcessRunnerError';
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}

/**
 * Creates an instance of the bounded Windows process runner port.
 *
 * @param {object} [options]
 * @param {string} [options.helperPath] Path to the compiled native helper executable.
 * @param {Function} [options.execFileImpl] Injected execFile implementation for testing.
 * @param {number} [options.timeoutMs=5000] Default execution timeout in milliseconds.
 * @param {number} [options.maxResponseBytes=65536] Maximum allowed stdout buffer size.
 * @param {boolean} [options.includeTitles=false] Whether to ask helper for window titles.
 * @returns {{
 *   run(spec: object, opts?: { signal?: AbortSignal }): Promise<{ ok: boolean, stdout: string, stderr: string }>,
 *   inspect(hwnd: number, opts?: { signal?: AbortSignal, timeoutMs?: number }): Promise<{ ok: boolean, stdout: string, stderr: string }>,
 *   readText(hwnd: number, opts?: object): Promise<object>,
 *   writeText(hwnd: number, text: string, opts: object): Promise<object>
 * }}
 */
export function createWindowsProcessRunner(options = {}) {
  const {
    helperPath = 'helper/ZetroWindowHelper.exe',
    execFileImpl = execFileAsync,
    timeoutMs: defaultTimeoutMs = 5000,
    maxResponseBytes = 65536,
    includeTitles = false
  } = options;

  async function execute(args, { signal, timeoutMs = defaultTimeoutMs } = {}) {
    if (signal?.aborted) {
      const abortErr = new Error('Process runner execution aborted prior to spawn');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // Strictly enforce non-shell execution and bounded buffer limits
    const execOptions = {
      shell: false,
      timeout: timeoutMs,
      maxBuffer: maxResponseBytes,
      signal,
      windowsHide: true,
      encoding: 'utf8'
    };

    try {
      const result = await execFileImpl(helperPath, args, execOptions);
      return {
        ok: true,
        stdout: typeof result?.stdout === 'string' ? result.stdout : '',
        stderr: typeof result?.stderr === 'string' ? result.stderr : ''
      };
    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') {
        const abortErr = new Error('Process runner execution cancelled');
        abortErr.name = 'AbortError';
        abortErr.cause = err;
        throw abortErr;
      }

      if (err.code === 'ETIMEDOUT' || err.killed) {
        throw new ProcessRunnerError(`Process runner timed out after ${timeoutMs}ms`, {
          code: 'OBSERVER_TIMEOUT',
          cause: err,
          details: { timeoutMs, args }
        });
      }

      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        throw new ProcessRunnerError(`Process runner response exceeded maxResponseBytes (${maxResponseBytes})`, {
          code: 'RESPONSE_TOO_LARGE',
          cause: err,
          details: { maxResponseBytes, args }
        });
      }

      const stderrMsg = typeof err.stderr === 'string' ? err.stderr.trim() : '';
      let errorCode = err.code || 'PROCESS_EXEC_FAILED';
      if (err.status === 10 || err.code === 10 || stderrMsg.includes('Input is disabled by policy')) {
        errorCode = 'INPUT_DISABLED';
      } else if (err.status === 11 || err.code === 11 || stderrMsg.includes('grant expired')) {
        errorCode = 'GRANT_EXPIRED';
      } else if (err.status === 3 || err.code === 3 || stderrMsg.includes('Target window not found')) {
        errorCode = 'WINDOW_NOT_FOUND';
      } else if (err.status === 4 || err.code === 4 || stderrMsg.includes('PID mismatch') || stderrMsg.includes('Missing or invalid expectedPid')) {
        errorCode = 'PID_MISMATCH';
      } else if (err.status === 5 || err.code === 5 || stderrMsg.includes('Start identity mismatch') || stderrMsg.includes('Target identity changed') || stderrMsg.includes('Missing or empty expectedStart')) {
        errorCode = 'IDENTITY_MISMATCH';
      } else if (err.status === 6 || err.code === 6 || stderrMsg.includes('visible') || stderrMsg.includes('minimized')) {
        errorCode = 'WINDOW_STATE_INVALID';
      } else if (err.status === 7 || err.code === 7 || stderrMsg.includes('foreground')) {
        errorCode = 'FOREGROUND_VERIFICATION_FAILED';
      } else if (err.status === 8 || err.code === 8 || stderrMsg.includes('SendInput failed')) {
        errorCode = 'INPUT_INJECTION_FAILED';
      } else if (err.status === 12 || err.code === 12 || stderrMsg.includes('sessionId')) {
        errorCode = 'SESSION_REQUIRED';
      } else if (err.status === 13 || err.code === 13 || stderrMsg.includes('Human interruption')) {
        errorCode = 'HUMAN_TAKEOVER_INTERRUPTED';
      } else if (err.status === 14 || err.code === 14 || stderrMsg.includes('uncertain') || stderrMsg.includes('ValuePattern invocation failed')) {
        errorCode = 'UIA_UNCERTAIN_FAILURE';
      } else if (err.status === 20 || err.code === 20 || stderrMsg.includes('Screen capture failed')) {
        errorCode = 'CAPTURE_FAILED';
      }

      throw new ProcessRunnerError(`Process runner execution failed: ${stderrMsg || err.message}`, {
        code: errorCode,
        cause: err,
        details: { args, exitCode: err.code ?? err.status, stderr: stderrMsg }
      });
    }
  }

  return {
    /**
     * Implements ProcessRunner.run(spec, { signal }) required by @zetro/computer-observer.
     */
    async run(spec, { signal } = {}) {
      if (!spec || typeof spec !== 'object') {
        throw new ProcessRunnerError("Runner spec must be a non-null object with kind: 'enumerate'", {
          code: 'REQUEST_INVALID'
        });
      }

      if (spec.kind !== 'enumerate') {
        throw new ProcessRunnerError(`Unsupported runner spec kind: '${spec.kind}' (only 'enumerate' supported)`, {
          code: 'REQUEST_INVALID'
        });
      }

      const limit = spec.limit || spec.maxWindows || 256;
      const args = buildHelperEnumerateArgs({ limit, includeTitles });
      return await execute(args, { signal });
    },

    /**
     * Inspects a specific window HWND with bounds, DPI, and UI Automation metadata.
     */
    async inspect(hwnd, { signal, timeoutMs } = {}) {
      const args = buildHelperInspectArgs(hwnd);
      return await execute(args, { signal, timeoutMs });
    },

    /**
     * Reads actual text from a target window's edit or document control using native
     * UIAutomation (ValuePattern/TextPattern) or Win32 edit message.
     * Strictly independent readback; never echoes supplied text.
     *
     * @param {number} hwnd Window handle.
     * @param {object} [options]
     * @param {number} [options.expectedPid] Expected process ID.
     * @param {string} [options.expectedStart] Expected start generation token.
     * @param {AbortSignal} [options.signal] Cancellation signal.
     * @param {number} [options.timeoutMs] Timeout in ms.
     * @returns {Promise<{ status: 'read', hwnd: number, processId: number, method: string, text: string, charCount: number }>}
     */
    async readText(hwnd, options = {}) {
      const args = buildHelperReadTextArgs(hwnd, options);
      const res = await execute(args, { signal: options.signal, timeoutMs: options.timeoutMs });
      return parseHelperReadTextOutput(res.stdout);
    },

    /**
     * Writes text to a target window's edit or document control using native UIAutomation
     * (ValuePattern.SetValue) or scoped foreground SendInput (KEYEVENTF_UNICODE).
     * Fails closed if input is not explicitly enabled or grant has expired.
     * Zero clipboard manipulation, zero shell execution.
     *
     * @param {number} hwnd Window handle.
     * @param {string} text Text to write.
     * @param {object} options Authorization and targeting options.
     * @param {number} [options.expectedPid] Expected process ID.
     * @param {string} [options.expectedStart] Expected start generation token.
     * @param {string} [options.sessionId] Authorization session ID.
     * @param {number} options.grantExpiry Timestamp (ms) when authorization grant expires.
     * @param {boolean} options.inputEnabled Explicit authorization flag (default false; fails closed).
     * @param {AbortSignal} [options.signal] Cancellation signal.
     * @param {number} [options.timeoutMs] Timeout in ms.
     * @returns {Promise<{ status: 'written', hwnd: number, processId: number, method: string, charsWritten: number }>}
     */
    async writeText(hwnd, text, options = {}) {
      const args = buildHelperWriteTextArgs(hwnd, text, options);
      const res = await execute(args, { signal: options.signal, timeoutMs: options.timeoutMs });
      return parseHelperWriteTextOutput(res.stdout);
    },

    /**
     * Executes a mouse action (click, move, drag, scroll) with hardware scan codes.
     *
     * @param {object} spec Mouse action specification.
     * @param {object} [options] Execution options.
     * @returns {Promise<{ status: 'completed', action: 'mouse-action', type: string, x: number, y: number }>}
     */
    async explorerWindows(options = {}) {
      return await execute(['--enumerate', '--explorer-windows', '--limit', '32'], options);
    },

    async downloadsPath(options = {}) {
      const result = await execute(['--downloads-path'], options);
      const parsed = JSON.parse(result.stdout);
      if (typeof parsed.path !== 'string' || !parsed.path) throw new ProcessRunnerError('Missing Downloads known-folder path');
      return parsed.path;
    },

    async explorerState(hwnd, identity, options = {}) {
      const args = ['--explorer-state', String(hwnd), '--expected-pid', String(identity.processId), '--expected-start', identity.generation];
      const result = await execute(args, options);
      const parsed = JSON.parse(result.stdout);
      if (parsed.status !== 'explorer_state' || parsed.window?.hwnd !== hwnd ||
          parsed.window.processId !== identity.processId || parsed.window.generation !== identity.generation) {
        throw new ProcessRunnerError('Explorer target identity mismatch');
      }
      return parsed;
    },

    async focusWindow(hwnd, options) {
      const args = buildHelperWriteTextArgs(hwnd, 'validation-only', options);
      args.splice(0, 4, '--focus-window', String(hwnd));
      if (options.expectedLocation) args.push('--expected-location', options.expectedLocation);
      const result = await execute(args, options);
      const parsed = JSON.parse(result.stdout);
      if (parsed.status !== 'focused') throw new ProcessRunnerError('Target focus failed');
      return parsed;
    },

    async typeFocusedText(hwnd, text, options) {
      const args = buildHelperWriteTextArgs(hwnd, text, options);
      args.splice(0, 2, '--type-text', '--hwnd', String(hwnd));
      if (!options.expectedFocusClass) throw new ProcessRunnerError('An observed focus class is required for focused typing');
      args.push('--expected-focus-class', options.expectedFocusClass);
      if (options.expectedLocation) args.push('--expected-location', options.expectedLocation);
      const result = await execute(args, options);
      const parsed = JSON.parse(result.stdout);
      if (parsed.status !== 'completed' || parsed.charsTyped !== text.length) throw new ProcessRunnerError('Focused text outcome uncertain');
      return parsed;
    },

    async mouseAction(spec, options = {}) {
      const args = buildHelperMouseActionArgs(spec);
      const res = await execute(args, { signal: options.signal, timeoutMs: options.timeoutMs });
      return parseHelperMouseActionOutput(res.stdout);
    },

    /**
     * Executes a key press chord or sequence.
     *
     * @param {object} spec Press keys specification.
     * @param {object} [options] Execution options.
     * @returns {Promise<{ status: 'completed', action: 'press-keys', keys: string, count: number }>}
     */
    async pressKeys(spec, options = {}) {
      const args = buildHelperPressKeysArgs(spec);
      const res = await execute(args, { signal: options.signal, timeoutMs: options.timeoutMs });
      return parseHelperPressKeysOutput(res.stdout);
    },

    /**
     * Captures the full desktop screen.
     *
     * @param {object} [spec] Capture options (e.g. outputFile).
     * @param {object} [options] Execution options.
     * @returns {Promise<{ status: 'captured', bounds: { x: number, y: number, width: number, height: number }, outputFile?: string, base64?: string }>}
     */
    async captureScreen(spec = {}, options = {}) {
      const args = buildHelperCaptureScreenArgs(spec);
      const res = await execute(args, { signal: options.signal, timeoutMs: options.timeoutMs });
      return parseHelperCaptureScreenOutput(res.stdout);
    }
  };
}
