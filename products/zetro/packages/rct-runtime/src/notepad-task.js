import { createHash } from 'node:crypto';
import {
  COMPUTER_ACTION_SCHEMA_VERSION,
  COMPUTER_RECEIPT_SCHEMA_VERSION,
  executeComputerAction,
  validateComputerTarget,
  validateComputerSession
} from './computer-action-port.js';

export const NOTEPAD_SUCCESS_SENTENCE = 'Success \u2014 Codex, AGR, and OCR completed this sentence using ZETRO Computing.';

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/**
 * Documented supported intent subset for prompt-driven ZETRO Computing skill.
 * Pure deterministic local regex/grammar parser supporting a bounded subset of desktop text-entry intents.
 * Does not use external inference; does not claim general natural-language understanding.
 */
export const SUPPORTED_INTENT_SUBSET = Object.freeze({
  version: 'zetro.computing.skill.intent_subset.v1',
  disclaimer: 'Deterministic local regex/grammar parser supporting a bounded subset of desktop text-entry intents without external inference. Does not claim arbitrary natural language understanding.',
  supportedIntents: [
    'app_open_and_type_text'
  ],
  syntaxPatterns: [
    'Open [a new] <app> [document|file|window] and type|write|enter "<text>"',
    'Launch <app> and type|write|enter "<text>"',
    'Start <app> [, then] type|write|enter "<text>"',
    'In <app>, type|write|enter "<text>"',
    'Create a new [document|file] in <app> and type|write|enter "<text>"',
    'Please open <app> and type|write|enter "<text>"'
  ]
});

/**
 * Allowlisted application registry for dynamic application resolution.
 * Strictly prevents shell interpolation, path traversal, or executing arbitrary executables.
 */
export const APPLICATION_REGISTRY = Object.freeze({
  notepad: Object.freeze({
    appId: 'notepad',
    canonicalName: 'Notepad',
    aliases: Object.freeze(['notepad', 'notepad.exe', 'text editor', 'windows notepad']),
    executable: 'notepad.exe',
    windowClass: 'Notepad',
    supportsDocumentText: true
  })
});

/**
 * Resolves an application name string against the allowlisted registry.
 * Strictly prevents shell interpolation, executable paths, or arbitrary names.
 *
 * @param {string} appName
 * @returns {{ resolved: boolean, application?: Object, reason?: string, error?: string }}
 */
