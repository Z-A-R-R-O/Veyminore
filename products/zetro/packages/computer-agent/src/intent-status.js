/**
 * @file intent-status.js
 * Deterministic, privacy-conscious intent-to-status phrase generator for ZETRO Computer Agent.
 *
 * Invariants & Boundaries:
 * 1. Strict Privacy & Label Gating: `allowDisplayLabels === true` literal boolean check
 *    is strictly required before any user label is displayed.
 * 2. Whitelist Sanitization: All labels are sanitized against a strict alphanumeric whitelist;
 *    control characters, paths, URLs, query parameters, typed text, scripts, and sensitive tokens are rejected.
 * 3. No Raw Prompt Parsing/Leakage: Never displays or parses raw user prompts.
 * 4. Bounded Output: Output phrases are deterministic, bounded length, and free of untrusted input.
 * 5. Unknown Fallback: Unknown operations and unrecognized phases fall back to existing activityLabel.
 * 6. Goal Verification Contract: Completed status phrases must only be selected by the caller
 *    AFTER independent outcome verification (verifyGoal === true).
 */

import { activityLabel } from './activity-label.js';

export const SUPPORTED_INTENT_OPERATIONS = Object.freeze([
  'create_folder',
  'open_app',
  'search',
  'move_pointer',
  'unknown'
]);

export const INTENT_PHASES = Object.freeze([
  'intention',
  'observing',
  'thinking',
  'acting',
  'checking',
  'completed',
  'blocked',
  'failed',
  'uncertain',
  'cancelled',
  'stopped'
]);

// Strict whitelist: 1 to 40 alphanumeric characters, single spaces, underscores, or hyphens.
// Rejects all paths, slashes, backslashes, colons, URLs, query chars, quotes, brackets, and control chars.
const SAFE_LABEL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,39}$/;

// Sensitive token blocklist
const SENSITIVE_KEYWORDS = Object.freeze([
  'password',
  'secret',
  'token',
  'credential',
  'bearer',
  'apikey',
  'api_key',
  'private_key',
  'auth'
]);

/**
 * Sanitizes an optional user-provided label string.
 *
 * @param {any} val - Input label value
 * @returns {string|null} Sanitized label or null if rejected
 */
export function sanitizeLabel(val) {
  if (typeof val !== 'string') {
    return null;
  }
  const trimmed = val.trim();
  if (!trimmed || trimmed.length > 40) {
    return null;
  }
  if (!SAFE_LABEL_REGEX.test(trimmed)) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  for (const keyword of SENSITIVE_KEYWORDS) {
    if (lower === keyword || lower.includes(keyword)) {
      return null;
    }
  }
  return trimmed;
}

/**
 * Creates an intent status descriptor instance.
 *
 * @param {object} intent - Structured intent descriptor
 * @param {string} intent.operation - Operation type ('create_folder'|'open_app'|'search'|'move_pointer'|'unknown')
 * @param {string} [intent.application] - Optional target application name
 * @param {string} [intent.targetLabel] - Optional target entity label
 * @param {string} [intent.destinationLabel] - Optional destination label
 * @param {boolean} [intent.allowDisplayLabels=false] - Explicit literal boolean grant to display sanitized labels
 * @returns {{ describe: (phase: string, actionType?: string) => { phase: string, text: string } }}
 */
