/**
 * @file errors.js
 * Error types for @zetro/policy.
 */

export class PolicyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class PolicyDeniedError extends PolicyError {
  constructor(reason, details = {}, request = null, grantId = null) {
    super(`Policy denied: ${reason}${details.error ? ` (${details.error})` : ''}`, details);
    this.reason = reason;
    this.request = request;
    this.grantId = grantId;
  }
}

export class PolicyValidationError extends PolicyError {
  constructor(message, errors = []) {
    super(message);
    this.errors = errors;
  }
}
