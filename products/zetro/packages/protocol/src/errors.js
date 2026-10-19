/**
 * @file errors.js
 * Specialized protocol validation errors.
 */

export class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   * @param {string} [schema]
   */
  constructor(message, errors = [], schema = '') {
    super(message);
    this.name = 'ValidationError';
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.schema = schema;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      schema: this.schema,
      errors: this.errors
    };
  }
}

/**
 * Helper to construct an error result or throw
 * @param {string[]} errors
 * @param {string} schema
 * @param {boolean} throwOnError
 */
export function handleValidationFailure(errors, schema, throwOnError) {
  const summary = `Validation failed for ${schema}: ${errors.join('; ')}`;
  if (throwOnError) {
    throw new ValidationError(summary, errors, schema);
  }
  return {
    ok: false,
    schema,
    errors
  };
}
