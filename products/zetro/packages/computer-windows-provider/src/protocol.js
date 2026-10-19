/**
 * @zetro/computer-windows-provider - Structured JSON Protocol
 *
 * Enforces exact schema validation for communications between the Node.js
 * runner port and the native Windows helper process.
 */

export class ProtocolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.details = details;
  }
}

/**
 * Validates and parses raw JSON output from the helper's --enumerate command.
 *
 * @param {string} stdout Raw stdout string from helper.
 * @param {object} [options]
 * @param {number} [options.clockNow] Current timestamp for future verification check.
 * @param {number} [options.maxWindows=256] Max window records allowed.
 * @returns {{
 *   generation: string,
 *   observedAt: number,
 *   windows: Array<{
 *     hwnd: number,
 *     processId: number,
 *     processName: string,
 *     minimized: boolean,
 *     visible: boolean,
 *     generation: string,
 *     title: string,
 *     bounds: { x: number, y: number, width: number, height: number },
 *     dpi: number
 *   }>
 * }}
 */
export function parseHelperEnumerateOutput(stdout, { clockNow = Date.now(), maxWindows = 256 } = {}) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolError('Helper enumerate payload must be a non-null plain object');
  }

  if (typeof parsed.generation !== 'string' || parsed.generation.trim() === '') {
    throw new ProtocolError("Helper payload missing valid 'generation' string");
  }

  if (typeof parsed.observedAt !== 'number' || !Number.isFinite(parsed.observedAt) || parsed.observedAt <= 0) {
    throw new ProtocolError("Helper payload missing valid 'observedAt' timestamp number");
  }

  if (parsed.observedAt > clockNow) {
    throw new ProtocolError(`Helper payload observedAt (${parsed.observedAt}) is in the future (clockNow=${clockNow})`);
  }

  if (!Array.isArray(parsed.windows)) {
    throw new ProtocolError("Helper payload missing valid 'windows' array");
  }

  const windows = [];
  for (let i = 0; i < parsed.windows.length; i++) {
    const raw = parsed.windows[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue; // Skip invalid entries
    }

    const hwnd = typeof raw.hwnd === 'number' && Number.isSafeInteger(raw.hwnd) && raw.hwnd > 0
      ? raw.hwnd
      : typeof raw.hwnd === 'string' && /^\d+$/.test(raw.hwnd.trim())
        ? Number(raw.hwnd.trim())
        : null;

    if (!hwnd || hwnd <= 0) continue;

    const processId = raw.processId;
    if (typeof processId !== 'number' || !Number.isSafeInteger(processId) || processId <= 0) continue;

    if (typeof raw.minimized !== 'boolean' || typeof raw.visible !== 'boolean') continue;

    const generation = typeof raw.generation === 'string' && raw.generation.trim() !== ''
      ? raw.generation.trim()
      : typeof raw.generation === 'number'
        ? String(raw.generation)
        : null;

    if (!generation) continue;

    const processName = typeof raw.processName === 'string' ? raw.processName.slice(0, 64) : 'unknown';
    const title = typeof raw.title === 'string' ? raw.title.slice(0, 512) : '';

    const bounds = raw.bounds && typeof raw.bounds === 'object'
      ? {
          x: Number.isFinite(raw.bounds.x) ? Math.trunc(raw.bounds.x) : 0,
          y: Number.isFinite(raw.bounds.y) ? Math.trunc(raw.bounds.y) : 0,
          width: Number.isFinite(raw.bounds.width) ? Math.max(0, Math.trunc(raw.bounds.width)) : 0,
          height: Number.isFinite(raw.bounds.height) ? Math.max(0, Math.trunc(raw.bounds.height)) : 0
        }
      : { x: 0, y: 0, width: 0, height: 0 };

    const dpi = typeof raw.dpi === 'number' && Number.isFinite(raw.dpi) && raw.dpi > 0
      ? Math.trunc(raw.dpi)
      : 96;

    windows.push({
      hwnd,
      processId,
      processName,
      minimized: raw.minimized,
      visible: raw.visible,
      generation,
      title,
      bounds,
      dpi
    });

    if (windows.length >= maxWindows) break;
  }

  return {
    generation: parsed.generation,
    observedAt: parsed.observedAt,
    windows
  };
}

