/**
 * @zetro/computer-windows-provider - Capture Backend Boundary
 *
 * Implements CaptureBackend interface for @zetro/computer-observer.
 * Explicitly reports status: 'unsupported' until native Windows.Graphics.Capture
 * pipeline has been independently tested, verified, and qualified.
 */

export class CaptureBackendError extends Error {
  constructor(message, { code = 'CAPTURE_UNSUPPORTED', details = {} } = {}) {
    super(message);
    this.name = 'CaptureBackendError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates a Windows capture backend instance.
 *
 * By default reports status: 'unsupported' with independentlyTested: false,
 * preventing any false acceptance or simulation claiming native capture.
 *
 * @param {object} [options]
 * @param {'supported'|'unsupported'} [options.status='unsupported']
 * @param {boolean} [options.independentlyTested=false]
 * @param {Function} [options.captureImpl]
 * @returns {import('@zetro/computer-observer').CaptureBackend}
 */
export function createWindowsCaptureBackend(options = {}) {
  const {
    status = 'unsupported',
    independentlyTested = false,
    captureImpl = null
  } = options;

  return {
    status,
    independentlyTested,

    async capture(target, { signal } = {}) {
      if (signal?.aborted) {
        const abortErr = new Error('Capture operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (status !== 'supported' || independentlyTested !== true || typeof captureImpl !== 'function') {
        throw new CaptureBackendError(
          'Native Windows graphics capture is unverified/unsupported in current provider increment',
          {
            code: 'CAPTURE_UNSUPPORTED',
            details: {
              target,
              reason: 'NATIVE_CAPTURE_UNSUPPORTED',
              status,
              independentlyTested
            }
          }
        );
      }

      return await captureImpl(target, { signal });
    }
  };
}
