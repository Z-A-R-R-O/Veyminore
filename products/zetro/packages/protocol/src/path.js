/**
 * @file path.js
 * Safe relative path validation and scope checking for ZETRO Protocol.
 */

/**
 * Validates that a string is a safe, canonical relative path.
 * Rejects:
 * - Empty strings or non-strings
 * - Null bytes (\0)
 * - Backslashes (\)
 * - Absolute paths (leading '/' or Windows drive letters)
 * - Directory traversal segments ('.' or '..')
 * - Hidden path segments (starting with '.')
 * - Colons (:)
 *
 * @param {any} value
 * @returns {{ ok: boolean, canonical?: string, reason?: string }}
 */
export function validateRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'Path must be a non-empty string' };
  }
  if (value.length > 1024) {
    return { ok: false, reason: 'Path exceeds maximum length of 1024 characters' };
  }
  if (value.includes('\0')) {
    return { ok: false, reason: 'Path contains null byte' };
  }
  if (value.includes('\\')) {
    return { ok: false, reason: 'Path contains backslash; use forward slash (posix) separators' };
  }
  if (value.startsWith('/')) {
    return { ok: false, reason: 'Path is absolute; relative path required' };
  }
  // Windows drive letter check (e.g. C: or c:)
  if (/^[a-zA-Z]:/.test(value)) {
    return { ok: false, reason: 'Path contains Windows drive letter; relative path required' };
  }

  const segments = value.split('/');
  for (const seg of segments) {
    if (seg === '') {
      return { ok: false, reason: 'Path contains empty segment (e.g. double slash or trailing slash)' };
    }
    if (seg === '.' || seg === '..') {
      return { ok: false, reason: `Path contains traversal segment: '${seg}'` };
    }
    if (seg.startsWith('.')) {
      return { ok: false, reason: `Path contains hidden segment: '${seg}'` };
    }
    if (seg.includes(':')) {
      return { ok: false, reason: `Path segment contains colon: '${seg}'` };
    }
  }

  return { ok: true, canonical: segments.join('/') };
}

/**
 * Validates that a string is a safe, canonical directory path (relative or absolute).
 * Normalizes backslashes (\) to posix forward slashes (/).
 * Canonicalizes Windows drive letters (e.g. c:/ -> C:/).
 * Rejects:
 * - Empty strings or non-strings
 * - Length > 1024 characters
 * - Null bytes (\0)
 * - Traversal segments ('.' or '..')
 * - Trailing slashes (canonicalized away unless root '/' or 'C:/')
 *
 * @param {any} value
 * @returns {{ ok: boolean, canonical?: string, reason?: string }}
 */
export function validateDirectoryPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, reason: 'Path must be a non-empty string' };
  }
  if (value.length > 1024) {
    return { ok: false, reason: 'Path exceeds maximum length of 1024 characters' };
  }
  if (value.includes('\0')) {
    return { ok: false, reason: 'Path contains null byte' };
  }

  // Normalize backslashes to posix forward slashes
  let normalized = value.replace(/\\/g, '/');

  // Strip trailing slashes unless root "/" or "C:/"
  if (normalized.length > 1 && normalized.endsWith('/') && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '');
  }

  // Allow '.' as canonical current working directory
  if (normalized === '.') {
    return { ok: true, canonical: '.' };
  }

  // Windows drive letter check: e.g. C:/ or c:/
  const hasDriveLetter = /^[a-zA-Z]:/.test(normalized);
  if (hasDriveLetter) {
    normalized = normalized.replace(/^([a-zA-Z]):/, (_, d) => `${d.toUpperCase()}:`);
  }

  const isPosixAbsolute = normalized.startsWith('/');

  let segmentsToTest;
  if (hasDriveLetter) {
    const afterDrive = normalized.slice(2);
    if (afterDrive.startsWith('/')) {
      segmentsToTest = afterDrive.slice(1).split('/');
    } else {
      segmentsToTest = afterDrive.split('/');
    }
  } else if (isPosixAbsolute) {
    segmentsToTest = normalized.slice(1).split('/');
  } else {
    segmentsToTest = normalized.split('/');
  }

  for (const seg of segmentsToTest) {
    if (seg === '') {
      return { ok: false, reason: 'Path contains empty segment (e.g. double slash)' };
    }
    if (seg === '.' || seg === '..') {
      return { ok: false, reason: `Path contains traversal segment: '${seg}'` };
    }
    if (seg.includes(':')) {
      return { ok: false, reason: `Path segment contains colon: '${seg}'` };
    }
  }

  return { ok: true, canonical: normalized };
}

/**
 * Checks whether targetPath is within scope of allowedPaths.
 * An allowed path can be an exact file match or a directory prefix.
 * Both targetPath and allowedPaths must be canonical relative paths.
 *
 * @param {string} targetPath
 * @param {string[]} allowedPaths
 * @returns {boolean}
 */
export function isPathInScope(targetPath, allowedPaths) {
  if (!targetPath || !Array.isArray(allowedPaths)) return false;
  const targetSegments = targetPath.split('/');

  for (const allowed of allowedPaths) {
    if (targetPath === allowed) return true;
    const allowedSegments = allowed.split('/');
    if (targetSegments.length > allowedSegments.length) {
      let matches = true;
      for (let i = 0; i < allowedSegments.length; i++) {
        if (targetSegments[i] !== allowedSegments[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
  }

  return false;
}