/**
 * Validates and parses raw JSON output from the helper's --inspect command.
 */
export function parseHelperInspectOutput(stdout, { clockNow = Date.now() } = {}) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper inspect stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'inspected') {
    throw new ProtocolError("Helper inspect payload must have status 'inspected'");
  }

  if (!parsed.window || typeof parsed.window !== 'object') {
    throw new ProtocolError("Helper inspect payload missing 'window' object");
  }

  const w = parsed.window;
  const hwnd = typeof w.hwnd === 'number' && Number.isSafeInteger(w.hwnd) && w.hwnd > 0 ? w.hwnd : null;
  if (!hwnd) throw new ProtocolError("Helper inspect window missing valid 'hwnd'");

  const processId = typeof w.processId === 'number' && Number.isSafeInteger(w.processId) && w.processId > 0 ? w.processId : null;
  if (!processId) throw new ProtocolError("Helper inspect window missing valid 'processId'");

  return {
    status: 'inspected',
    window: {
      hwnd,
      processId,
      processName: typeof w.processName === 'string' ? w.processName : 'unknown',
      minimized: Boolean(w.minimized),
      visible: Boolean(w.visible),
      generation: String(w.generation || `${hwnd}:${processId}`),
      title: typeof w.title === 'string' ? w.title : '',
      bounds: w.bounds && typeof w.bounds === 'object'
        ? {
            x: Number(w.bounds.x) || 0,
            y: Number(w.bounds.y) || 0,
            width: Number(w.bounds.width) || 0,
            height: Number(w.bounds.height) || 0
          }
        : { x: 0, y: 0, width: 0, height: 0 },
      dpi: Number(w.dpi) || 96
    },
    automation: parsed.automation && typeof parsed.automation === 'object'
      ? {
          supported: Boolean(parsed.automation.supported),
          controlType: String(parsed.automation.controlType || 'Window'),
          name: String(parsed.automation.name || '')
        }
      : { supported: false }
  };
}

/**
 * Builds command line arguments for the helper --enumerate command.
 * Strictly uses an array of strings, NO shell invocation, NO arbitrary arguments.
 */
export function buildHelperEnumerateArgs({ limit = 256, includeTitles = false } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 10000 ? limit : 256;
  const args = ['--enumerate', '--limit', String(safeLimit)];
  if (includeTitles === true) {
    args.push('--include-titles');
  }
  return args;
}

/**
 * Builds command line arguments for the helper --inspect command.
 */
export function buildHelperInspectArgs(hwnd) {
  const safeHwnd = typeof hwnd === 'number' && Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null;
  if (!safeHwnd) {
    throw new ProtocolError(`Invalid hwnd for inspect command: ${hwnd}`);
  }
  return ['--inspect', String(safeHwnd)];
}

/**
 * Builds command line arguments for the helper --read-text command.
 * Strictly uses an array of strings, NO shell invocation.
 *
 * @param {number} hwnd Window handle to read from.
 * @param {object} [options]
 * @param {number} [options.expectedPid] Expected process ID for identity check.
 * @param {string} [options.expectedStart] Expected start generation token.
 * @returns {string[]}
 */
export function buildHelperReadTextArgs(hwnd, { expectedPid, expectedStart } = {}) {
  const safeHwnd = typeof hwnd === 'number' && Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null;
  if (!safeHwnd) {
    throw new ProtocolError(`Invalid hwnd for read-text command: ${hwnd}`);
  }

  const args = ['--read-text', String(safeHwnd)];

  if (typeof expectedPid === 'number' && Number.isSafeInteger(expectedPid) && expectedPid > 0) {
    args.push('--expected-pid', String(expectedPid));
  }

  if (typeof expectedStart === 'string' && expectedStart.trim() !== '') {
    args.push('--expected-start', expectedStart.trim());
  }

  return args;
}

/**
 * Validates and parses raw JSON output from the helper's --read-text command.
 *
 * @param {string} stdout
 * @returns {{
 *   status: 'read',
 *   hwnd: number,
 *   processId: number,
 *   method: string,
 *   text: string,
 *   charCount: number
 * }}
 */
