/**
 * Model Providers - Transport Lifecycle Port
 *
 * Exposes a standardized request lifecycle port for campaign budget owners (AGR-5),
 * token rate management, and accurate physical dispatch accounting.
 *
 * Invariants:
 * 1. Pre-dispatch reservation: Immediately before actual dispatch, reserve request + pass remaining deadline.
 * 2. Post-dispatch reporting: After response / status / error, report sanitized measured / unknown usage.
 * 3. Accurate dispatch accounting: Each physical fetch attempt reserves and reports individually;
 *    retry loop index is decoupled from actual dispatch count.
 * 4. Interoperability: Exposes wrapFetchWithTransportLifecycle for transparent fetch-level wrapping
 *    without duplicating rate or campaign engines.
 */

import { sanitizeError } from './errors.js';

/**
 * Abstract or default base class for transport lifecycle ports.
 */
export class TransportLifecyclePort {
  /**
   * Called immediately before each physical network dispatch attempt.
   *
   * @param {object} context
   * @param {string} context.provider - Provider name (e.g. 'groq', 'opencode', 'openrouter')
   * @param {string} context.model - Model slug or ID
   * @param {number} context.attempt - 1-based attempt number for this physical fetch
   * @param {number} context.remainingMs - Remaining deadline in milliseconds
   * @param {AbortSignal|null} [context.signal] - AbortSignal for the request
   * @returns {Promise<{ ok: boolean, reason?: string, retryAfterMs?: number }> | { ok: boolean, reason?: string, retryAfterMs?: number }}
   */
  async reserve(context) {
    return { ok: true };
  }

  /**
   * Called immediately after each physical dispatch attempt completes or fails.
   *
   * @param {object} context
   * @param {string} context.provider - Provider name
   * @param {string} context.model - Model slug or ID
   * @param {number} context.attempt - 1-based attempt number
   * @param {boolean} context.ok - Whether the HTTP response was ok (2xx)
   * @param {number|null} context.status - HTTP status code, or null on transport error
   * @param {unknown|null} context.error - Sanitized error if failed, null on success
   * @param {{ inputTokens: number, outputTokens: number } | undefined} context.usage - Measured token usage if available
   * @param {boolean} context.unknownUsage - True if token consumption is unknown or uncertain
   * @param {number} context.durationMs - Duration of the fetch attempt in milliseconds
   * @param {number} context.remainingMs - Remaining deadline in milliseconds after attempt
   * @returns {Promise<void> | void}
   */
  async report(context) {
    // Default no-op
  }
}

/**
 * Creates a TransportLifecyclePort from handler functions or an existing port.
 *
 * @param {object} [handlers={}]
 * @param {Function} [handlers.reserve]
 * @param {Function} [handlers.report]
 * @returns {TransportLifecyclePort}
 */
export function createTransportLifecyclePort(handlers = {}) {
  if (handlers instanceof TransportLifecyclePort) {
    return handlers;
  }
  const port = new TransportLifecyclePort();
  if (typeof handlers?.reserve === 'function') {
    port.reserve = handlers.reserve.bind(handlers);
  }
  if (typeof handlers?.report === 'function') {
    port.report = handlers.report.bind(handlers);
  }
  return port;
}

/**
 * Wraps a standard fetch implementation with transport lifecycle reservation and reporting.
 * Provides transparent interoperability when callers inject a fetch wrapper rather than
 * passing transportPort directly.
 *
 * If the request init contains `lifecycleHandled: true`, the wrapper delegates to the
 * underlying fetch implementation without duplicate reservation or reporting.
 *
 * @param {typeof fetch} fetchImpl - Underlying fetch implementation
 * @param {TransportLifecyclePort | object} lifecyclePort - Transport lifecycle port
 * @param {object} [defaultContext={}] - Default context properties (provider, model)
 * @returns {typeof fetch} Wrapped fetch implementation
 */
