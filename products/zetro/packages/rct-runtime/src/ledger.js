// Honest per-run usage and effect ledger for RCT runtime
// Implements strict accounting across provider attempts, tool calls,
// output bytes, retries, check failures/repairs, wall time, and verified result denominator.

export const ALLOWED_ERROR_CLASSIFICATIONS = Object.freeze(new Set([
  'ProviderTransportError',
  'TimeoutError',
  'AbortError',
  'RateLimitError',
  'ProviderAuthError',
  'ProviderModelError',
  'ProviderError',
  'MalformedResponseError',
  'ToolExecutionError',
  'ToolValidationError',
  'AuthorityDeniedError',
  'ScopeViolationError',
  'BudgetExhaustedError',
  'VerificationFailedError',
  'UnknownError'
]));

export function classifyError(name) {
  if (typeof name === 'string' && ALLOWED_ERROR_CLASSIFICATIONS.has(name)) {
    return name;
  }
  return 'UnknownError';
}

export function isLiteralNonNegativeInteger(val) {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

export class UsageLedger {
  constructor(options = {}) {
    this.clock = typeof options.clock === 'function'
      ? { now: options.clock }
      : (options.clock?.now ? options.clock : { now: () => Date.now() });

    this.startTime = typeof options.startTime === 'number' ? options.startTime : null;
    this.endTime = null;

    // Provider attempts and retries
    this.providerAttempts = 0; // Total provider HTTP/inference attempts across all requests
    this.requests = 0; // Total calls to provider.next()
    this.successfulRequests = 0; // Calls to provider.next() that returned without throwing
    this.failedAttempts = 0; // Attempts that failed/errored
    this.retries = 0; // Total retry attempts

    // Token usage accounting
    this.knownInputTokens = 0;
    this.knownOutputTokens = 0;
    this.hasUnknownUsage = false;
    this.unknownUsageAttempts = 0;

    // Tool execution accounting
    this.toolCalls = 0; // Total tool calls processed (toolCallsSucceeded + toolCallsRejected)
    this.toolCallsSucceeded = 0;
    this.toolCallsRejected = 0;
    this.toolOutputBytes = 0;
    this.toolCallsByName = new Map();

    // Check accounting
    this.checkRuns = 0;
    this.checkFailures = 0;
    this.repairs = 0;
    this._lastCheckState = new Map();

    // Attempt history (compact records, no secrets, no prompts, no source)
    this.attempts = [];
  }

  start(time = null) {
    this.startTime = time !== null ? time : this.clock.now();
  }

  stop(time = null) {
    this.endTime = time !== null ? time : this.clock.now();
  }

  getWallTimeMs() {
    if (this.startTime === null) return 0;
    const end = this.endTime !== null ? this.endTime : this.clock.now();
    return Math.max(0, end - this.startTime);
  }

  recordProviderSuccess({ turn, inputTokens, outputTokens, attempts = 1, retries = 0, uncertainUsage = false, durationMs = 0 } = {}) {
    this.requests++;
    this.successfulRequests++;
    const att = isLiteralNonNegativeInteger(attempts) && attempts >= 1 ? attempts : 1;
    this.providerAttempts += att;
    const ret = isLiteralNonNegativeInteger(retries) ? retries : Math.max(0, att - 1);
    this.retries += ret;

    // Require literal finite non-negative integers; Number(null), booleans, strings must NOT fabricate 0
    const validTokens = isLiteralNonNegativeInteger(inputTokens) && isLiteralNonNegativeInteger(outputTokens);

    if (validTokens) {
      this.knownInputTokens += inputTokens;
      this.knownOutputTokens += outputTokens;
    } else {
      this.hasUnknownUsage = true;
      this.unknownUsageAttempts++;
    }

    if (att > 1) {
      this.hasUnknownUsage = true;
      const priorAttempts = att - 1;
      this.unknownUsageAttempts += priorAttempts;
      this.failedAttempts += priorAttempts;
      for (let i = 1; i <= priorAttempts; i++) {
        this.attempts.push({
          attempt: this.providerAttempts - att + i,
          turn,
          ok: false,
          status: 'retry_failure',
          errorName: 'ProviderTransportError',
          durationMs: 0,
          unknownUsage: true
        });
      }
    } else if (uncertainUsage) {
      this.hasUnknownUsage = true;
      this.unknownUsageAttempts++;
    }

    this.attempts.push({
      attempt: this.providerAttempts,
      turn,
      ok: true,
      status: validTokens ? 'success' : 'missing_usage',
      durationMs: isLiteralNonNegativeInteger(durationMs) ? durationMs : 0,
      unknownUsage: !validTokens || Boolean(uncertainUsage) || att > 1
    });
  }

  recordProviderMissingUsage({ turn, attempts = 1, retries = 0, durationMs = 0 } = {}) {
    this.requests++;
    this.successfulRequests++;
    const att = isLiteralNonNegativeInteger(attempts) && attempts >= 1 ? attempts : 1;
    this.providerAttempts += att;
    const ret = isLiteralNonNegativeInteger(retries) ? retries : Math.max(0, att - 1);
    this.retries += ret;

    this.hasUnknownUsage = true;
    this.unknownUsageAttempts += att;

    if (att > 1) {
      this.failedAttempts += (att - 1);
      for (let i = 1; i < att; i++) {
        this.attempts.push({
          attempt: this.providerAttempts - att + i,
          turn,
          ok: false,
          status: 'retry_failure',
          errorName: 'ProviderTransportError',
          durationMs: 0,
          unknownUsage: true
        });
      }
    }

    this.attempts.push({
      attempt: this.providerAttempts,
      turn,
      ok: true,
      status: 'missing_usage',
      durationMs: isLiteralNonNegativeInteger(durationMs) ? durationMs : 0,
      unknownUsage: true
    });
  }

  recordProviderFailure({ turn, error, errorName, attempts = 1, retries = 0, durationMs = 0 } = {}) {
    this.requests++;
    const att = isLiteralNonNegativeInteger(attempts) && attempts >= 1 ? attempts : 1;
    this.providerAttempts += att;
    this.failedAttempts += att;
    const ret = isLiteralNonNegativeInteger(retries) ? retries : Math.max(0, att - 1);
    this.retries += ret;

    this.hasUnknownUsage = true;
    this.unknownUsageAttempts += att;

    // Strict allowlist: never reflect arbitrary provider error names or synthetic bearer tokens into metrics
    const classifiedName = classifyError(errorName || error?.name);

    if (att > 1) {
      for (let i = 1; i < att; i++) {
        this.attempts.push({
          attempt: this.providerAttempts - att + i,
          turn,
          ok: false,
          status: 'retry_failure',
          errorName: 'ProviderTransportError',
          durationMs: 0,
          unknownUsage: true
        });
      }
    }

    this.attempts.push({
      attempt: this.providerAttempts,
      turn,
      ok: false,
      status: 'failure',
      errorName: classifiedName,
      durationMs: isLiteralNonNegativeInteger(durationMs) ? durationMs : 0,
      unknownUsage: true
    });
  }

  recordProviderFailureWithUsage({ turn, inputTokens, outputTokens, error, errorName, attempts = 1, retries = 0, durationMs = 0 } = {}) {
    this.requests++;
    const att = isLiteralNonNegativeInteger(attempts) && attempts >= 1 ? attempts : 1;
    this.providerAttempts += att;
    this.failedAttempts += att;
    const ret = isLiteralNonNegativeInteger(retries) ? retries : Math.max(0, att - 1);
    this.retries += ret;

    const validTokens = isLiteralNonNegativeInteger(inputTokens) && isLiteralNonNegativeInteger(outputTokens);
    if (validTokens) {
      this.knownInputTokens += inputTokens;
      this.knownOutputTokens += outputTokens;
    }

    this.hasUnknownUsage = true;
    this.unknownUsageAttempts += att;

    const classifiedName = classifyError(errorName || error?.name);

    if (att > 1) {
      for (let i = 1; i < att; i++) {
        this.attempts.push({
          attempt: this.providerAttempts - att + i,
          turn,
          ok: false,
          status: 'retry_failure',
          errorName: 'ProviderTransportError',
          durationMs: 0,
          unknownUsage: true
        });
      }
    }

    this.attempts.push({
      attempt: this.providerAttempts,
      turn,
      ok: false,
      status: 'failure',
      errorName: classifiedName,
      durationMs: isLiteralNonNegativeInteger(durationMs) ? durationMs : 0,
      unknownUsage: true
    });
  }

  recordToolCall(toolName, ok, outputBytes = 0) {
    this.toolCalls++;
    const cleanTool = typeof toolName === 'string' ? toolName.slice(0, 64) : 'unknown';
    if (ok) {
      this.toolCallsSucceeded++;
      this.toolOutputBytes += Math.max(0, Number(outputBytes) || 0);
    } else {
      this.toolCallsRejected++;
      // Output bytes strictly 0 for rejected tool call
    }

    const current = this.toolCallsByName.get(cleanTool) || { calls: 0, succeeded: 0, rejected: 0 };
    current.calls++;
    if (ok) current.succeeded++;
    else current.rejected++;
    this.toolCallsByName.set(cleanTool, current);
  }

  recordCheckResults(checks) {
    if (!Array.isArray(checks)) return;
    this.checkRuns++;
    checks.forEach((c, i) => {
      const key = `${i}:${c.type || 'check'}:${c.path || ''}`;
      const previous = this._lastCheckState.get(key);
      if (!c.passed) {
        this.checkFailures++;
      } else if (previous === false && c.passed === true) {
        this.repairs++;
      }
      this._lastCheckState.set(key, c.passed);
    });
  }

  toMetrics(finalState, finalChecks = [], hasValidPatch = false) {
    // Verified result denominator: worker claims can NEVER certify verified success.
    // Strictly true iff review_ready with independent check verification and effective patch.
    const isVerified = finalState === 'review_ready' &&
      Array.isArray(finalChecks) &&
      finalChecks.length > 0 &&
      finalChecks.every(c => c && c.passed === true) &&
      hasValidPatch === true;

    // Unknown usage remains unknown, never 0
    let inputTokens;
    let outputTokens;
    let totalTokens;

    if (this.hasUnknownUsage) {
      inputTokens = this.knownInputTokens === 0 ? 'unknown' : `${this.knownInputTokens}+unknown`;
      outputTokens = this.knownOutputTokens === 0 ? 'unknown' : `${this.knownOutputTokens}+unknown`;
      const knownTotal = this.knownInputTokens + this.knownOutputTokens;
      totalTokens = knownTotal === 0 ? 'unknown' : `${knownTotal}+unknown`;
    } else {
      inputTokens = this.knownInputTokens;
      outputTokens = this.knownOutputTokens;
      totalTokens = this.knownInputTokens + this.knownOutputTokens;
    }

    return {
      wallTimeMs: this.getWallTimeMs(),
      providerAttempts: this.providerAttempts,
      successfulRequests: this.successfulRequests,
      failedAttempts: this.failedAttempts,
      retries: this.retries,
      hasUnknownUsage: this.hasUnknownUsage,
      unknownUsage: this.hasUnknownUsage,
      unknownUsageAttempts: this.unknownUsageAttempts,
      inputTokens,
      outputTokens,
      totalTokens,
      knownInputTokens: this.knownInputTokens,
      knownOutputTokens: this.knownOutputTokens,
      knownTotalTokens: this.knownInputTokens + this.knownOutputTokens,
      toolCalls: this.toolCalls,
      toolCallsSucceeded: this.toolCallsSucceeded,
      toolCallsRejected: this.toolCallsRejected,
      toolOutputBytes: this.toolOutputBytes,
      checkRuns: this.checkRuns,
      checkFailures: this.checkFailures,
      repairs: this.repairs,
      verified: isVerified,
      denominator: 1,
      attempts: this.attempts.map(a => ({
        attempt: a.attempt,
        turn: a.turn,
        ok: a.ok,
        status: a.status,
        ...(a.errorName ? { errorName: classifyError(a.errorName) } : {}),
        unknownUsage: Boolean(a.unknownUsage),
        durationMs: a.durationMs
      }))
    };
  }
}