export function parseHelperReadTextOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper read-text stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'read') {
    throw new ProtocolError("Helper read-text payload must have status 'read'");
  }

  const hwnd = typeof parsed.hwnd === 'number' && Number.isSafeInteger(parsed.hwnd) && parsed.hwnd > 0 ? parsed.hwnd : null;
  if (!hwnd) throw new ProtocolError("Helper read-text missing valid 'hwnd'");

  const processId = typeof parsed.processId === 'number' && Number.isSafeInteger(parsed.processId) && parsed.processId > 0 ? parsed.processId : null;
  if (!processId) throw new ProtocolError("Helper read-text missing valid 'processId'");

  const method = typeof parsed.method === 'string' && parsed.method.trim() !== '' ? parsed.method : 'unknown';
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  const charCount = typeof parsed.charCount === 'number' && Number.isFinite(parsed.charCount) && parsed.charCount >= 0 ? parsed.charCount : text.length;

  return {
    status: 'read',
    hwnd,
    processId,
    method,
    text,
    charCount
  };
}

export const MAX_TEXT_LENGTH = 4096;
export const MAX_TEXT_BYTES = 16384;

/**
 * Builds command line arguments for the helper --write-text command.
 * Strictly uses an array of strings, NO shell invocation, NO clipboard manipulation.
 *
 * @param {number} hwnd Window handle to target.
 * @param {string} text Text to write.
 * @param {object} options Authorization and targeting options.
 * @param {number} options.expectedPid Expected process ID (mandatory positive integer).
 * @param {string} options.expectedStart Expected start generation token (mandatory non-empty string).
 * @param {string} options.sessionId Authorization session ID (mandatory non-empty string).
 * @param {number} options.grantExpiry Timestamp (ms) when authorization grant expires (mandatory future timestamp).
 * @param {boolean} options.inputEnabled Explicit authorization flag (mandatory literal true).
 * @param {number} [options.clockNow] Optional current time for validation.
 * @returns {string[]}
 */
export function buildHelperWriteTextArgs(hwnd, text, options = {}) {
  const {
    expectedPid,
    expectedStart,
    sessionId,
    grantExpiry,
    inputEnabled = false,
    clockNow = Date.now()
  } = options;

  const safeHwnd = typeof hwnd === 'number' && Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null;
  if (!safeHwnd) {
    throw new ProtocolError(`Invalid hwnd for write-text command: ${hwnd}`);
  }

  if (typeof text !== 'string' || text.length === 0) {
    throw new ProtocolError('Text to write must be a non-empty string');
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new ProtocolError(`Text length (${text.length}) exceeds declared limit of ${MAX_TEXT_LENGTH} characters`);
  }

  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_TEXT_BYTES) {
    throw new ProtocolError(`Text UTF-8 byte length (${byteLength}) exceeds declared limit of ${MAX_TEXT_BYTES} bytes`);
  }

  if (inputEnabled !== true) {
    throw new ProtocolError('Input is disabled by policy (default inputdisabled). Explicit authorization required.');
  }

  if (typeof grantExpiry !== 'number' || !Number.isFinite(grantExpiry) || grantExpiry <= clockNow) {
    throw new ProtocolError(`Authorization grant expired or invalid (now=${clockNow}, expiry=${grantExpiry}). Execution prohibited.`);
  }

  if (typeof expectedPid !== 'number' || !Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new ProtocolError(`expectedPid is required and must be a positive integer, got: ${expectedPid}`);
  }

  if (typeof expectedStart !== 'string' || expectedStart.trim() === '') {
    throw new ProtocolError(`expectedStart generation token is required and cannot be empty, got: ${expectedStart}`);
  }

  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new ProtocolError(`sessionId is required and cannot be empty, got: ${sessionId}`);
  }

  return [
    '--write-text', String(safeHwnd),
    '--text', text,
    '--input-enabled',
    '--grant-expiry', String(Math.trunc(grantExpiry)),
    '--expected-pid', String(expectedPid),
    '--expected-start', expectedStart.trim(),
    '--session', sessionId.trim()
  ];
}