export function createIntentStatus(intent) {
  if (!intent || typeof intent !== 'object') {
    return {
      describe: (phase, actionType) => activityLabel(phase, actionType)
    };
  }

  const operation = SUPPORTED_INTENT_OPERATIONS.includes(intent.operation)
    ? intent.operation
    : 'unknown';

  if (operation === 'unknown') {
    return {
      describe: (phase, actionType) => activityLabel(phase, actionType)
    };
  }

  // Strict literal boolean enforcement: must be exactly true
  const allowLabels = intent.allowDisplayLabels === true;

  const targetLabel = allowLabels ? sanitizeLabel(intent.targetLabel) : null;
  const destinationLabel = allowLabels ? sanitizeLabel(intent.destinationLabel) : null;
  const application = allowLabels ? sanitizeLabel(intent.application) : null;

  return {
    /**
     * Produces a privacy-safe phase and text status description.
     * Note: 'completed' phase should only be requested after independent goal verification.
     *
     * @param {string} phase - Lifecycle phase
     * @param {string} [actionType] - Optional action type override
     * @returns {{ phase: string, text: string }}
     */
    describe(phase, actionType = null) {
      if (!INTENT_PHASES.includes(phase)) {
        return activityLabel(phase, actionType);
      }

      switch (operation) {
        case 'create_folder': {
          if (targetLabel && destinationLabel) {
            switch (phase) {
              case 'intention': return { phase, text: `I'll create \u2018${targetLabel}\u2019 in ${destinationLabel}.` };
              case 'observing': return { phase, text: `Finding ${destinationLabel}\u2026` };
              case 'thinking': return { phase, text: 'Planning folder creation\u2026' };
              case 'acting': return { phase, text: `Creating \u2018${targetLabel}\u2019\u2026` };
              case 'checking': return { phase, text: 'Checking the folder\u2026' };
              case 'completed': return { phase, text: `\u2018${targetLabel}\u2019 is ready.` };
              case 'blocked': return { phase, text: 'Folder creation needs attention' };
              case 'failed': return { phase, text: 'Unable to create folder' };
              case 'uncertain': return { phase, text: 'Folder creation uncertain' };
              case 'cancelled': return { phase, text: 'Folder creation cancelled' };
              case 'stopped': return { phase, text: 'Folder creation stopped' };
            }
          } else if (targetLabel) {
            switch (phase) {
              case 'intention': return { phase, text: `I'll create \u2018${targetLabel}\u2019.` };
              case 'observing': return { phase, text: 'Finding destination\u2026' };
              case 'thinking': return { phase, text: 'Planning folder creation\u2026' };
              case 'acting': return { phase, text: `Creating \u2018${targetLabel}\u2019\u2026` };
              case 'checking': return { phase, text: 'Checking the folder\u2026' };
              case 'completed': return { phase, text: `\u2018${targetLabel}\u2019 is ready.` };
              case 'blocked': return { phase, text: 'Folder creation needs attention' };
              case 'failed': return { phase, text: 'Unable to create folder' };
              case 'uncertain': return { phase, text: 'Folder creation uncertain' };
              case 'cancelled': return { phase, text: 'Folder creation cancelled' };
              case 'stopped': return { phase, text: 'Folder creation stopped' };
            }
          }
          // Generic fallback for create_folder (labels not allowed or absent)
          switch (phase) {
            case 'intention': return { phase, text: "I'll create the folder." };
            case 'observing': return { phase, text: 'Finding destination\u2026' };
            case 'thinking': return { phase, text: 'Planning folder creation\u2026' };
            case 'acting': return { phase, text: 'Creating folder\u2026' };
            case 'checking': return { phase, text: 'Checking the folder\u2026' };
            case 'completed': return { phase, text: 'Folder is ready.' };
            case 'blocked': return { phase, text: 'Folder creation needs attention' };
            case 'failed': return { phase, text: 'Unable to create folder' };
            case 'uncertain': return { phase, text: 'Folder creation uncertain' };
            case 'cancelled': return { phase, text: 'Folder creation cancelled' };
            case 'stopped': return { phase, text: 'Folder creation stopped' };
          }
          break;
        }

        case 'open_app': {
          const appName = application || targetLabel;
          if (appName) {
            switch (phase) {
              case 'intention': return { phase, text: `I'll open ${appName}.` };
              case 'observing': return { phase, text: `Finding ${appName}\u2026` };
              case 'thinking': return { phase, text: 'Thinking\u2026' };
              case 'acting': return { phase, text: `Opening ${appName}\u2026` };
              case 'checking': return { phase, text: `Checking ${appName}\u2026` };
              case 'completed': return { phase, text: `${appName} is ready.` };
              case 'blocked': return { phase, text: 'Opening application needs attention' };
              case 'failed': return { phase, text: 'Unable to open application' };
              case 'uncertain': return { phase, text: 'Application status uncertain' };
              case 'cancelled': return { phase, text: 'Opening application cancelled' };
              case 'stopped': return { phase, text: 'Opening application stopped' };
            }
          }
          // Generic fallback for open_app
          switch (phase) {
            case 'intention': return { phase, text: "I'll open the application." };
            case 'observing': return { phase, text: 'Finding application\u2026' };
            case 'thinking': return { phase, text: 'Thinking\u2026' };
            case 'acting': return { phase, text: 'Opening application\u2026' };
            case 'checking': return { phase, text: 'Checking application\u2026' };
            case 'completed': return { phase, text: 'Application is ready.' };
            case 'blocked': return { phase, text: 'Opening application needs attention' };
            case 'failed': return { phase, text: 'Unable to open application' };
            case 'uncertain': return { phase, text: 'Application status uncertain' };
            case 'cancelled': return { phase, text: 'Opening application cancelled' };
            case 'stopped': return { phase, text: 'Opening application stopped' };
          }
          break;
        }

        case 'search': {
          if (application) {
            switch (phase) {
              case 'intention': return { phase, text: `I'll search in ${application}.` };
              case 'observing': return { phase, text: `Finding ${application}\u2026` };
              case 'thinking': return { phase, text: 'Planning search\u2026' };
              case 'acting': return { phase, text: `Searching in ${application}\u2026` };
              case 'checking': return { phase, text: 'Checking search results\u2026' };
              case 'completed': return { phase, text: 'Search completed.' };
              case 'blocked': return { phase, text: 'Search needs attention' };
              case 'failed': return { phase, text: 'Unable to complete search' };
              case 'uncertain': return { phase, text: 'Search result uncertain' };
              case 'cancelled': return { phase, text: 'Search cancelled' };
              case 'stopped': return { phase, text: 'Search stopped' };
            }
          }
          // Generic fallback for search (never leaks queries or typed text)
          switch (phase) {
            case 'intention': return { phase, text: "I'll start a search." };
            case 'observing': return { phase, text: 'Locating search\u2026' };
            case 'thinking': return { phase, text: 'Planning search\u2026' };
            case 'acting': return { phase, text: 'Searching\u2026' };
            case 'checking': return { phase, text: 'Checking search results\u2026' };
            case 'completed': return { phase, text: 'Search completed.' };
            case 'blocked': return { phase, text: 'Search needs attention' };
            case 'failed': return { phase, text: 'Unable to complete search' };
            case 'uncertain': return { phase, text: 'Search result uncertain' };
            case 'cancelled': return { phase, text: 'Search cancelled' };
            case 'stopped': return { phase, text: 'Search stopped' };
          }
          break;
        }

        case 'move_pointer': {
          if (targetLabel) {
            switch (phase) {
              case 'intention': return { phase, text: `I'll move pointer to \u2018${targetLabel}\u2019.` };
              case 'observing': return { phase, text: `Locating \u2018${targetLabel}\u2019\u2026` };
              case 'thinking': return { phase, text: 'Thinking\u2026' };
              case 'acting': return { phase, text: `Moving pointer to \u2018${targetLabel}\u2019\u2026` };
              case 'checking': return { phase, text: 'Checking pointer position\u2026' };
              case 'completed': return { phase, text: 'Pointer moved.' };
              case 'blocked': return { phase, text: 'Pointer movement needs attention' };
              case 'failed': return { phase, text: 'Unable to move pointer' };
              case 'uncertain': return { phase, text: 'Pointer position uncertain' };
              case 'cancelled': return { phase, text: 'Pointer movement cancelled' };
              case 'stopped': return { phase, text: 'Pointer movement stopped' };
            }
          }
          // Generic fallback for move_pointer
          switch (phase) {
            case 'intention': return { phase, text: "I'll move the pointer." };
            case 'observing': return { phase, text: 'Locating target\u2026' };
            case 'thinking': return { phase, text: 'Thinking\u2026' };
            case 'acting': return { phase, text: 'Moving pointer\u2026' };
            case 'checking': return { phase, text: 'Checking pointer position\u2026' };
            case 'completed': return { phase, text: 'Pointer moved.' };
            case 'blocked': return { phase, text: 'Needs attention' };
            case 'failed': return { phase, text: 'Unable to continue' };
            case 'uncertain': return { phase, text: 'Result uncertain' };
            case 'cancelled': return { phase, text: 'Cancelled' };
            case 'stopped': return { phase, text: 'Stopped' };
          }
          break;
        }

        default:
          return activityLabel(phase, actionType);
      }

      return activityLabel(phase, actionType);
    }
  };
}
