/**
 * Strict Boolean Flag Evaluator
 *
 * Implements strict, fail-closed boolean evaluation for configuration flags.
 * Crucially treats '0', 'false', and unknown strings as false, preventing
 * JavaScript truthiness bugs where Boolean('0') === true.
 *
 * Retains restrictive defaults and captures invalid/malformed flag errors
 * to prevent silent bypass of security controls (e.g. ZETRO_FREE_ONLY=typo).
 *
 * Owned by AGR-5.
 */

/**
 * Result of parsing a boolean flag.
 * @typedef {object} BooleanFlagResult
 * @property {boolean} value - Resolved boolean value (retaining restrictive default on invalid input)
 * @property {boolean} isValid - True if input was an explicit valid boolean or unset default; false if malformed/unrecognized
 * @property {boolean} isDefault - True if the value fell back to defaultValue
 * @property {string} [error] - Error message if isValid is false
 */

/**
 * Parses a configuration flag into a strict boolean with complete validation.
 *
 * @param {unknown} value - Value to evaluate
 * @param {string} flagName - Name of the flag for error reporting
 * @param {boolean} [defaultValue=false] - Restrictive fallback default
 * @returns {BooleanFlagResult}
 */
export function parseStrictBooleanFlag(value, flagName, defaultValue = false) {
  const def = Boolean(defaultValue);

  if (value === undefined || value === null) {
    return { value: def, isValid: true, isDefault: true };
  }

  if (typeof value === 'boolean') {
    return { value, isValid: true, isDefault: false };
  }

  if (typeof value === 'number') {
    if (value === 1) return { value: true, isValid: true, isDefault: false };
    if (value === 0) return { value: false, isValid: true, isDefault: false };
    return {
      value: def,
      isValid: false,
      isDefault: true,
      error: `Invalid numeric value '${value}' for boolean flag '${flagName}' (expected 1 or 0)`
    };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { value: def, isValid: true, isDefault: true };
    }

    const lower = trimmed.toLowerCase();
    if (lower === '1' || lower === 'true') {
      return { value: true, isValid: true, isDefault: false };
    }
    if (lower === '0' || lower === 'false') {
      return { value: false, isValid: true, isDefault: false };
    }

    // Fail closed: malformed/unrecognized strings retain the restrictive default and flag an error
    return {
      value: def,
      isValid: false,
      isDefault: true,
      error: `Invalid boolean value '${value}' for flag '${flagName}' (expected '1'/'true' or '0'/'false')`
    };
  }

  return {
    value: def,
    isValid: false,
    isDefault: true,
    error: `Unsupported value type '${typeof value}' for boolean flag '${flagName}'`
  };
}

/**
 * Simple helper to parse a flag into a strict boolean.
 * On invalid or malformed strings, retains the provided restrictive defaultValue.
 *
 * @param {unknown} value
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
export function parseStrictBoolean(value, defaultValue = false) {
  return parseStrictBooleanFlag(value, 'flag', defaultValue).value;
}

/**
 * Returns true if and only if the value is explicitly true ('1', 'true', 1, true).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStrictTrue(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === '1' || trimmed === 'true';
  }
  return false;
}

/**
 * Returns true if and only if the value is explicitly false ('0', 'false', 0, false).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStrictFalse(value) {
  if (value === false || value === 0) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed === '0' || trimmed === 'false';
  }
  return false;
}