/**
 * Validates and parses raw JSON output from the helper's --write-text command.
 *
 * @param {string} stdout
 * @returns {{
 *   status: 'written',
 *   hwnd: number,
 *   processId: number,
 *   method: string,
 *   charsWritten: number
 * }}
 */
export function parseHelperWriteTextOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper write-text stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'written') {
    throw new ProtocolError("Helper write-text payload must have status 'written'");
  }

  const hwnd = typeof parsed.hwnd === 'number' && Number.isSafeInteger(parsed.hwnd) && parsed.hwnd > 0 ? parsed.hwnd : null;
  if (!hwnd) throw new ProtocolError("Helper write-text missing valid 'hwnd'");

  const processId = typeof parsed.processId === 'number' && Number.isSafeInteger(parsed.processId) && parsed.processId > 0 ? parsed.processId : null;
  if (!processId) throw new ProtocolError("Helper write-text missing valid 'processId'");

  const method = typeof parsed.method === 'string' && parsed.method.trim() !== '' ? parsed.method : 'unknown';
  const charsWritten = typeof parsed.charsWritten === 'number' && Number.isFinite(parsed.charsWritten) && parsed.charsWritten >= 0 ? parsed.charsWritten : 0;

  return {
    status: 'written',
    hwnd,
    processId,
    method,
    charsWritten
  };
}

/**
 * Builds arguments for helper --mouse-action command.
 *
 * @param {object} spec
 * @param {string} spec.actionType - 'click' | 'move' | 'drag' | 'scroll'
 * @param {number} [spec.x]
 * @param {number} [spec.y]
 * @param {number} [spec.endX]
 * @param {number} [spec.endY]
 * @param {number} [spec.deltaX]
 * @param {number} [spec.deltaY]
 * @param {number} [spec.duration]
 * @param {string} [spec.button] - 'left' | 'right' | 'middle'
 * @param {string} [spec.clickType] - 'single' | 'double' | 'triple'
 * @param {number} [spec.grantExpiry]
 * @param {string} [spec.sessionId]
 * @param {boolean} [spec.inputEnabled]
 * @returns {string[]}
 */
export function buildHelperMouseActionArgs(spec = {}) {
  const args = ['--mouse-action'];
  const actionType = typeof spec.actionType === 'string' ? spec.actionType.toLowerCase() : 'click';
  args.push('--action-type', actionType);

  if (typeof spec.x === 'number') args.push('--x', String(Math.round(spec.x)));
  if (typeof spec.y === 'number') args.push('--y', String(Math.round(spec.y)));
  if (typeof spec.endX === 'number') args.push('--end-x', String(Math.round(spec.endX)));
  if (typeof spec.endY === 'number') args.push('--end-y', String(Math.round(spec.endY)));
  if (typeof spec.deltaX === 'number') args.push('--delta-x', String(Math.round(spec.deltaX)));
  if (typeof spec.deltaY === 'number') args.push('--delta-y', String(Math.round(spec.deltaY)));
  if (typeof spec.duration === 'number') args.push('--duration', String(Math.max(10, Math.round(spec.duration))));
  if (typeof spec.button === 'string') args.push('--button', spec.button.toLowerCase());
  if (typeof spec.clickType === 'string') args.push('--click-type', spec.clickType.toLowerCase());
  if (spec.inputEnabled === true) args.push('--input-enabled');
  if (spec.hwnd !== undefined) args.push('--hwnd', String(spec.hwnd));
  if (spec.expectedPid !== undefined) args.push('--expected-pid', String(spec.expectedPid));
  if (spec.expectedStart) args.push('--expected-start', String(spec.expectedStart));
  if (spec.expectedLocation) args.push('--expected-location', String(spec.expectedLocation));
  if (spec.expectedFocusClass) args.push('--expected-focus-class', String(spec.expectedFocusClass));
  if (typeof spec.grantExpiry === 'number') args.push('--grant-expiry', String(Math.trunc(spec.grantExpiry)));
  if (typeof spec.sessionId === 'string' && spec.sessionId.trim()) args.push('--session', spec.sessionId.trim());

  return args;
}

/**
 * Validates and parses raw JSON output from helper's --mouse-action command.
 *
 * @param {string} stdout
 * @returns {{ status: 'completed', action: 'mouse-action', type: string, x: number, y: number }}
 */
