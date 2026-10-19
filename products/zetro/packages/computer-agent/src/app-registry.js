/**
 * @file app-registry.js
 * Application Catalog, dynamic resolution, and safe execution launcher for @zetro/computer-agent.
 * Strictly prevents shell interpolation, path traversal, and unauthorized binary launches.
 */

import { spawn } from 'node:child_process';
import { AgentErrorCode, ComputerAgentError } from './types.js';

/**
 * Declared supported application registry with explicit capabilities and limitations.
 */
export const APPLICATION_CATALOG = Object.freeze({
  notepad: Object.freeze({
    appId: 'notepad',
    canonicalName: 'Notepad',
    aliases: Object.freeze(['notepad', 'notepad.exe', 'text editor', 'editor', 'windows notepad', 'note']),
    executable: 'notepad.exe',
    defaultArgs: Object.freeze([]),
    windowClass: 'Notepad',
    windowTitlePattern: /notepad/i,
    supportedActions: Object.freeze(['launch_app', 'focus_window', 'type_text', 'verify_state']),
    supportsDocumentText: true,
    requiresElevation: false,
    limitations: 'Limited to plain text documents. Multi-tab Notepad windows require explicit window binding.'
  }),
  chrome: Object.freeze({
    appId: 'chrome',
    canonicalName: 'Google Chrome',
    aliases: Object.freeze(['chrome', 'chrome.exe', 'google chrome', 'browser', 'web browser']),
    executable: 'chrome.exe',
    defaultArgs: Object.freeze(['--new-window']),
    windowClass: 'Chrome_WidgetWin_1',
    windowTitlePattern: /chrome|google chrome/i,
    supportedActions: Object.freeze(['launch_app', 'focus_window', 'type_text', 'press_key', 'click_element', 'verify_state']),
    supportsWebSearch: true,
    requiresElevation: false,
    limitations: 'Public search queries only. Untrusted website contents cannot expand agent authority or grant new capabilities.'
  }),
  windows_search: Object.freeze({
    appId: 'windows_search',
    canonicalName: 'Windows Search',
    aliases: Object.freeze(['windows search', 'search', 'start search', 'taskbar search', 'find app']),
    executable: 'explorer.exe',
    defaultArgs: Object.freeze([]),
    windowClass: 'Windows.UI.Core.CoreWindow',
    windowTitlePattern: /search|cortana/i,
    supportedActions: Object.freeze(['launch_app', 'focus_window', 'type_text', 'press_key', 'verify_state']),
    supportsAppDiscovery: true,
    requiresElevation: false,
    limitations: 'Application finding only. Ambiguous application names require explicit clarification before launch.'
  }),
  whatsapp: Object.freeze({
    appId: 'whatsapp',
    canonicalName: 'WhatsApp',
    aliases: Object.freeze(['whatsapp', 'whatsapp desktop', 'whatsapp.exe']),
    executable: 'whatsapp.exe',
    defaultArgs: Object.freeze([]),
    windowClass: 'ApplicationFrameWindow',
    windowTitlePattern: /whatsapp/i,
    supportedActions: Object.freeze(['launch_app', 'focus_window', 'navigate_section', 'verify_state']),
    supportsNavigation: true,
    requiresElevation: false,
    limitations: 'Opening and navigation only when already installed and signed in. Sending messages is strictly prohibited without explicit user instruction specifying both recipient and content.'
  }),
  file_explorer: Object.freeze({
    appId: 'file_explorer',
    canonicalName: 'File Explorer',
    aliases: Object.freeze(['file explorer', 'explorer', 'explorer.exe', 'files', 'downloads', 'documents', 'folder']),
    executable: 'explorer.exe',
    defaultArgs: Object.freeze([]),
    windowClass: 'CabinetWClass',
    windowTitlePattern: /explorer|downloads|documents|this pc|file explorer/i,
    supportedActions: Object.freeze(['launch_app', 'focus_window', 'press_key', 'type_text', 'verify_state']),
    supportsFileNavigation: true,
    requiresElevation: false,
    limitations: 'Folder navigation and creation. Permanent file deletion requires supervisor approval.'
  })
});

/**
 * Published tested capability matrix.
 */
export const TESTED_CAPABILITY_MATRIX = Object.freeze({
  version: '2026-10-18',
  supportedApplications: [
    {
      appId: 'notepad',
      name: 'Notepad',
      testedWorkflows: ['Create document', 'Type text', 'Independent UIAutomation readback', 'Revocation barrier'],
      status: 'verified_native_and_mock'
    },
    {
      appId: 'chrome',
      name: 'Google Chrome',
      testedWorkflows: ['Open new browser window', 'Submit public search query', 'Verify search navigation state'],
      status: 'verified_mock_and_target_scoped'
    },
    {
      appId: 'windows_search',
      name: 'Windows Search',
      testedWorkflows: ['Invoke search interface', 'Query application', 'Verify application match', 'Handle missing/ambiguous'],
      status: 'verified_mock_and_target_scoped'
    },
    {
      appId: 'whatsapp',
      name: 'WhatsApp Desktop',
      testedWorkflows: ['Open when installed', 'Navigate to section', 'Fail closed on missing send authorization'],
      status: 'verified_mock_and_target_scoped'
    }
  ],
  generalLimitations: [
    'No universal application support claimed; only catalogued applications are admitted.',
    'Screen capture pipeline is metadata-only/unsupported until full native capture is qualified.',
    'Prompt interpolation into cmd/powershell shells is strictly prohibited; all processes execute via direct argv.',
    'Consequential actions (messaging, purchases, deletions, credential access) require explicit user authorization.',
    'Untrusted web/application text is treated as passive data and cannot alter policy boundaries.'
  ]
});