export function resolveApplication(appName) {
  if (typeof appName !== 'string' || appName.trim().length === 0) {
    return { resolved: false, reason: 'missing_app_name', error: 'Application name is required' };
  }
  const cleanName = appName.trim().toLowerCase();

  // Security check: reject shell metacharacters, pipes, redirects, backticks, path traversal, flag options
  if (/[;&|`$<>\\\/]/.test(cleanName) || cleanName.includes('..') || cleanName.startsWith('-')) {
    return {
      resolved: false,
      reason: 'malicious_arguments',
      error: 'Security violation: Application name contains illegal characters or shell metacharacters'
    };
  }

  for (const [key, entry] of Object.entries(APPLICATION_REGISTRY)) {
    if (key === cleanName || entry.aliases.some(a => a.toLowerCase() === cleanName)) {
      return { resolved: true, application: entry };
    }
  }

  return {
    resolved: false,
    reason: 'unsupported_application',
    error: `Unsupported application '${appName}'. Only allowlisted applications in APPLICATION_REGISTRY are supported.`
  };
}

/**
 * Extracts quoted text from a prompt, supporting standard double/single quotes and Unicode typographic quotes.
 * @param {string} text
 * @returns {string|null}
 */
function extractQuotedText(text) {
  // Matches "...", '...', “...”, or ‘...’
  const quoteRegex = /["'“‘]([\s\S]+?)["'”’]/;
  const match = text.match(quoteRegex);
  return match ? match[1] : null;
}

/**
 * Parses a natural language prompt to determine operator intent, target application, and text payload.
 * Local deterministic parser for the documented SUPPORTED_INTENT_SUBSET.
 *
 * @param {string} prompt
 * @returns {{ ok: boolean, blocked?: boolean, intent?: string, application?: Object, text?: string, reason?: string, error?: string, rawPrompt: string }}
 */
export function parseComputingPromptIntent(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      ok: false,
      blocked: true,
      reason: 'ambiguous_prompt',
      error: 'Prompt must be a non-empty string',
      rawPrompt: prompt
    };
  }

  const cleanPrompt = prompt.trim();

  // Security gate: detect shell injection attempts in the prompt
  if (/[;&|`$]/.test(cleanPrompt)) {
    return {
      ok: false,
      blocked: true,
      reason: 'malicious_arguments',
      error: 'Security violation: Prompt contains prohibited shell metacharacters',
      rawPrompt: cleanPrompt
    };
  }

  // Extract text payload
  const extractedText = extractQuotedText(cleanPrompt);

  // Paraphrase patterns matching supported open-and-type intent
  // Matches variations of:
  // - Open [a [new]] <app> [document|file|window] and type/write/enter ...
  // - Launch <app> and type/write/enter ...
  // - Start <app> [, then] type/write/enter ...
  // - In <app>, type/write/enter ...
  // - Create a new [document|file] in <app> and type/write/enter ...
  // - Please open [a new] <app> [document] and type/write/enter ...
  const patterns = [
    /^(?:please\s+)?open\s+(?:a\s+(?:new\s+)?)?([a-zA-Z0-9_.-]+)(?:\s+(?:document|file|window))?\s+and\s+(?:type|write|enter)(?::)?(?:\s+|$)/i,
    /^(?:please\s+)?launch\s+([a-zA-Z0-9_.-]+)(?:\s+(?:document|file|window))?\s+and\s+(?:type|write|enter)(?::)?(?:\s+|$)/i,
    /^(?:please\s+)?start\s+([a-zA-Z0-9_.-]+)(?:,\s*then|\s+and)?\s+(?:type|write|enter)(?::)?(?:\s+|$)/i,
    /^in\s+([a-zA-Z0-9_.-]+),\s*(?:please\s+)?(?:type|write|enter)(?::)?(?:\s+|$)/i,
    /^(?:please\s+)?create\s+a\s+new\s+(?:document|file)\s+in\s+([a-zA-Z0-9_.-]+)\s+and\s+(?:type|write|enter)(?::)?(?:\s+|$)/i
  ];

  let rawAppName = null;
  for (const pattern of patterns) {
    const match = cleanPrompt.match(pattern);
    if (match) {
      rawAppName = match[1];
      break;
    }
  }

  // If no application was captured by the patterns, check if prompt is ambiguous or unsupported intent
  if (!rawAppName) {
    // Check if user asked to type something without specifying an app
    if (/(?:type|write|enter)\s+["'“‘]/i.test(cleanPrompt)) {
      return {
        ok: false,
        blocked: true,
        reason: 'ambiguous_prompt',
        error: 'Ambiguous prompt: Target application is missing or unspecified',
        rawPrompt: cleanPrompt
      };
    }

    return {
      ok: false,
      blocked: true,
      reason: 'unsupported_intent',
      error: `Unsupported prompt intent. Supported subset: ${SUPPORTED_INTENT_SUBSET.syntaxPatterns.join(' | ')}`,
      rawPrompt: cleanPrompt
    };
  }

  // Check if text was quoted
  if (!extractedText) {
    return {
      ok: false,
      blocked: true,
      reason: 'ambiguous_prompt',
      error: 'Ambiguous prompt: Text payload must be specified in quotes',
      rawPrompt: cleanPrompt
    };
  }

  // Resolve application against allowlist
  const appResolution = resolveApplication(rawAppName);
  if (!appResolution.resolved) {
    return {
      ok: false,
      blocked: true,
      reason: appResolution.reason,
      error: appResolution.error,
      rawPrompt: cleanPrompt
    };
  }

  return {
    ok: true,
    intent: 'app_open_and_type_text',
    application: appResolution.application,
    text: extractedText,
    rawPrompt: cleanPrompt
  };
}

/**
 * Deterministic Computing Skill Planner.
 * Interprets natural-language prompt and builds a structured action plan without external inference.
 *
 * @param {Object} params
 * @param {string} params.prompt Natural language prompt
 * @param {string} [params.operatorId='operator'] Operator identifier (e.g. 'Codex', 'AGR-1', 'OCR-1')
 * @param {string} [params.taskId]
 * @param {string} [params.sessionId]
 * @param {number|string} [params.attemptId]
 * @returns {Object} Structured plan or blocked result
 */
export function planComputingSkill({
  prompt,
  operatorId = 'operator',
  taskId = `task-${Date.now()}`,
  sessionId = `sess-${Date.now()}`,
  attemptId = 1
} = {}) {
  const parsed = parseComputingPromptIntent(prompt);
  if (!parsed.ok) {
    return {
      ok: false,
      blocked: true,
      reason: parsed.reason,
      error: parsed.error,
      operatorId,
      taskId,
      sessionId,
      attemptId,
      rawPrompt: parsed.rawPrompt,
      plan: null
    };
  }

  return {
    ok: true,
    blocked: false,
    intent: parsed.intent,
    operatorId,
    taskId,
    sessionId,
    attemptId,
    application: parsed.application,
    expectedText: parsed.text,
    rawPrompt: parsed.rawPrompt,
    plan: [
      {
        step: 1,
        action: 'resolve_target',
        appId: parsed.application.appId,
        canonicalName: parsed.application.canonicalName,
        executable: parsed.application.executable
      },
      {
        step: 2,
        action: 'type_text',
        appId: parsed.application.appId,
        parameters: { text: parsed.text }
      },
      {
        step: 3,
        action: 'verify_readback',
        appId: parsed.application.appId,
        expectedText: parsed.text
      }
    ]
  };
}

/**
 * Creates an Observer port adapter wrapping an injected Windows observation provider.
 * Consumes the provider's bounded inspectWindow, observeWindow, or observeTarget interface.
 * Strictly avoids spawning raw helper executables or direct shell execution.
 *
 * @param {Object} windowsProvider Injected windows observation provider
 * @returns {Object} Observer conforming to ComputerActionPort observer contract
 */
export function createWindowsProviderObserverAdapter(windowsProvider) {
  if (!windowsProvider || typeof windowsProvider !== 'object') {
    throw new Error('windowsProvider must be a non-null object');
  }

  return {
    async observeTarget(target, { signal } = {}) {
      if (typeof windowsProvider.observeTarget === 'function') {
        return await windowsProvider.observeTarget(target, { signal });
      }

      if (typeof windowsProvider.inspectWindow === 'function') {
        const hwnd = typeof target.windowHandle === 'number'
          ? target.windowHandle
          : (typeof target.windowHandle === 'string' && /^\d+$/.test(target.windowHandle.trim()))
            ? Number(target.windowHandle.trim())
            : target.windowHandle;

        const inspected = await windowsProvider.inspectWindow(hwnd, { signal });
        const w = inspected?.window || {};
        const auto = inspected?.automation || {};

        return {
          observedAt: inspected?.observedAt || Date.now(),
          targetId: target.targetId,
          processId: w.processId ?? target.processId,
          windowHandle: w.hwnd ?? target.windowHandle,
          processStartedAt: w.processStartedAt ?? target.processStartedAt,
          generation: w.generation ?? target.generation,
          title: w.title ?? target.title ?? 'Notepad',
          active: w.minimized === false && w.visible !== false,
          isForeground: inspected?.isForeground ?? w.isForeground ?? true,
          bounds: w.bounds || { x: 0, y: 0, width: 800, height: 600 },
          text: inspected?.text ?? w.text ?? auto.text ?? auto.value ?? auto.name ?? '',
          snapshotHash: inspected?.snapshotHash || null
        };
      }

      if (typeof windowsProvider.observeWindow === 'function') {
        const obs = await windowsProvider.observeWindow({
          hwnd: target.windowHandle,
          expectedProcessId: target.processId
        });
        const w = obs?.window || {};
        return {
          observedAt: obs?.observedAt || Date.now(),
          targetId: target.targetId,
          processId: w.processId ?? target.processId,
          windowHandle: w.hwnd ?? target.windowHandle,
          processStartedAt: w.processStartedAt ?? target.processStartedAt,
          generation: w.generation ?? target.generation,
          title: w.title ?? target.title ?? 'Notepad',
          active: w.minimized === false && w.visible !== false,
          isForeground: obs?.isForeground ?? w.isForeground ?? true,
          bounds: w.bounds || { x: 0, y: 0, width: 800, height: 600 },
          text: obs?.text ?? w.text ?? '',
          snapshotHash: obs?.snapshotHash || null
        };
      }

      throw new Error('windowsProvider does not implement observeTarget, inspectWindow, or observeWindow');
    },

    isForeground(target) {
      if (typeof windowsProvider.isForeground === 'function') {
        return windowsProvider.isForeground(target);
      }
      if (typeof windowsProvider.getForegroundWindow === 'function') {
        return windowsProvider.getForegroundWindow() === target.windowHandle;
      }
      if (windowsProvider.isForeground !== undefined) {
        return Boolean(windowsProvider.isForeground);
      }
      return true;
    }
  };
}

/**
 * Creates an independent readback verifier for document text input.
 * Strictly inspects actual post-observation UI text and native identity.
 * Caller or executor echoed text is deliberately IGNORED to prevent false verification.
 *
 * @param {string} [expectedSentence=NOTEPAD_SUCCESS_SENTENCE]
 * @returns {Object} Trusted verifier conforming to ComputerActionPort verifier contract
 */
export function createNotepadTextVerifier(expectedSentence = NOTEPAD_SUCCESS_SENTENCE) {
  return {
    async verifyEffect({ actionRequest, preObservation, postObservation, executionResult }) {
      if (!postObservation || typeof postObservation !== 'object' || postObservation.error) {
        return {
          verified: false,
          reason: `Post-observation missing or errored: ${postObservation?.error || 'no post-observation'}`,
          checks: [{ type: 'post_observation_valid', passed: false }]
        };
      }

      // Recheck native identity
      const identityMatched = postObservation.processId === actionRequest.target.processId &&
        postObservation.windowHandle === actionRequest.target.windowHandle;

      if (!identityMatched) {
        return {
          verified: false,
          reason: `Target identity mismatch in post-observation: observed PID ${postObservation.processId} vs requested ${actionRequest.target.processId}`,
          checks: [{ type: 'identity_match', passed: false }]
        };
      }

      // Recheck recycled PID prevention
      if (actionRequest.target.processStartedAt !== undefined &&
          postObservation.processStartedAt !== undefined &&
          postObservation.processStartedAt !== actionRequest.target.processStartedAt) {
        return {
          verified: false,
          reason: 'Post-observation processStartedAt mismatch: recycled PID detected',
          checks: [{ type: 'process_started_at_match', passed: false }]
        };
      }

      if (actionRequest.target.generation !== undefined &&
          postObservation.generation !== undefined &&
          String(postObservation.generation) !== String(actionRequest.target.generation)) {
        return {
          verified: false,
          reason: `Post-observation generation mismatch: ${postObservation.generation} vs ${actionRequest.target.generation}`,
          checks: [{ type: 'generation_match', passed: false }]
        };
      }

      // Fresh UI readback: MUST inspect postObservation.text, NOT executionResult.text
      const actualText = typeof postObservation.text === 'string'
        ? postObservation.text
        : (postObservation.window && typeof postObservation.window.text === 'string')
          ? postObservation.window.text
          : '';

      const textMatches = actualText.includes(expectedSentence);

      return {
        verified: textMatches,
        reason: textMatches
          ? 'Independent UIAutomation readback confirmed exact sentence in Notepad'
          : `Post-observation text did not contain expected sentence (actual text: '${actualText.slice(0, 80)}')`,
        evidenceHash: sha256({
          actualText,
          expectedSentence,
          verifiedAt: Date.now()
        }),
        checks: [
          { type: 'identity_match', passed: true },
          { type: 'ui_text_readback', passed: textMatches, expected: expectedSentence, found: actualText }
        ]
      };
    }
  };
}

/**
 * Runs a prompt-driven or parameterized Notepad success sentence task through the injected Computer Action-Execution Port.
 *
 * Requirements:
 * 1. Default disabled: requires explicit options.nativeInputEnabled: true AND options.fixtureOptIn: true.
 * 2. Consumes injected windowsProvider port (adapts inspectWindow/observeWindow/observeTarget).
 * 3. Enforces shared authority, exact target identity, fresh post-effect UI readback.
 * 4. Zero live network or helper spawning; executes through injected ports.
 * 5. Prompt-driven: if prompt is supplied, parses intent dynamically and extracts target text.
 *
 * @param {Object} params
 * @param {Object} params.windowsProvider Injected Windows observation provider port
 * @param {Object} params.authorityPort Injected shared authority / policy port
 * @param {Object} params.executor Injected native input executor port
 * @param {Object} [params.verifier] Optional verifier override; defaults to independent readback verifier
 * @param {Object} params.target Target window descriptor
 * @param {Object} params.session Validated computer session
 * @param {string} [params.prompt] Natural-language operator prompt (e.g. 'Open a new Notepad document and type "..."')
 * @param {string} [params.operatorId='operator'] Operator identifier (e.g. 'Codex', 'AGR-1')
 * @param {string} [params.expectedSentence] Optional sentence override when prompt is omitted
 * @param {Object} [params.options] Execution options
 * @param {boolean} [params.options.nativeInputEnabled=false] Explicit native input gate
 * @param {boolean} [params.options.fixtureOptIn=false] Explicit fixture opt-in gate
 * @returns {Promise<Object>} Execution receipt
 */
export async function runNotepadSuccessTask({
  windowsProvider,
  authorityPort,
  executor,
  verifier = null,
  target,
  session,
  prompt,
  operatorId = 'operator',
  expectedSentence,
  options = {}
} = {}) {
  // Gate 1: nativeInputEnabled must be literal true
  if (options.nativeInputEnabled !== true) {
    const err = new Error('Native input disabled: options.nativeInputEnabled must be literal true to execute notepad task');
    err.name = 'NativeInputDisabledError';
    err.executorCalls = 0;
    throw err;
  }

  // Gate 2: fixtureOptIn must be literal true
  if (options.fixtureOptIn !== true) {
    const err = new Error('Fixture opt-in required: options.fixtureOptIn must be literal true to run notepad task fixture');
    err.name = 'FixtureOptInRequiredError';
    err.executorCalls = 0;
    throw err;
  }

  // Injected ports validation
  if (!windowsProvider || typeof windowsProvider !== 'object') {
    const err = new Error('Missing windowsProvider: injected Windows observation provider port is required');
    err.name = 'MissingWindowsProviderError';
    err.executorCalls = 0;
    throw err;
  }

  if (!authorityPort || typeof authorityPort.evaluateAction !== 'function') {
    const err = new Error('Missing authorityPort: authorityPort.evaluateAction is required');
    err.name = 'MissingAuthorityPortError';
    err.executorCalls = 0;
    throw err;
  }

  if (!executor || typeof executor.executeAction !== 'function') {
    const err = new Error('Missing executor: executor.executeAction is required');
    err.name = 'MissingExecutorError';
    err.executorCalls = 0;
    throw err;
  }

  // Prompt interpretation (if prompt is supplied)
  let targetText = expectedSentence || NOTEPAD_SUCCESS_SENTENCE;
  if (prompt) {
    const parseResult = parseComputingPromptIntent(prompt);
    if (!parseResult.ok) {
      const err = new Error(`Prompt blocked: ${parseResult.error}`);
      err.name = 'BlockedPromptError';
      err.reason = parseResult.reason;
      err.rawPrompt = parseResult.rawPrompt;
      err.executorCalls = 0;
      throw err;
    }
    targetText = parseResult.text;
  }

  const validatedTarget = validateComputerTarget(target);
  const validatedSession = validateComputerSession({
    ...session,
    principal: session?.principal || operatorId
  });

  // Adapt injected windowsProvider to observer interface
  const observer = createWindowsProviderObserverAdapter(windowsProvider);

  // Default to independent UI readback verifier if none provided
  const activeVerifier = verifier || createNotepadTextVerifier(targetText);

  const actionRequest = {
    schemaVersion: COMPUTER_ACTION_SCHEMA_VERSION,
    actionId: options.actionId || `act-notepad-${Date.now()}`,
    actionType: 'type_text',
    target: validatedTarget,
    parameters: {
      text: targetText
    },
    sessionId: validatedSession.sessionId,
    taskId: validatedSession.taskId,
    attemptId: validatedSession.attemptId,
    createdAt: options.createdAt || Date.now()
  };

  return await executeComputerAction({
    actionRequest,
    session: validatedSession,
    authorityPort,
    observer,
    executor,
    verifier: activeVerifier,
    options: {
      ...options,
      nativeInputEnabled: true
    }
  });
}

/**
 * Runs a prompt-driven Computing skill task.
 * Requires natural language prompt, resolves application dynamically, and guards execution.
 */
export async function runPromptDrivenTask(params) {
  if (!params?.prompt || typeof params.prompt !== 'string') {
    const err = new Error('Prompt is required and must be a string for runPromptDrivenTask');
    err.name = 'MissingPromptError';
    err.executorCalls = 0;
    throw err;
  }
  return await runNotepadSuccessTask(params);
}
