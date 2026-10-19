/**
 * Dependency-Free .env Parser
 *
 * Safely parses .env format strings and synthetic files without third-party dependencies.
 *
 * Owned by AGR-5.
 */

import fs from 'node:fs';

/**
 * Parses .env file contents into a key-value dictionary.
 *
 * @param {string} content - Raw content of .env file
 * @returns {Record<string, string>}
 */
export function parseDotEnv(content) {
  if (typeof content !== 'string') {
    return {};
  }

  const result = {};
  const lines = content.split(/\r?\n/);

  for (let rawLine of lines) {
    let line = rawLine.trim();

    // Skip empty lines and comment lines
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Strip optional "export " prefix
    if (line.startsWith('export ')) {
      line = line.slice(7).trim();
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }

    let val = line.slice(eqIndex + 1).trim();

    // Handle double-quoted string
    if (val.startsWith('"')) {
      // Find matching closing quote
      let endQuote = -1;
      let escaped = false;
      for (let i = 1; i < val.length; i++) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (val[i] === '\\') {
          escaped = true;
          continue;
        }
        if (val[i] === '"') {
          endQuote = i;
          break;
        }
      }

      if (endQuote !== -1) {
        val = val.slice(1, endQuote)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      } else {
        // Unclosed double quote: take rest of string without opening quote
        val = val.slice(1);
      }
    } else if (val.startsWith("'")) {
      // Single quoted: raw string until next single quote
      const endQuote = val.indexOf("'", 1);
      if (endQuote !== -1) {
        val = val.slice(1, endQuote);
      } else {
        val = val.slice(1);
      }
    } else {
      // Unquoted: strip trailing inline comments (separated by space + #)
      const commentIdx = val.search(/\s+#/);
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }
    }

    result[key] = val;
  }

  return result;
}

/**
 * Safely reads and parses a .env file from disk.
 *
 * @param {string} filePath - Absolute or relative path to .env file
 * @returns {Record<string, string>}
 */
export function parseDotEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return parseDotEnv(content);
  } catch {
    return {};
  }
}