/**
 * Resolves an application name or alias against the application catalog.
 * Denies malicious shell metacharacters, path traversals, and ambiguous queries.
 *
 * @param {string} query
 * @returns {{ resolved: boolean, application?: Object, reason?: string, error?: string }}
 */
export function resolveApplication(query) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    return {
      resolved: false,
      reason: AgentErrorCode.APPLICATION_AMBIGUOUS,
      error: 'Application name must be a non-empty string'
    };
  }

  const clean = query.trim().toLowerCase();

  // Security gate: reject shell metacharacters, pipes, backticks, path traversal, flags
  if (/[;&|`$<>\\\/]/.test(clean) || clean.includes('..') || clean.startsWith('-')) {
    return {
      resolved: false,
      reason: AgentErrorCode.MALICIOUS_ARGUMENTS,
      error: `Security violation: Application query '${query}' contains illegal characters or shell metacharacters`
    };
  }

  // Exact ID or alias match
  const matches = [];
  for (const [key, app] of Object.entries(APPLICATION_CATALOG)) {
    if (key === clean || app.canonicalName.toLowerCase() === clean) {
      return { resolved: true, application: app };
    }
    if (app.aliases.some(alias => alias.toLowerCase() === clean)) {
      matches.push(app);
    }
  }

  if (matches.length === 1) {
    return { resolved: true, application: matches[0] };
  }

  // Substring matching with ambiguity detection
  const substringMatches = [];
  for (const app of Object.values(APPLICATION_CATALOG)) {
    if (app.canonicalName.toLowerCase().includes(clean) || clean.includes(app.appId)) {
      if (!substringMatches.includes(app)) {
        substringMatches.push(app);
      }
    }
  }

  if (substringMatches.length === 1) {
    return { resolved: true, application: substringMatches[0] };
  }

  if (substringMatches.length > 1) {
    return {
      resolved: false,
      reason: AgentErrorCode.APPLICATION_AMBIGUOUS,
      error: `Ambiguous application query '${query}' matches multiple applications: ${substringMatches.map(m => m.canonicalName).join(', ')}. Please specify exact name.`
    };
  }

  return {
    resolved: false,
    reason: AgentErrorCode.UNSUPPORTED_APPLICATION,
    error: `Unsupported application '${query}'. Supported applications: ${Object.values(APPLICATION_CATALOG).map(a => a.canonicalName).join(', ')}`
  };
}

/**
 * Creates an Application Registry Port with safe execution capabilities.
 *
 * @param {Object} [options]
 * @param {Function} [options.spawnProcess] Injected process spawner (defaults to node child_process.spawn with shell: false)
 * @returns {Object} ApplicationRegistryPort
 */
export function createApplicationRegistryPort(options = {}) {
  const spawnFn = options.spawnProcess || ((cmd, args, opts) => spawn(cmd, args, { ...opts, shell: false, windowsHide: false }));

  return {
    getCatalog() {
      return APPLICATION_CATALOG;
    },

    getCapabilityMatrix() {
      return TESTED_CAPABILITY_MATRIX;
    },

    resolveApp(query) {
      return resolveApplication(query);
    },

    /**
     * Safely launches an application from the allowlisted catalog.
     * Guaranteed shell: false, strictly validated arguments array.
     *
     * @param {Object} app Application entry from APPLICATION_CATALOG
     * @param {Object} [launchOptions]
     * @param {string[]} [launchOptions.extraArgs=[]]
     * @param {number} [launchOptions.timeoutMs=5000]
     * @returns {Promise<{ pid: number, executable: string, launchedAt: number }>}
     */
    async launchApp(app, { extraArgs = [], timeoutMs = 5000 } = {}) {
      if (!app || typeof app !== 'object' || !app.executable) {
        throw new ComputerAgentError(AgentErrorCode.LAUNCH_FAILED, 'Invalid application object for launch');
      }

      // Security check on extraArgs: all must be strings, no shell redirection
      for (const arg of extraArgs) {
        if (typeof arg !== 'string') {
          throw new ComputerAgentError(AgentErrorCode.MALICIOUS_ARGUMENTS, 'Launch arguments must all be strings');
        }
        if (/[;&|`$]/.test(arg)) {
          throw new ComputerAgentError(AgentErrorCode.MALICIOUS_ARGUMENTS, `Argument '${arg}' contains prohibited shell metacharacters`);
        }
      }

      const args = [...app.defaultArgs, ...extraArgs];

      try {
        const child = spawnFn(app.executable, args, {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false
        });

        if (!child || typeof child.pid !== 'number') {
          throw new Error('Process spawn returned invalid child process object');
        }

        // Unref so parent doesn't hold event loop open
        if (typeof child.unref === 'function') {
          child.unref();
        }

        return {
          pid: child.pid,
          executable: app.executable,
          appId: app.appId,
          launchedAt: Date.now()
        };
      } catch (err) {
        throw new ComputerAgentError(AgentErrorCode.LAUNCH_FAILED, `Failed to launch ${app.canonicalName}: ${err.message}`, {
          executable: app.executable,
          originalError: err
        });
      }
    }
  };
}
