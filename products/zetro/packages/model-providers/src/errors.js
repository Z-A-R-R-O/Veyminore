/**
 * Model Providers - Error Hierarchy & Secret Redaction
 *
 * Implements typed error classifications, network diagnostics, and zero-leakage recursive secret redaction.
 */

export function networkCodes(error) {
  const codes = new Set();
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(item.code)) codes.add(item.code);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
    visit(item.cause);
  };
  visit(error);
  return [...codes];
}

export function isTransportFailure(error) {
  if (!error) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  if (error instanceof TypeError && error.message === 'fetch failed') return true;
  if (typeof error.code === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(error.code)) return true;
  if (error.cause && isTransportFailure(error.cause)) return true;
  return false;
}

export function redactSecrets(text, secrets = []) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.trim().length > 0) {
      result = result.replaceAll(secret, '[REDACTED]');
    }
  }
  return result;
}

/**
 * Recursively sanitizes errors, plain objects, causes, arrays, and aggregate errors with cycle protection.
 */
export function sanitizeError(target, secrets = [], seen = new WeakSet()) {
  if (!target) return target;
  if (typeof target !== 'object' && typeof target !== 'function') {
    if (typeof target === 'string') return redactSecrets(target, secrets);
    return target;
  }

  if (seen.has(target)) {
    return '[CIRCULAR]';
  }
  seen.add(target);

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      target[i] = sanitizeError(target[i], secrets, seen);
    }
    return target;
  }

  // Handle Error instances (scrub standard non-enumerable Error fields)
  if (target instanceof Error) {
    if (typeof target.message === 'string') {
      target.message = redactSecrets(target.message, secrets);
    }
    if (typeof target.stack === 'string') {
      target.stack = redactSecrets(target.stack, secrets);
    }
    if ('cause' in target && target.cause) {
      target.cause = sanitizeError(target.cause, secrets, seen);
    }
    if ('errors' in target && Array.isArray(target.errors)) {
      target.errors = target.errors.map(err => sanitizeError(err, secrets, seen));
    }
    // Scrub other custom properties on Error, skipping already processed standard fields
    for (const key of Object.keys(target)) {
      if (key === 'cause' || key === 'errors' || key === 'stack' || key === 'message') continue;
      try {
        const val = target[key];
        if (typeof val === 'string') {
          target[key] = redactSecrets(val, secrets);
        } else if (val && typeof val === 'object') {
          target[key] = sanitizeError(val, secrets, seen);
        }
      } catch {
        // Ignore read-only properties
      }
    }
    return target;
  }

  // Handle plain objects and other object shapes (scrubs ALL keys including message, cause, errors, etc.)
  for (const key of Object.keys(target)) {
    try {
      const val = target[key];
      if (typeof val === 'string') {
        target[key] = redactSecrets(val, secrets);
      } else if (val && typeof val === 'object') {
        target[key] = sanitizeError(val, secrets, seen);
      }
    } catch {
      // Ignore read-only properties
    }
  }

  return target;
}

export class ProviderError extends Error {
  constructor(message, { status = null, retryAfter = null, provider = null, secrets = [], cause = null, attempts, retries, usage, remoteUsageUncertain } = {}) {
    super(redactSecrets(message, secrets));
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.provider = provider;
    if (typeof attempts === 'number') {
      this.attempts = attempts;
      this.retries = typeof retries === 'number' ? retries : Math.max(0, attempts - 1);
    }
    if (usage !== undefined) {
      this.usage = usage;
    }
    if (remoteUsageUncertain !== undefined) {
      this.remoteUsageUncertain = remoteUsageUncertain;
    }
    if (cause) {
      this.cause = sanitizeError(cause, secrets);
    }
    sanitizeError(this, secrets);
  }
}

export class RateLimitError extends ProviderError {
  constructor(message = 'Rate limit reached', options = {}) {
    super(message, { ...options, status: 429 });
    this.name = 'RateLimitError';
  }
}

export class FreeTierDepletedError extends ProviderError {
  constructor(message = 'Free tier limit reached or payment required', options = {}) {
    super(message, { ...options, status: options.status ?? 402 });
    this.name = 'FreeTierDepletedError';
  }
}

export class FreeRoutingViolationError extends ProviderError {
  constructor(message = 'Free routing policy violation', options = {}) {
    super(message, { ...options, status: options.status ?? 403 });
    this.name = 'FreeRoutingViolationError';
  }
}

export class ProviderTransportError extends ProviderError {
  constructor(message = 'Provider transport failed', { attempts = 1, retries, networkCodes = [], remoteUsageUncertain = true, ...options } = {}) {
    super(message, {
      ...options,
      attempts,
      retries: typeof retries === 'number' ? retries : Math.max(0, attempts - 1),
      remoteUsageUncertain
    });
    this.name = 'ProviderTransportError';
    this.attempts = attempts;
    this.retries = typeof retries === 'number' ? retries : Math.max(0, attempts - 1);
    this.remoteUsageUncertain = remoteUsageUncertain;
    this.networkCodes = [...networkCodes];
  }
}

export function redactError(error, secrets = []) {
  return sanitizeError(error, secrets);
}

/**
 * Creates standardized HTTP errors without echoing potentially sensitive response payloads.
 */
export function createHttpError(response, providerName, secrets = [], attempts = 1) {
  const status = response.status;
  const retryAfter = response.headers?.get?.('retry-after') ?? null;
  const computedRetries = Math.max(0, attempts - 1);
  const common = {
    status,
    retryAfter,
    provider: providerName,
    secrets,
    attempts,
    retries: computedRetries,
    remoteUsageUncertain: true
  };

  let error;
  if (status === 429) {
    error = new RateLimitError(`${providerName} rate limit reached`, common);
  } else if (status === 402) {
    error = new FreeTierDepletedError(`${providerName} free tier depleted / payment required (HTTP 402)`, common);
  } else if (status >= 500 && status < 600) {
    error = new ProviderTransportError(`${providerName} HTTP ${status}`, {
      ...common,
      attempts,
      retries: computedRetries,
      networkCodes: [`HTTP_${status}`]
    });
  } else {
    error = new ProviderError(`${providerName} HTTP ${status}`, common);
  }

  error.attempts = attempts;
  error.retries = computedRetries;
  error.remoteUsageUncertain = true;
  return error;
}
