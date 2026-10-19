/**
 * @zetro/computer-windows-provider - Observer Compatibility Adapter
 *
 * Plugs the Windows native process runner port and honest capture backend into
 * @zetro/computer-observer's createObserver without requiring any sibling edits.
 */

import { createObserver as defaultCreateObserver } from '../../computer-observer/src/index.js';
import { createWindowsProcessRunner } from './process-runner.js';
import { createWindowsCaptureBackend } from './capture-backend.js';
import { parseHelperInspectOutput } from './protocol.js';

/**
 * Creates an Observer instance backed by the Windows native provider.
 *
 * @param {object} [options]
 * @param {string} [options.helperPath] Path to the compiled ZetroWindowHelper executable.
 * @param {Function} [options.execFileImpl] Injected execFile implementation for testing.
 * @param {object} [options.captureBackend] Optional capture backend; defaults to unsupported Windows capture.
 * @param {Function} [options.createObserverImpl] Injected createObserver factory; defaults to @zetro/computer-observer.
 * @param {number} [options.maxWindows]
 * @param {number} [options.maxTitleChars]
 * @param {number} [options.maxResponseBytes]
 * @param {number} [options.maxAgeMs]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.includeTitles]
 * @param {Function} [options.clock]
 * @returns {import('@zetro/computer-observer').Observer & {
 *   processRunner: object,
 *   captureBackend: object,
 *   inspectWindow(hwnd: number, opts?: object): Promise<object>
 * }}
 */
export function createWindowsObserver(options = {}) {
  const {
    helperPath,
    execFileImpl,
    captureBackend: customCaptureBackend,
    createObserverImpl = defaultCreateObserver,
    ...observerOptions
  } = options;

  const runner = createWindowsProcessRunner({
    helperPath,
    execFileImpl,
    timeoutMs: observerOptions.timeoutMs,
    maxResponseBytes: observerOptions.maxResponseBytes,
    includeTitles: observerOptions.includeTitles
  });

  const capture = customCaptureBackend || createWindowsCaptureBackend();

  const observer = createObserverImpl({
    processRunner: runner,
    captureBackend: capture,
    ...observerOptions
  });

  return {
    ...observer,
    processRunner: runner,
    captureBackend: capture,

    /**
     * Extended Windows native inspection: retrieves exact bounds, DPI,
     * and UI Automation metadata for a specific HWND.
     */
    async inspectWindow(hwnd, opts = {}) {
      const res = await runner.inspect(hwnd, opts);
      return parseHelperInspectOutput(res.stdout, { clockNow: observerOptions.clock ? observerOptions.clock() : Date.now() });
    },

    /**
     * Reads text from a target window's edit or document control via native UIAutomation or Win32 edit message.
     */
    async readText(hwnd, opts = {}) {
      return await runner.readText(hwnd, opts);
    },

    /**
     * Writes text to a target window's edit or document control with strict policy authorization.
     */
    async writeText(hwnd, text, opts = {}) {
      return await runner.writeText(hwnd, text, opts);
    }
  };
}
