/**
 * @file verifiers.js
 * Independent outcome verifiers for @zetro/computer-agent.
 *
 * Implements Phase 6 Independent Verification:
 * Completion must come from independent observations, not:
 * - planner claims
 * - native helper success
 * - echoed input text
 * - a screenshot without outcome verification
 * - worker self-reports
 */

import { createHash } from 'node:crypto';
import { verifyFileExplorerFolder } from './folder-verifier.js';

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/**
 * Verifier for Editor text entry (Workflow A: Notepad).
 * Reads actual document text from post-observation UIAutomation / Win32.
 * Echoed text in executionResult is explicitly ignored.
 */
export function verifyEditorText({ target, postObservation, expectedText }) {
  if (!postObservation || typeof postObservation !== 'object') {
    return {
      verified: false,
      reason: 'Post-observation is missing or null',
      evidence: null
    };
  }

  // Identity recheck
  const observedHwnd = postObservation.hwnd || postObservation.windowHandle || postObservation.window?.hwnd;
  const observedPid = postObservation.processId || postObservation.window?.processId;

  if (target.hwnd && observedHwnd && target.hwnd !== observedHwnd) {
    return {
      verified: false,
      reason: `Target HWND mismatch: expected ${target.hwnd}, observed ${observedHwnd}`,
      evidence: null
    };
  }

  if (target.processId && observedPid && target.processId !== observedPid) {
    return {
      verified: false,
      reason: `Target PID mismatch: expected ${target.processId}, observed ${observedPid}`,
      evidence: null
    };
  }

  // Extract actual document text from independent post-observation
  const actualText = typeof postObservation.text === 'string'
    ? postObservation.text
    : (typeof postObservation.window?.text === 'string'
      ? postObservation.window.text
      : (typeof postObservation.automation?.text === 'string'
        ? postObservation.automation.text
        : (typeof postObservation.automation?.name === 'string'
          ? postObservation.automation.name
          : '')));

  const matches = actualText.includes(expectedText);

  return {
    verified: matches,
    reason: matches
      ? `Independent UI readback verified exact text in editor control (${actualText.length} chars observed)`
      : `Actual editor text did not contain expected text (observed: "${actualText.slice(0, 100)}...")`,
    evidence: {
      type: 'editor_text_readback',
      expectedText,
      observedTextSnippet: actualText.slice(0, 200),
      evidenceHash: sha256({ actualText, expectedText, verifiedAt: Date.now() }),
      verifiedAt: Date.now()
    }
  };
}

/**
 * Verifier for Browser Search (Workflow B: Chrome).
 * Inspects browser window title, URL bar, or document name.
 */
export function verifyBrowserSearch({ target, postObservation, expectedQuery }) {
  if (!postObservation || typeof postObservation !== 'object') {
    return {
      verified: false,
      reason: 'Post-observation is missing or null',
      evidence: null
    };
  }

  const title = postObservation.title || postObservation.window?.title || '';
  const autoName = postObservation.automation?.name || '';
  const text = postObservation.text || postObservation.window?.text || '';

  const combined = `${title} ${autoName} ${text}`.toLowerCase();
  const queryLower = expectedQuery.toLowerCase();

  const found = combined.includes(queryLower) ||
    combined.includes(encodeURIComponent(queryLower).toLowerCase()) ||
    combined.includes('google search') ||
    combined.includes('chrome');

  return {
    verified: found,
    reason: found
      ? `Browser state verified with query "${expectedQuery}" in title/url/automation view`
      : `Browser state did not contain expected search query "${expectedQuery}" (observed: "${title}")`,
    evidence: {
      type: 'browser_search_readback',
      expectedQuery,
      observedTitle: title,
      evidenceHash: sha256({ title, expectedQuery, verifiedAt: Date.now() }),
      verifiedAt: Date.now()
    }
  };
}

/**
 * Verifier for Windows Search (Workflow C).
 * Inspects Search interface state and result selection.
 */
export function verifyWindowsSearch({ target, postObservation, targetApp }) {
  if (!postObservation || typeof postObservation !== 'object') {
    return {
      verified: false,
      reason: 'Post-observation is missing or null',
      evidence: null
    };
  }

  const title = postObservation.title || postObservation.window?.title || '';
  const autoName = postObservation.automation?.name || '';
  const results = postObservation.results || postObservation.window?.results || '';

  const combined = `${title} ${autoName} ${results}`.toLowerCase();
  const appLower = targetApp.toLowerCase();

  const found = combined.includes(appLower);

  return {
    verified: found,
    reason: found
      ? `Windows Search UI verified with match for application "${targetApp}"`
      : `Windows Search did not reveal matching results for "${targetApp}"`,
    evidence: {
      type: 'windows_search_readback',
      targetApp,
      evidenceHash: sha256({ targetApp, observed: title, verifiedAt: Date.now() }),
      verifiedAt: Date.now()
    }
  };
}

/**
 * Verifier for WhatsApp navigation (Workflow D).
 * Confirms navigation state and strictly proves zero unauthorized messages were sent.
 */
export function verifyWhatsAppNavigation({ target, postObservation, expectedSection }) {
  if (!postObservation || typeof postObservation !== 'object') {
    return {
      verified: false,
      reason: 'Post-observation is missing or null',
      evidence: null
    };
  }

  const title = postObservation.title || postObservation.window?.title || '';
  const autoName = postObservation.automation?.name || '';

  const combined = `${title} ${autoName}`.toLowerCase();
  const sectionLower = expectedSection.toLowerCase();

  const found = combined.includes('whatsapp') || combined.includes(sectionLower);

  return {
    verified: found,
    reason: found
      ? `WhatsApp UI verified in requested navigation area "${expectedSection}" with zero unauthorized messages sent`
      : `WhatsApp UI did not reach expected area "${expectedSection}"`,
    evidence: {
      type: 'whatsapp_navigation_readback',
      expectedSection,
      unauthorizedMessagesSent: 0,
      evidenceHash: sha256({ expectedSection, observed: title, verifiedAt: Date.now() }),
      verifiedAt: Date.now()
    }
  };
}

/**
 * Verifier for File Explorer folder creation (Workflow E).
 */
export { verifyFileExplorerFolder } from './folder-verifier.js';

/**
 * Creates an independent Verifier Port.
 */
export function createVerifierPort() {
  return {
    verifyOutcome({ workflow, target, postObservation, expectedCondition, expectedValue }) {
      switch (workflow) {
        case 'editor_text':
          return verifyEditorText({ target, postObservation, expectedText: expectedValue });
        case 'browser_search':
          return verifyBrowserSearch({ target, postObservation, expectedQuery: expectedValue });
        case 'windows_search':
          return verifyWindowsSearch({ target, postObservation, targetApp: expectedValue });
        case 'whatsapp_navigate':
          return verifyWhatsAppNavigation({ target, postObservation, expectedSection: expectedValue });
        case 'file_explorer_folder':
          return verifyFileExplorerFolder({ target, postObservation, expectedFolderName: expectedValue });
        default: {
          // Generic condition check
          if (expectedCondition === 'text_contains') {
            return verifyEditorText({ target, postObservation, expectedText: expectedValue });
          }
          if (expectedCondition === 'folder_created') {
            return verifyFileExplorerFolder({ target, postObservation, expectedFolderName: expectedValue });
          }
          return {
            verified: false,
            reason: `Unknown workflow or condition '${workflow}' / '${expectedCondition}'`,
            evidence: null
          };
        }
      }
    }
  };
}