export function parseHelperMouseActionOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper mouse-action stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'completed') {
    throw new ProtocolError("Helper mouse-action payload must have status 'completed'");
  }

  return {
    status: 'completed',
    action: 'mouse-action',
    type: String(parsed.type || 'click'),
    x: Number(parsed.x || 0),
    y: Number(parsed.y || 0)
  };
}

/**
 * Builds arguments for helper --press-keys command.
 *
 * @param {object} spec
 * @param {string} spec.keys - key chord e.g. "Control+c" or comma-separated keys
 * @param {number} [spec.grantExpiry]
 * @param {string} [spec.sessionId]
 * @param {boolean} [spec.inputEnabled]
 * @returns {string[]}
 */
export function buildHelperPressKeysArgs(spec = {}) {
  if (typeof spec.keys !== 'string' || spec.keys.trim() === '') {
    throw new ProtocolError('keys string is required for press-keys command');
  }

  const args = ['--press-keys', '--keys', spec.keys.trim()];
  if (spec.inputEnabled === true) args.push('--input-enabled');
  if (spec.hwnd !== undefined) args.push('--hwnd', String(spec.hwnd));
  if (spec.expectedPid !== undefined) args.push('--expected-pid', String(spec.expectedPid));
  if (spec.expectedStart) args.push('--expected-start', String(spec.expectedStart));
  if (spec.expectedLocation) args.push('--expected-location', String(spec.expectedLocation));
  if (spec.expectedFocusClass) args.push('--expected-focus-class', String(spec.expectedFocusClass));
  if (typeof spec.grantExpiry === 'number') args.push('--grant-expiry', String(Math.trunc(spec.grantExpiry)));
  if (typeof spec.sessionId === 'string' && spec.sessionId.trim()) args.push('--session', spec.sessionId.trim());

  return args;
}

/**
 * Validates and parses raw JSON output from helper's --press-keys command.
 *
 * @param {string} stdout
 * @returns {{ status: 'completed', action: 'press-keys', keys: string, count: number }}
 */
export function parseHelperPressKeysOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper press-keys stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'completed') {
    throw new ProtocolError("Helper press-keys payload must have status 'completed'");
  }

  return {
    status: 'completed',
    action: 'press-keys',
    keys: String(parsed.keys || ''),
    count: Number(parsed.count || 0)
  };
}

/**
 * Builds arguments for helper --capture-screen command.
 *
 * @param {object} [spec]
 * @param {string} [spec.outputFile]
 * @returns {string[]}
 */
export function buildHelperCaptureScreenArgs(spec = {}) {
  const args = ['--capture-screen'];
  if (typeof spec.outputFile === 'string' && spec.outputFile.trim()) {
    args.push('--output-file', spec.outputFile.trim());
  }
  return args;
}

/**
 * Validates and parses raw JSON output from helper's --capture-screen command.
 *
 * @param {string} stdout
 * @returns {{
 *   status: 'captured',
 *   bounds: { x: number, y: number, width: number, height: number },
 *   outputFile?: string,
 *   base64?: string,
 *   base64Length?: number
 * }}
 */
export function parseHelperCaptureScreenOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new ProtocolError('Helper output must be a non-empty string');
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new ProtocolError(`Helper capture-screen stdout is not valid JSON: ${err.message}`, { cause: err });
  }

  if (!parsed || typeof parsed !== 'object' || parsed.status !== 'captured') {
    throw new ProtocolError("Helper capture-screen payload must have status 'captured'");
  }

  const bounds = parsed.bounds && typeof parsed.bounds === 'object' ? {
    x: Number(parsed.bounds.x || 0),
    y: Number(parsed.bounds.y || 0),
    width: Number(parsed.bounds.width || 0),
    height: Number(parsed.bounds.height || 0)
  } : { x: 0, y: 0, width: 0, height: 0 };

  const result = {
    status: 'captured',
    bounds
  };

  if (typeof parsed.outputFile === 'string') result.outputFile = parsed.outputFile;
  if (typeof parsed.base64 === 'string') result.base64 = parsed.base64;
  if (typeof parsed.base64Length === 'number') result.base64Length = parsed.base64Length;

  return result;
}

