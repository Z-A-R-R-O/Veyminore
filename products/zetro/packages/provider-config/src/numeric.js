/**
 * Complete Numeric Parser & Bounds Validator
 *
 * Implements strict, complete numeric parsing. Rejects partial parsing
 * (e.g. '1abc' returning 1 via parseInt), non-finite values (NaN, Infinity),
 * negative numbers, and out-of-bounds numbers.
 *
 * Owned by AGR-5.
 */

/**
 * Parses an integer flag with complete string validation and explicit bounds.
 *
 * @param {unknown} value - Raw input value
 * @param {string} flagName - Flag name for error reporting
 * @param {object} options
 * @param {number} [options.min=1] - Minimum allowed value (inclusive)
 * @param {number} [options.max=5] - Maximum allowed value (inclusive)
 * @param {number} [options.defaultValue=1] - Fallback default
 * @returns {{ value: number, isValid: boolean, isDefault: boolean, error?: string }}
 */
export function parseStrictInteger(value, flagName, { min = 1, max = 5, defaultValue = 1 } = {}) {
  if (value === undefined || value === null) {
    return { value: defaultValue, isValid: true, isDefault: true };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return {
        value: defaultValue,
        isValid: false,
        isDefault: true,
        error: `Non-finite or non-integer number '${value}' for flag '${flagName}'`
      };
    }
    if (value < min || value > max) {
      return {
        value: defaultValue,
        isValid: false,
        isDefault: true,
        error: `Value ${value} for '${flagName}' out of bounds [${min}, ${max}]`
      };
    }
    return { value, isValid: true, isDefault: false };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { value: defaultValue, isValid: true, isDefault: true };
    }

    // Complete string match: strictly digits only (optional leading minus for error detection)
    if (!/^-?\d+$/.test(trimmed)) {
      return {
        value: defaultValue,
        isValid: false,
        isDefault: true,
        error: `Malformed integer string '${value}' for flag '${flagName}' (partial or non-numeric tokens rejected)`
      };
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
      return {
        value: defaultValue,
        isValid: false,
        isDefault: true,
        error: `Non-finite or unsafe integer value '${value}' for flag '${flagName}'`
      };
    }

    if (parsed < min || parsed > max) {
      return {
        value: defaultValue,
        isValid: false,
        isDefault: true,
        error: `Integer ${parsed} for '${flagName}' out of bounds [${min}, ${max}]`
      };
    }

    return { value: parsed, isValid: true, isDefault: false };
  }

  return {
    value: defaultValue,
    isValid: false,
    isDefault: true,
    error: `Unsupported type '${typeof value}' for integer flag '${flagName}'`
  };
}

/**
 * Parses a cost/USD limit flag with complete float validation and free-only policy checks.
 *
 * @param {unknown} value - Raw input value
 * @param {string} flagName - Flag name for error reporting
 * @param {object} options
 * @param {boolean} [options.freeOnly=true] - If true, cost must strictly be 0
 * @param {number} [options.maxLimit=100.0] - Upper bound for cost when freeOnly is false
 * @returns {{ value: number, isValid: boolean, isDefault: boolean, error?: string }}
 */
export function parseStrictCost(value, flagName, { freeOnly = true, maxLimit = 100.0 } = {}) {
  if (value === undefined || value === null) {
    return { value: 0, isValid: true, isDefault: true };
  }

  let numValue;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return {
        value: 0,
        isValid: false,
        isDefault: true,
        error: `Non-finite cost number '${value}' for flag '${flagName}'`
      };
    }
    numValue = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { value: 0, isValid: true, isDefault: true };
    }

    // Complete float match: digits with optional single decimal point
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return {
        value: 0,
        isValid: false,
        isDefault: true,
        error: `Malformed numeric cost string '${value}' for flag '${flagName}'`
      };
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return {
        value: 0,
        isValid: false,
        isDefault: true,
        error: `Non-finite cost value '${value}' for flag '${flagName}'`
      };
    }
    numValue = parsed;
  } else {
    return {
      value: 0,
      isValid: false,
      isDefault: true,
      error: `Unsupported type '${typeof value}' for cost flag '${flagName}'`
    };
  }

  // Cost cannot be negative
  if (numValue < 0) {
    return {
      value: 0,
      isValid: false,
      isDefault: true,
      error: `Negative cost $${numValue} is prohibited for flag '${flagName}'`
    };
  }

  // If freeOnly is enabled, cost MUST strictly be zero
  if (freeOnly && numValue > 0) {
    return {
      value: 0,
      isValid: false,
      isDefault: true,
      error: `Non-zero cost ($${numValue}) rejected: freeOnly policy is enabled and requires $0.00 max cost`
    };
  }

  if (numValue > maxLimit) {
    return {
      value: 0,
      isValid: false,
      isDefault: true,
      error: `Cost $${numValue} exceeds maximum ceiling of $${maxLimit.toFixed(2)} for flag '${flagName}'`
    };
  }

  return { value: numValue, isValid: true, isDefault: false };
}
