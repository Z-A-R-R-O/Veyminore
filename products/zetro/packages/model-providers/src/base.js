/**
 * Model Providers - Base OpenAI-Compatible Provider Implementation
 *
 * Implements standard chat completions framing, tool validation, retry mechanics,
 * transport diagnostics, nonnegative token accounting, and strict secret scrubbing.
 */

import {
  isTransportFailure,
  networkCodes,
  createHttpError,
  ProviderTransportError,
  ProviderError,
  FreeRoutingViolationError,
  redactError,
  sanitizeError
} from './errors.js';
import { validateFreeRouting, validateEndpoint } from './metadata.js';

export const sleep = (ms, signal = null) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    const err = new Error('Operation aborted');
    err.name = 'AbortError';
    return reject(err);
  }
  let onAbort;
  const timer = setTimeout(() => {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  if (signal) {
    onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
});

const tool = (name, description, properties, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    }
  }
});

export const STANDARD_TOOL_SCHEMAS = {
  list_paths: tool('list_paths', 'List only the files permitted by this assignment.', {}),
  search: tool('search', 'Find a literal term in allowed files; returns bounded offsets.', {
    term: { type: 'string' }
  }, ['term']),
  read_slice: tool('read_slice', 'Read a bounded byte slice from an allowed file (at most 4096 bytes per call).', {
    path: { type: 'string', description: 'Path to an allowed file.' },
    start: { type: 'integer', minimum: 0, description: 'Starting byte offset (default 0).' },
    length: { type: 'integer', minimum: 1, maximum: 4096, description: 'Number of bytes to read (default 2048, maximum 4096).' }
  }, ['path']),
  propose_patch: tool('propose_patch', 'Replace one allowed file in the isolated snapshot only when its SHA-256 preimage matches.', {
    path: { type: 'string' },
    expectedSha256: { type: 'string' },
    content: { type: 'string' }
  }, ['path', 'expectedSha256', 'content']),
  run_check: tool('run_check', 'Run the fixed independent acceptance checks on the isolated snapshot.', {}),
  submit_receipt: tool('submit_receipt', 'Finish the attempt with a concise work summary. Independent checks determine the result.', {
    summary: { type: 'string' }
  }, ['summary'])
};

export function convertMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('Invalid provider message history: messages must be an array');
  }

  const converted = [];
  let previousCallId;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid provider message history: malformed message entry');
    }

    if ((message.role === 'system' || message.role === 'user') && typeof message.content === 'string') {
      converted.push({ role: message.role, content: message.content });
    } else if (message.role === 'assistant' && message.toolCall) {
      previousCallId = message.toolCall.id || `rct_call_${i}`;
      converted.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: previousCallId,
          type: 'function',
          function: {
            name: message.toolCall.name,
            arguments: JSON.stringify(message.toolCall.args || {})
          }
        }]
      });
    } else if (message.role === 'tool' && typeof message.content === 'string' && previousCallId) {
      converted.push({
        role: 'tool',
        tool_call_id: message.tool_call_id || previousCallId,
        content: message.content
      });
      previousCallId = undefined;
    } else {
      throw new Error('Invalid provider message history');
    }
  }

  return converted;
}

export function resolveTools(tools) {
  if (!Array.isArray(tools)) {
    throw new Error('Invalid tool selection: tools must be an array');
  }

  const resolved = [];
  for (const item of tools) {
    if (typeof item === 'string') {
      const schema = STANDARD_TOOL_SCHEMAS[item];
      if (!schema) {
        throw new Error(`Invalid tool selection: unknown tool '${item}'`);
      }
      resolved.push(schema);
    } else if (item && typeof item === 'object' && item.type === 'function' && item.function?.name) {
      resolved.push(item);
    } else {
      throw new Error('Invalid tool selection');
    }
  }

  return resolved;
}