export function wrapFetchWithTransportLifecycle(fetchImpl, lifecyclePort, defaultContext = {}) {
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function') {
    throw new TypeError('fetchImpl must be a callable function');
  }

  const port = createTransportLifecyclePort(lifecyclePort);

  let attemptCounter = 0;

  return async function fetchWithTransportLifecycle(url, init = {}) {
    // Bypass duplicate reservation/reporting if caller (e.g. BaseOpenAICompatibleProvider)
    // already handles transport lifecycle directly
    if (init?.lifecycleHandled === true) {
      return await impl(url, init);
    }

    attemptCounter++;
    const attempt = typeof init?.attempt === 'number' ? init.attempt : attemptCounter;
    const remainingMs = typeof init?.remainingMs === 'number' ? init.remainingMs : 30000;
    const signal = init?.signal || null;

    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const remainingBeforeReserve = Math.max(0, remainingMs);
    if (remainingBeforeReserve <= 0) {
      const timeoutErr = new Error('Request deadline expired before transport reservation');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }

    const deadline = Date.now() + remainingBeforeReserve;

    const context = {
      ...defaultContext,
      url: typeof url === 'string' ? url : String(url),
      attempt,
      remainingMs: remainingBeforeReserve,
      signal
    };

    if (typeof port.reserve === 'function') {
      let reserveTimeoutTimer;
      const reserveTimeoutPromise = new Promise((_, reject) => {
        reserveTimeoutTimer = setTimeout(() => {
          const timeoutErr = new Error('Transport reservation timed out after deadline');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, remainingBeforeReserve);
      });

      let reserveAbortListener = null;
      let reserveAbortPromise = null;
      if (signal) {
        reserveAbortPromise = new Promise((_, reject) => {
          if (signal.aborted) {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
            return;
          }
          reserveAbortListener = () => {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          };
          signal.addEventListener('abort', reserveAbortListener, { once: true });
        });
      }

      let reservation;
      try {
        const races = [port.reserve(context), reserveTimeoutPromise];
        if (reserveAbortPromise) races.push(reserveAbortPromise);
        reservation = await Promise.race(races);
      } catch (reserveErr) {
        if (signal?.aborted || reserveErr?.name === 'AbortError') {
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          abortErr.cause = reserveErr;
          throw abortErr;
        }
        const denialErr = new Error(`Transport reservation failed: ${reserveErr?.message || 'reservation error'}`);
        denialErr.name = 'ReservationDeniedError';
        denialErr.reservationDenied = true;
        denialErr.cause = reserveErr;
        throw denialErr;
      } finally {
        clearTimeout(reserveTimeoutTimer);
        if (signal && reserveAbortListener) {
          signal.removeEventListener('abort', reserveAbortListener);
        }
      }

      // Recheck abort immediately after reserve
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      // Recompute remaining deadline
      const remainingAfterReserve = deadline - Date.now();
      if (remainingAfterReserve <= 0) {
        const timeoutErr = new Error('Transport reservation exceeded deadline');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }

      // Literal ok: true check
      if (!reservation || reservation.ok !== true) {
        const reason = (reservation && typeof reservation.reason === 'string' && reservation.reason.trim())
          ? reservation.reason
          : 'Missing or malformed reservation approval (literal ok: true required)';
        const denialErr = new Error(`Transport reservation denied: ${reason}`);
        denialErr.name = 'ReservationDeniedError';
        denialErr.reservationDenied = true;
        denialErr.reason = reason;
        if (typeof reservation?.retryAfterMs === 'number') {
          denialErr.retryAfterMs = reservation.retryAfterMs;
        }
        throw denialErr;
      }
    }

    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const remainingForFetch = deadline - Date.now();
    if (remainingForFetch <= 0) {
      const timeoutErr = new Error('Request deadline expired before fetch dispatch');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }

    const start = Date.now();
    let response;
    try {
      response = await impl(url, init);
    } catch (fetchErr) {
      if (typeof port.report === 'function') {
        try {
          await port.report({
            ...context,
            ok: false,
            status: null,
            error: sanitizeError(fetchErr),
            usage: undefined,
            unknownUsage: true,
            durationMs: Date.now() - start,
            remainingMs: Math.max(0, remainingMs - (Date.now() - start))
          });
        } catch {}
      }
      throw fetchErr;
    }

    if (typeof port.report === 'function') {
      try {
        await port.report({
          ...context,
          ok: response.ok,
          status: response.status,
          error: response.ok ? null : new Error(`HTTP ${response.status}`),
          usage: undefined,
          unknownUsage: true,
          durationMs: Date.now() - start,
          remainingMs: Math.max(0, remainingMs - (Date.now() - start))
        });
      } catch {}
    }

    return response;
  };
}
