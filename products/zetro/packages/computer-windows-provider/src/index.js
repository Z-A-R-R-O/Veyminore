/**
 * @zetro/computer-windows-provider
 *
 * Isolated Windows native read-only observation provider.
 * Exposes bounded Win32 window discovery, UIAutomation inspection,
 * and compatibility adapter for @zetro/computer-observer.
 */

export {
  createWindowsObserver
} from './observer-adapter.js';

export {
  createWindowsProcessRunner,
  ProcessRunnerError
} from './process-runner.js';

export {
  createWindowsCaptureBackend,
  CaptureBackendError
} from './capture-backend.js';

export {
  parseHelperEnumerateOutput,
  parseHelperInspectOutput,
  parseHelperReadTextOutput,
  parseHelperWriteTextOutput,
  buildHelperEnumerateArgs,
  buildHelperInspectArgs,
  buildHelperReadTextArgs,
  buildHelperWriteTextArgs,
  MAX_TEXT_LENGTH,
  MAX_TEXT_BYTES,
  buildHelperMouseActionArgs,
  parseHelperMouseActionOutput,
  buildHelperPressKeysArgs,
  parseHelperPressKeysOutput,
  buildHelperCaptureScreenArgs,
  parseHelperCaptureScreenOutput,
  ProtocolError
} from './protocol.js';

export {
  createActionDispatcher,
  ActionDispatchError
} from './action-dispatcher.js';