export function extractMeasuredUsage(body) {
  const rawPromptTokens = body?.usage?.prompt_tokens;
  const rawCompletionTokens = body?.usage?.completion_tokens;
  if (
    typeof rawPromptTokens === 'number' &&
    typeof rawCompletionTokens === 'number' &&
    Number.isInteger(rawPromptTokens) &&
    Number.isInteger(rawCompletionTokens) &&
    rawPromptTokens >= 0 &&
    rawCompletionTokens >= 0
  ) {
    return {
      inputTokens: rawPromptTokens,
      outputTokens: rawCompletionTokens
    };
  }
  return undefined;
}

export class BaseOpenAICompatibleProvider {
  constructor({
    provider,
    apiKey,
    model,
    endpoint,
    modelsEndpoint = null,
    fetchImpl = globalThis.fetch,
    retryDelayMs = 400,
    maxRetries = 2,
    defaultHeaders = {},
    allowLiveCalls = false,
    snapshot = null,
    transportPort = null,
    transportLifecycle = null
  }) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error(`${provider?.toUpperCase() || 'PROVIDER'}_API_KEY is required`);
    }

    if (allowLiveCalls !== undefined && typeof allowLiveCalls !== 'boolean') {
      throw new TypeError('allowLiveCalls must be a boolean literal true to authorize live calls');
    }

    this.provider = provider;
    this.apiKey = apiKey.trim();
    this.model = model;
    this.endpoint = endpoint;
    this.modelsEndpoint = modelsEndpoint;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.retryDelayMs = Math.max(0, Math.min(2000, retryDelayMs));
    this.maxRetries = Math.max(1, Math.min(3, maxRetries));
    this.defaultHeaders = { ...defaultHeaders };
    this.allowLiveCalls = allowLiveCalls === true;
    this.name = `${this.provider}:${this.model}`;
    this.transportPort = transportPort || transportLifecycle || null;

    // Scrub key from error traces and reports
    this.secrets = [this.apiKey];

    // Enforce Free-Only Routing Policy on initialization
    this.metadata = validateFreeRouting({
      provider: this.provider,
      model: this.model,
      endpoint: this.endpoint
    });

    this.snapshot = snapshot;
    if (snapshot && typeof snapshot === 'object') {
      this.metadata = {
        ...this.metadata,
        ...snapshot
      };
    }
  }

  /**
   * Asserts that live calls are explicitly authorized before any request.
   */
  assertLiveGate() {
    if (this.allowLiveCalls !== true) {
      throw new ProviderError(
        `Live inference disabled: ${this.provider} calls require explicit allowLiveCalls: true authorization. Key presence alone does not authorize execution.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }
  }

  async checkAccess(timeoutMs = 20000) {
    this.assertLiveGate();

    if (!this.modelsEndpoint) {
      return { authenticated: true, modelAvailable: true, model: this.model };
    }

    // Strictly validate models endpoint immediately before request
    validateEndpoint(this.provider, 'models', this.modelsEndpoint);

    const boundedTimeout = Math.max(1, Math.min(timeoutMs, 60000));
    let response;
    try {
      response = await this.fetchImpl(this.modelsEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders
        },
        redirect: 'error',
        signal: AbortSignal.timeout(boundedTimeout)
      });
    } catch (err) {
      if (isTransportFailure(err)) {
        throw new ProviderTransportError(`${this.provider} checkAccess transport failure`, {
          cause: err,
          networkCodes: networkCodes(err),
          secrets: this.secrets,
          provider: this.provider
        });
      }
      throw redactError(err, this.secrets);
    }

    if (!response.ok) {
      throw createHttpError(response, this.provider, this.secrets);
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      throw new ProviderError(`Malformed ${this.provider} models response JSON`, {
        cause: err,
        provider: this.provider,
        secrets: this.secrets
      });
    }

    if (!Array.isArray(body?.data)) {
      throw new ProviderError(`Malformed ${this.provider} models response`, {
        provider: this.provider,
        secrets: this.secrets
      });
    }

    const modelAvailable = body.data.some(item => item?.id === this.model);
    return {
      authenticated: true,
      modelAvailable,
      model: this.model
    };
  }

  async next({ messages, tools, maxOutputTokens = 1024, timeoutMs = 30000, snapshot = null, signal = null, transportPort = null }) {
    const activeTransportPort = transportPort || this.transportPort;
    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    this.assertLiveGate();

    // Re-verify free routing policy and exact chat endpoint before dispatching request
    validateFreeRouting({
      provider: this.provider,
      model: this.model,
      endpoint: this.endpoint
    });
    validateEndpoint(this.provider, 'chat', this.endpoint);

    const resolvedTools = resolveTools(tools);
    const convertedMessages = convertMessages(messages);
    const allowedToolNames = new Set(resolvedTools.map(t => t.function.name));

    const activeSnapshot = snapshot || this.snapshot || this.metadata;
    const supported = activeSnapshot?.supportedParameters;

    // Fail closed: Require supported tool and output-token-limit parameters before fetch
    if (!Array.isArray(supported) || supported.length === 0) {
      throw new FreeRoutingViolationError(
        `Provider '${this.provider}' model '${this.model}' lacks verified 'supportedParameters' capability evidence. Execution prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    const hasTools = supported.includes('tools') || supported.includes('functions');
    if (!hasTools) {
      throw new FreeRoutingViolationError(
        `Provider '${this.provider}' model '${this.model}' does not support tool calling in supportedParameters. Execution prohibited.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    const hasMaxTokens = supported.includes('max_tokens');
    const hasMaxCompletionTokens = supported.includes('max_completion_tokens');
    if (!hasMaxTokens && !hasMaxCompletionTokens) {
      throw new FreeRoutingViolationError(
        `Provider '${this.provider}' model '${this.model}' does not support an output token limit parameter ('max_tokens' or 'max_completion_tokens') in supportedParameters. Cannot enforce maxOutputTokens budget (${maxOutputTokens}). Zero-dispatch fail-closed policy enforced.`,
        { provider: this.provider, secrets: this.secrets }
      );
    }

    const requestBody = {
      model: this.model,
      messages: convertedMessages
    };

    // 1. Tools: include if supported or unspecified
    if (!Array.isArray(supported) || supported.includes('tools') || supported.includes('functions')) {
      requestBody.tools = resolvedTools;
    }

    // 2. Tool choice: include only if supported or unspecified
    if (!Array.isArray(supported) || supported.includes('tool_choice')) {
      requestBody.tool_choice = 'required';
    }

    // 3. Token limits: negotiate max_tokens vs max_completion_tokens based on supported parameters
    if (Array.isArray(supported)) {
      if (supported.includes('max_tokens') && !supported.includes('max_completion_tokens')) {
        requestBody.max_tokens = maxOutputTokens;
      } else if (supported.includes('max_completion_tokens')) {
        requestBody.max_completion_tokens = maxOutputTokens;
      } else if (supported.includes('max_tokens')) {
        requestBody.max_tokens = maxOutputTokens;
      }
    } else {
      requestBody.max_completion_tokens = maxOutputTokens;
    }

    // 4. Parallel tool calls: include only if supported or unspecified
    if (!Array.isArray(supported) || supported.includes('parallel_tool_calls')) {
      requestBody.parallel_tool_calls = false;
    }

    // 5. Temperature: include if supported or unspecified
    if (!Array.isArray(supported) || supported.includes('temperature')) {
      requestBody.temperature = 0;
    }

    const request = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders
      },
      redirect: 'error',
      body: JSON.stringify(requestBody)
    };

    if (typeof timeoutMs === 'number' && timeoutMs <= 0) {
      throw new ProviderTransportError(`${this.provider} request deadline expired before execution`, {
        attempts: 0,
        retries: 0,
        networkCodes: ['ETIMEDOUT'],
        secrets: this.secrets,
        provider: this.provider,
        remoteUsageUncertain: true
      });
    }

    const boundedTimeout = Math.min(Math.max(1, timeoutMs), 90000);
    const deadline = Date.now() + boundedTimeout;
    let response;

    let dispatchedRequests = 0;
    let currentAttemptFetchStart = Date.now();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        abortErr.attempts = Math.max(1, dispatchedRequests);
        abortErr.retries = Math.max(0, abortErr.attempts - 1);
        abortErr.remoteUsageUncertain = true;
        throw abortErr;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        const attemptsCount = Math.max(1, dispatchedRequests);
        throw new ProviderTransportError(`${this.provider} request deadline expired before execution`, {
          attempts: attemptsCount,
          retries: Math.max(0, attemptsCount - 1),
          networkCodes: ['ETIMEDOUT'],
          secrets: this.secrets,
          provider: this.provider,
          remoteUsageUncertain: true
        });
      }

      // Pre-dispatch reservation: Reserve request immediately before physical dispatch
      if (activeTransportPort && typeof activeTransportPort.reserve === 'function') {
        const remainingBeforeReserve = deadline - Date.now();
        if (remainingBeforeReserve <= 0) {
          throw new ProviderTransportError(`${this.provider} request deadline expired before transport reservation`, {
            attempts: dispatchedRequests,
            retries: Math.max(0, dispatchedRequests - 1),
            networkCodes: ['ETIMEDOUT'],
            secrets: this.secrets,
            provider: this.provider,
            remoteUsageUncertain: false
          });
        }

        let reserveTimeoutTimer;
        const reserveTimeoutPromise = new Promise((_, reject) => {
          reserveTimeoutTimer = setTimeout(() => {
            const timeoutErr = new ProviderTransportError(
              `${this.provider} request deadline expired while waiting for transport reservation`,
              {
                attempts: dispatchedRequests,
                retries: Math.max(0, dispatchedRequests - 1),
                networkCodes: ['ETIMEDOUT'],
                secrets: this.secrets,
                provider: this.provider,
                remoteUsageUncertain: false
              }
            );
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
              abortErr.attempts = dispatchedRequests;
              abortErr.retries = Math.max(0, dispatchedRequests - 1);
              abortErr.remoteUsageUncertain = false;
              reject(abortErr);
              return;
            }
            reserveAbortListener = () => {
              const abortErr = new Error('Operation aborted');
              abortErr.name = 'AbortError';
              abortErr.attempts = dispatchedRequests;
              abortErr.retries = Math.max(0, dispatchedRequests - 1);
              abortErr.remoteUsageUncertain = false;
              reject(abortErr);
            };
            signal.addEventListener('abort', reserveAbortListener, { once: true });
          });
        }

        let reservation;
        try {
          const races = [
            activeTransportPort.reserve({
              provider: this.provider,
              model: this.model,
              attempt,
              remainingMs: remainingBeforeReserve,
              signal
            }),
            reserveTimeoutPromise
          ];
          if (reserveAbortPromise) races.push(reserveAbortPromise);
          reservation = await Promise.race(races);
        } catch (reserveErr) {
          if (signal?.aborted || reserveErr?.name === 'AbortError') {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            abortErr.cause = reserveErr;
            abortErr.attempts = dispatchedRequests;
            abortErr.retries = Math.max(0, dispatchedRequests - 1);
            abortErr.remoteUsageUncertain = false;
            throw abortErr;
          }
          if (reserveErr instanceof ProviderTransportError || reserveErr?.networkCodes?.includes?.('ETIMEDOUT')) {
            throw reserveErr;
          }
          const denialErr = new ProviderError(
            `Transport reservation failed for ${this.provider}:${this.model}: ${reserveErr?.message || 'reservation error'}`,
            {
              cause: reserveErr,
              provider: this.provider,
              secrets: this.secrets,
              attempts: dispatchedRequests,
              retries: Math.max(0, dispatchedRequests - 1),
              remoteUsageUncertain: false
            }
          );
          denialErr.reservationDenied = true;
          denialErr.attempts = dispatchedRequests;
          denialErr.retries = Math.max(0, dispatchedRequests - 1);
          throw denialErr;
        } finally {
          clearTimeout(reserveTimeoutTimer);
          if (signal && reserveAbortListener) {
            signal.removeEventListener('abort', reserveAbortListener);
          }
        }

        // Recheck abort immediately AFTER awaited reserve and before fetch
        if (signal?.aborted) {
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          abortErr.attempts = dispatchedRequests;
          abortErr.retries = Math.max(0, dispatchedRequests - 1);
          abortErr.remoteUsageUncertain = false;
          throw abortErr;
        }

        // Recompute remaining deadline immediately AFTER awaited reserve and before fetch
        const remainingMsAfterReserve = deadline - Date.now();
        if (remainingMsAfterReserve <= 0) {
          throw new ProviderTransportError(`${this.provider} request deadline expired during reservation`, {
            attempts: dispatchedRequests,
            retries: Math.max(0, dispatchedRequests - 1),
            networkCodes: ['ETIMEDOUT'],
            secrets: this.secrets,
            provider: this.provider,
            remoteUsageUncertain: false
          });
        }

        // Literal ok: true authorization check (fail closed on missing, malformed, non-boolean, or false)
        if (!reservation || reservation.ok !== true) {
          const reason = (reservation && typeof reservation.reason === 'string' && reservation.reason.trim())
            ? reservation.reason
            : 'Missing or malformed reservation approval (literal ok: true required)';
          const denialErr = new ProviderError(
            `Transport reservation denied for ${this.provider}:${this.model}: ${reason}`,
            {
              provider: this.provider,
              secrets: this.secrets,
              attempts: dispatchedRequests,
              retries: Math.max(0, dispatchedRequests - 1),
              remoteUsageUncertain: false
            }
          );
          denialErr.reservationDenied = true;
          denialErr.reason = reason;
          if (typeof reservation?.retryAfterMs === 'number') {
            denialErr.retryAfterMs = reservation.retryAfterMs;
          }
          denialErr.attempts = dispatchedRequests;
          denialErr.retries = Math.max(0, dispatchedRequests - 1);
          throw denialErr;
        }
      }

      // Recheck abort immediately before physical fetch dispatch
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        abortErr.attempts = dispatchedRequests;
        abortErr.retries = Math.max(0, dispatchedRequests - 1);
        abortErr.remoteUsageUncertain = false;
        throw abortErr;
      }

      // Recompute fresh remaining deadline for physical fetch
      const remainingForFetch = deadline - Date.now();
      if (remainingForFetch <= 0) {
        throw new ProviderTransportError(`${this.provider} request deadline expired before fetch dispatch`, {
          attempts: dispatchedRequests,
          retries: Math.max(0, dispatchedRequests - 1),
          networkCodes: ['ETIMEDOUT'],
          secrets: this.secrets,
          provider: this.provider,
          remoteUsageUncertain: false
        });
      }

      const timeoutSignal = AbortSignal.timeout(remainingForFetch);
      const fetchSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;

      currentAttemptFetchStart = Date.now();
      dispatchedRequests++;
      try {
        response = await this.fetchImpl(this.endpoint, {
          ...request,
          signal: fetchSignal,
          lifecycleHandled: Boolean(activeTransportPort)
        });
        break;
      } catch (error) {
        if (activeTransportPort && typeof activeTransportPort.report === 'function') {
          try {
            await activeTransportPort.report({
              provider: this.provider,
              model: this.model,
              attempt,
              ok: false,
              status: null,
              error: sanitizeError(error, this.secrets),
              usage: undefined,
              unknownUsage: true,
              durationMs: Date.now() - currentAttemptFetchStart,
              remainingMs: Math.max(0, deadline - Date.now())
            });
          } catch {}
        }

        if (signal?.aborted || error.name === 'AbortError') {
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          abortErr.cause = error;
          abortErr.attempts = dispatchedRequests;
          abortErr.retries = Math.max(0, dispatchedRequests - 1);
          abortErr.remoteUsageUncertain = true;
          throw abortErr;
        }

        if (!isTransportFailure(error)) {
          const redacted = redactError(error, this.secrets);
          redacted.attempts = dispatchedRequests;
          redacted.retries = Math.max(0, dispatchedRequests - 1);
          redacted.remoteUsageUncertain = true;
          throw redacted;
        }

        const timeAfterAttempt = deadline - Date.now();
        if (attempt < this.maxRetries && timeAfterAttempt > this.retryDelayMs + 500) {
          if (signal?.aborted) {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            abortErr.attempts = Math.max(1, dispatchedRequests);
            abortErr.retries = Math.max(0, abortErr.attempts - 1);
            abortErr.remoteUsageUncertain = true;
            throw abortErr;
          }
          try {
            await sleep(this.retryDelayMs, signal);
          } catch (sleepErr) {
            if (signal?.aborted || sleepErr.name === 'AbortError') {
              const abortErr = new Error('Operation aborted');
              abortErr.name = 'AbortError';
              abortErr.cause = sleepErr;
              abortErr.attempts = Math.max(1, dispatchedRequests);
              abortErr.retries = Math.max(0, abortErr.attempts - 1);
              abortErr.remoteUsageUncertain = true;
              throw abortErr;
            }
            throw sleepErr;
          }
          if (signal?.aborted) {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            abortErr.attempts = Math.max(1, dispatchedRequests);
            abortErr.retries = Math.max(0, abortErr.attempts - 1);
            abortErr.remoteUsageUncertain = true;
            throw abortErr;
          }
          continue;
        }

        const transportErr = new ProviderTransportError(
          `${this.provider} transport failed after ${dispatchedRequests} attempt${dispatchedRequests === 1 ? '' : 's'}`,
          {
            attempts: dispatchedRequests,
            retries: Math.max(0, dispatchedRequests - 1),
            networkCodes: networkCodes(error),
            cause: error,
            secrets: this.secrets,
            provider: this.provider,
            remoteUsageUncertain: true
          }
        );
        throw transportErr;
      }
    }

    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      abortErr.attempts = dispatchedRequests;
      abortErr.retries = Math.max(0, dispatchedRequests - 1);
      abortErr.remoteUsageUncertain = true;
      throw abortErr;
    }

    if (!response.ok) {
      const httpErr = createHttpError(response, this.provider, this.secrets, dispatchedRequests);
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(httpErr, this.secrets),
            usage: undefined,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw httpErr;
    }

    const remainingForBody = deadline - Date.now();
    if (remainingForBody <= 0) {
      const timeoutErr = new ProviderTransportError(`${this.provider} request deadline expired before reading response body`, {
        attempts: dispatchedRequests,
        retries: Math.max(0, dispatchedRequests - 1),
        networkCodes: ['ETIMEDOUT'],
        secrets: this.secrets,
        provider: this.provider,
        remoteUsageUncertain: true
      });
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(timeoutErr, this.secrets),
            usage: undefined,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: 0
          });
        } catch {}
      }
      throw timeoutErr;
    }

    let bodyTimeoutTimer;
    const bodyTimeoutPromise = new Promise((_, reject) => {
      bodyTimeoutTimer = setTimeout(() => {
        if (typeof response.body?.cancel === 'function') {
          try { response.body.cancel(); } catch {}
        }
        const timeoutErr = new ProviderTransportError(
          `${this.provider} response body read timed out after remaining deadline (${remainingForBody}ms)`,
          {
            attempts: dispatchedRequests,
            retries: Math.max(0, dispatchedRequests - 1),
            networkCodes: ['ETIMEDOUT'],
            secrets: this.secrets,
            provider: this.provider,
            remoteUsageUncertain: true
          }
        );
        reject(timeoutErr);
      }, remainingForBody);
    });

    let bodyAbortListener = null;
    let bodyAbortPromise = null;
    if (signal) {
      bodyAbortPromise = new Promise((_, reject) => {
        if (signal.aborted) {
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          abortErr.attempts = dispatchedRequests;
          abortErr.retries = Math.max(0, dispatchedRequests - 1);
          abortErr.remoteUsageUncertain = true;
          reject(abortErr);
          return;
        }
        bodyAbortListener = () => {
          if (typeof response.body?.cancel === 'function') {
            try { response.body.cancel(); } catch {}
          }
          const abortErr = new Error('Operation aborted');
          abortErr.name = 'AbortError';
          abortErr.attempts = dispatchedRequests;
          abortErr.retries = Math.max(0, dispatchedRequests - 1);
          abortErr.remoteUsageUncertain = true;
          reject(abortErr);
        };
        signal.addEventListener('abort', bodyAbortListener, { once: true });
      });
    }

    const bodyRaces = [response.json(), bodyTimeoutPromise];
    if (bodyAbortPromise) bodyRaces.push(bodyAbortPromise);

    let body;
    try {
      body = await Promise.race(bodyRaces);
    } catch (err) {
      const isTimeout = err instanceof ProviderTransportError || err?.networkCodes?.includes?.('ETIMEDOUT');
      const isAbort = signal?.aborted || err?.name === 'AbortError';

      let finalErr;
      if (isAbort) {
        finalErr = new Error('Operation aborted');
        finalErr.name = 'AbortError';
        finalErr.cause = err;
        finalErr.attempts = dispatchedRequests;
        finalErr.retries = Math.max(0, dispatchedRequests - 1);
        finalErr.remoteUsageUncertain = true;
      } else if (isTimeout) {
        finalErr = err;
      } else {
        finalErr = new ProviderError(`Malformed ${this.provider} response JSON`, {
          cause: err,
          provider: this.provider,
          secrets: this.secrets,
          attempts: dispatchedRequests,
          retries: Math.max(0, dispatchedRequests - 1),
          remoteUsageUncertain: true
        });
        finalErr.attempts = dispatchedRequests;
        finalErr.retries = Math.max(0, dispatchedRequests - 1);
        finalErr.remoteUsageUncertain = true;
      }

      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(finalErr, this.secrets),
            usage: undefined,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw finalErr;
    } finally {
      clearTimeout(bodyTimeoutTimer);
      if (signal && bodyAbortListener) {
        signal.removeEventListener('abort', bodyAbortListener);
      }
    }

    const measuredUsage = extractMeasuredUsage(body);

    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      abortErr.attempts = dispatchedRequests;
      abortErr.retries = Math.max(0, dispatchedRequests - 1);
      abortErr.remoteUsageUncertain = true;
      if (measuredUsage) {
        abortErr.usage = measuredUsage;
      }
      throw abortErr;
    }

    const calls = body?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(calls) || calls.length !== 1) {
      const err = new ProviderError(`${this.provider} did not return exactly one tool call`, {
        provider: this.provider,
        secrets: this.secrets,
        attempts: dispatchedRequests,
        retries: Math.max(0, dispatchedRequests - 1),
        remoteUsageUncertain: true,
        usage: measuredUsage
      });
      err.attempts = dispatchedRequests;
      err.retries = Math.max(0, dispatchedRequests - 1);
      err.remoteUsageUncertain = true;
      if (measuredUsage) {
        err.usage = measuredUsage;
      }
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(err, this.secrets),
            usage: measuredUsage,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw err;
    }

    const fn = calls[0]?.function;
    if (!fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
      const err = new ProviderError(`Malformed ${this.provider} tool call: missing function or arguments`, {
        provider: this.provider,
        secrets: this.secrets,
        attempts: dispatchedRequests,
        retries: Math.max(0, dispatchedRequests - 1),
        remoteUsageUncertain: true,
        usage: measuredUsage
      });
      err.attempts = dispatchedRequests;
      err.retries = Math.max(0, dispatchedRequests - 1);
      err.remoteUsageUncertain = true;
      if (measuredUsage) {
        err.usage = measuredUsage;
      }
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(err, this.secrets),
            usage: measuredUsage,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw err;
    }

    // Validate that returned tool is within the requested tool set
    if (!allowedToolNames.has(fn.name)) {
      const err = new ProviderError(
        `${this.provider} returned tool '${fn.name}' which is not in selected tools (${[...allowedToolNames].join(', ')})`,
        {
          provider: this.provider,
          secrets: this.secrets,
          attempts: dispatchedRequests,
          retries: Math.max(0, dispatchedRequests - 1),
          remoteUsageUncertain: true,
          usage: measuredUsage
        }
      );
      err.attempts = dispatchedRequests;
      err.retries = Math.max(0, dispatchedRequests - 1);
      err.remoteUsageUncertain = true;
      if (measuredUsage) {
        err.usage = measuredUsage;
      }
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(err, this.secrets),
            usage: measuredUsage,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw err;
    }

    let args;
    try {
      args = JSON.parse(fn.arguments);
    } catch (err) {
      const parseErr = new ProviderError(`Malformed ${this.provider} tool arguments: invalid JSON`, {
        cause: err,
        provider: this.provider,
        secrets: this.secrets,
        attempts: dispatchedRequests,
        retries: Math.max(0, dispatchedRequests - 1),
        remoteUsageUncertain: true,
        usage: measuredUsage
      });
      parseErr.attempts = dispatchedRequests;
      parseErr.retries = Math.max(0, dispatchedRequests - 1);
      parseErr.remoteUsageUncertain = true;
      if (measuredUsage) {
        parseErr.usage = measuredUsage;
      }
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(parseErr, this.secrets),
            usage: measuredUsage,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw parseErr;
    }

    // Validate non-array object argument shape
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      const err = new ProviderError(
        `Malformed ${this.provider} tool arguments: expected non-array object, got ${args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args}`,
        {
          provider: this.provider,
          secrets: this.secrets,
          attempts: dispatchedRequests,
          retries: Math.max(0, dispatchedRequests - 1),
          remoteUsageUncertain: true,
          usage: measuredUsage
        }
      );
      err.attempts = dispatchedRequests;
      err.retries = Math.max(0, dispatchedRequests - 1);
      err.remoteUsageUncertain = true;
      if (measuredUsage) {
        err.usage = measuredUsage;
      }
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(err, this.secrets),
            usage: measuredUsage,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw err;
    }

    // Enforce finite nonnegative integer token accounting
    const promptTokens = body?.usage?.prompt_tokens;
    const completionTokens = body?.usage?.completion_tokens;

    if (
      typeof promptTokens !== 'number' ||
      typeof completionTokens !== 'number' ||
      !Number.isInteger(promptTokens) ||
      !Number.isInteger(completionTokens) ||
      promptTokens < 0 ||
      completionTokens < 0
    ) {
      const err = new ProviderError(
        `${this.provider} token usage missing or malformed (${promptTokens}, ${completionTokens}); cannot certify zero or valid consumption`,
        {
          provider: this.provider,
          secrets: this.secrets,
          attempts: dispatchedRequests,
          retries: Math.max(0, dispatchedRequests - 1),
          remoteUsageUncertain: true
        }
      );
      err.attempts = dispatchedRequests;
      err.retries = Math.max(0, dispatchedRequests - 1);
      err.accountingFailure = true;
      err.remoteUsageUncertain = true;
      err.usage = undefined;
      if (activeTransportPort && typeof activeTransportPort.report === 'function') {
        try {
          await activeTransportPort.report({
            provider: this.provider,
            model: this.model,
            attempt: dispatchedRequests,
            ok: false,
            status: response.status,
            error: sanitizeError(err, this.secrets),
            usage: undefined,
            unknownUsage: true,
            durationMs: Date.now() - currentAttemptFetchStart,
            remainingMs: Math.max(0, deadline - Date.now())
          });
        } catch {}
      }
      throw err;
    }

    // Success post-dispatch reporting
    if (activeTransportPort && typeof activeTransportPort.report === 'function') {
      try {
        await activeTransportPort.report({
          provider: this.provider,
          model: this.model,
          attempt: dispatchedRequests,
          ok: true,
          status: response.status,
          error: null,
          usage: {
            inputTokens: promptTokens,
            outputTokens: completionTokens
          },
          unknownUsage: false,
          durationMs: Date.now() - currentAttemptFetchStart,
          remainingMs: Math.max(0, deadline - Date.now())
        });
      } catch {}
    }

    const result = {
      toolCalls: [{ name: fn.name, args }],
      usage: {
        inputTokens: promptTokens,
        outputTokens: completionTokens
      }
    };
    Object.defineProperty(result, 'attempts', {
      value: dispatchedRequests,
      writable: true,
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(result, 'retries', {
      value: Math.max(0, dispatchedRequests - 1),
      writable: true,
      enumerable: false,
      configurable: true
    });
    return result;
  }
}
