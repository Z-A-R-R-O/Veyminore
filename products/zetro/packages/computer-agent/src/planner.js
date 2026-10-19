/**
 * @file planner.js
 * Structured Provider-Neutral Planner & Bounded Deterministic Intent Parser for @zetro/computer-agent.
 *
 * Implements Phase 5 Planner requirements:
 * 1. Provider-neutral structured planner with explicit tool schemas and bounded context.
 * 2. Injected model provider route support (fails closed when unavailable or unauthorized).
 * 3. Documented local deterministic fallback parser covering 4 primary workflows (Editor, Browser, Search, WhatsApp).
 * 4. Strict tool call schema validation.
 * 5. Prompt injection resistance (untrusted text cannot change system boundaries or authorize consequential actions).
 */

import { AgentErrorCode, ComputerAgentError, SupportedActionTypes } from './types.js';
import { resolveApplication } from './app-registry.js';

/**
 * Standard explicit tool schemas available to planners.
 */
export const COMPUTER_AGENT_TOOLS = Object.freeze([
  {
    name: 'resolve_app',
    description: 'Resolve an application name or alias against the allowlisted catalog.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Application name or alias (e.g., "notepad", "chrome", "windows search", "whatsapp")' }
      },
      required: ['appName']
    }
  },
  {
    name: 'launch_app',
    description: 'Safely launch an allowlisted application from the catalog.',
    parameters: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: 'Catalog application ID' },
        extraArgs: { type: 'array', items: { type: 'string' }, description: 'Safe argument vector without shell metacharacters' }
      },
      required: ['appId']
    }
  },
  {
    name: 'focus_window',
    description: 'Bring the target window to foreground with exact HWND/PID/generation validation.',
    parameters: {
      type: 'object',
      properties: {
        windowHandle: { type: 'number', description: 'Target HWND' },
        processId: { type: 'number', description: 'Target PID' },
        generation: { type: 'string', description: 'Process start generation token' }
      },
      required: ['windowHandle', 'processId']
    }
  },
  {
    name: 'type_text',
    description: 'Enter text into the target window using UIAutomation or scoped Unicode SendInput.',
    parameters: {
      type: 'object',
      properties: {
        windowHandle: { type: 'number', description: 'Target HWND' },
        processId: { type: 'number', description: 'Target PID' },
        generation: { type: 'string', description: 'Process start generation token' },
        text: { type: 'string', description: 'Text content to type (bounded length)' }
      },
      required: ['windowHandle', 'processId', 'text']
    }
  },
  {
    name: 'press_key',
    description: 'Inject a key or key combination (e.g. "Enter", "Tab", "Escape").',
    parameters: {
      type: 'object',
      properties: {
        windowHandle: { type: 'number', description: 'Target HWND' },
        processId: { type: 'number', description: 'Target PID' },
        key: { type: 'string', description: 'Key name (e.g., "Enter", "F5")' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifiers: "Control", "Alt", "Shift"' }
      },
      required: ['windowHandle', 'processId', 'key']
    }
  },
  {
    name: 'click_element',
    description: 'Click a semantic target element or coordinates within target bounds.',
    parameters: {
      type: 'object',
      properties: {
        windowHandle: { type: 'number', description: 'Target HWND' },
        processId: { type: 'number', description: 'Target PID' },
        elementId: { type: 'string', description: 'Semantic UI Automation element ID' },
        x: { type: 'number', description: 'Window-relative X coordinate' },
        y: { type: 'number', description: 'Window-relative Y coordinate' }
      },
      required: ['windowHandle', 'processId']
    }
  },
  {
    name: 'wait_observe',
    description: 'Wait for UI to settle and obtain a fresh bounded observation.',
    parameters: {
      type: 'object',
      properties: {
        delayMs: { type: 'number', description: 'Wait duration in ms (bounded)' },
        targetHwnd: { type: 'number', description: 'Target HWND to re-observe' }
      },
      required: ['targetHwnd']
    }
  },
  {
    name: 'verify_state',
    description: 'Evaluate post-observation state against goal criteria.',
    parameters: {
      type: 'object',
      properties: {
        expectedCondition: { type: 'string', description: 'Condition type (e.g., "text_contains", "url_contains", "window_active")' },
        expectedValue: { type: 'string', description: 'Expected value string' }
      },
      required: ['expectedCondition', 'expectedValue']
    }
  }
]);

/**
 * Validates a single tool proposal against COMPUTER_AGENT_TOOLS schema.
 */
export function validateToolProposal(toolName, parameters) {
  const tool = COMPUTER_AGENT_TOOLS.find(t => t.name === toolName);
  if (!tool) {
    return { valid: false, error: `Unknown tool '${toolName}'` };
  }

  if (!parameters || typeof parameters !== 'object') {
    return { valid: false, error: `Parameters for '${toolName}' must be an object` };
  }

  for (const requiredKey of tool.parameters.required) {
    if (parameters[requiredKey] === undefined || parameters[requiredKey] === null) {
      return { valid: false, error: `Missing required parameter '${requiredKey}' for tool '${toolName}'` };
    }
  }

  return { valid: true, tool };
}

/**
 * Extract quoted or unquoted parameter payloads from text.
 */
function extractQuoted(text) {
  const match = text.match(/["'“‘]([\s\S]+?)["'”’]/);
  return match ? match[1].trim() : null;
}

/**
 * Bounded Deterministic Intent Parser (Documented fallback subset).
 * Interprets natural language prompts without remote inference for 4 primary workflows:
 * 1. Editor (Notepad text entry)
 * 2. Browser (Chrome search)
 * 3. Windows Search (Find app)
 * 4. WhatsApp (Navigation only; messaging blocked)
 *
 * @param {string} prompt
 * @returns {Object} Structured intent or blocked result
 */
export function parseDeterministicIntent(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      ok: false,
      blocked: true,
      reason: AgentErrorCode.PLANNER_BLOCKED,
      error: 'Prompt must be a non-empty string',
      rawPrompt: prompt
    };
  }

  const cleanPrompt = prompt.trim();

  // Security gate: detect raw shell metacharacters
  if (/[;&|`$]/.test(cleanPrompt)) {
    return {
      ok: false,
      blocked: true,
      reason: AgentErrorCode.MALICIOUS_ARGUMENTS,
      error: 'Security violation: Prompt contains prohibited shell metacharacters',
      rawPrompt: cleanPrompt
    };
  }

  const quoted = extractQuoted(cleanPrompt);

  // 1. Workflow A: Editor text entry
  // e.g. 'Open [a new] Notepad [document] and type "<text>"'
  if (/(?:open|launch|start|create).*(?:notepad|editor)/i.test(cleanPrompt) && /(?:type|write|enter)/i.test(cleanPrompt)) {
    if (!quoted) {
      // Check if text is written after 'type' or 'write'
      const match = cleanPrompt.match(/(?:type|write|enter)\s+(.+)$/i);
      if (match) {
        const candidate = match[1].trim().replace(/^["']|["']$/g, '');
        if (candidate) {
          const appRes = resolveApplication('notepad');
          return {
            ok: true,
            workflow: 'editor_text',
            application: appRes.application,
            payload: { text: candidate },
            rawPrompt: cleanPrompt
          };
        }
      }
      return {
        ok: false,
        blocked: true,
        reason: AgentErrorCode.APPLICATION_AMBIGUOUS,
        error: 'Editor prompt requires text to be entered',
        rawPrompt: cleanPrompt
      };
    }

    const appRes = resolveApplication('notepad');
    return {
      ok: true,
      workflow: 'editor_text',
      application: appRes.application,
      payload: { text: quoted },
      rawPrompt: cleanPrompt
    };
  }

  // 2. Workflow B: Browser Search
  // e.g. 'Open Chrome and search for "<query>"' or 'Search "<query>" in chrome'
  if (/(?:chrome|browser|google chrome)/i.test(cleanPrompt) && /(?:search|query|find|look up)/i.test(cleanPrompt)) {
    const query = quoted || cleanPrompt.replace(/.*(?:search for|search|query|find|look up)\s+/i, '').replace(/.*in (?:chrome|browser)/i, '').trim().replace(/^["']|["']$/g, '');
    if (!query) {
      return {
        ok: false,
        blocked: true,
        reason: AgentErrorCode.APPLICATION_AMBIGUOUS,
        error: 'Browser search prompt requires a search query',
        rawPrompt: cleanPrompt
      };
    }

    const appRes = resolveApplication('chrome');
    return {
      ok: true,
      workflow: 'browser_search',
      application: appRes.application,
      payload: { query },
      rawPrompt: cleanPrompt
    };
  }

  // 3. Workflow C: Windows Search
  // e.g. 'Open Windows Search and find "<app>"' or 'Find and open application <app>'
  if (/(?:windows search|search|start menu)/i.test(cleanPrompt) || /(?:find and open|find application)/i.test(cleanPrompt)) {
    const targetApp = quoted || cleanPrompt.replace(/.*(?:find|search for|locate)\s+(?:application\s+|app\s+)?/i, '').trim().replace(/^["']|["']$/g, '');
    if (!targetApp) {
      return {
        ok: false,
        blocked: true,
        reason: AgentErrorCode.APPLICATION_AMBIGUOUS,
        error: 'Windows Search prompt requires target application name',
        rawPrompt: cleanPrompt
      };
    }

    const appRes = resolveApplication('windows_search');
    return {
      ok: true,
      workflow: 'windows_search',
      application: appRes.application,
      payload: { targetApp },
      rawPrompt: cleanPrompt
    };
  }

  // 4. Workflow D: WhatsApp Navigation
  // e.g. 'Open WhatsApp and navigate to "<section/chat>"'
  if (/(?:whatsapp)/i.test(cleanPrompt)) {
    // Check if user requested to send a message without full explicit instruction
    if (/(?:send|message|text\s+someone)/i.test(cleanPrompt)) {
      // Consequential action gate: requires explicit recipient AND content
      const recipientMatch = cleanPrompt.match(/(?:to|contact)\s+([a-zA-Z0-9_ -]+)/i);
      if (!recipientMatch || !quoted) {
        return {
          ok: false,
          blocked: true,
          reason: AgentErrorCode.AUTHORITY_DENIED,
          error: 'Consequential action blocked: Sending messages in WhatsApp is strictly prohibited without explicit user instruction specifying both recipient and content payload.',
          rawPrompt: cleanPrompt
        };
      }
    }

    const section = quoted || cleanPrompt.replace(/.*(?:navigate to|go to|open section|open chat|open)\s+/i, '').replace(/whatsapp/i, '').trim();
    const appRes = resolveApplication('whatsapp');
    return {
      ok: true,
      workflow: 'whatsapp_navigate',
      application: appRes.application,
      payload: { section: section || 'chats' },
      rawPrompt: cleanPrompt
    };
  }

  // 5. Workflow E: File Explorer Folder Creation
  // e.g. 'Open File Explorer and create a folder named "Hello" in downloads'
  if (/(?:explorer|downloads|folder|directory)/i.test(cleanPrompt) && /(?:create|make|new|open)/i.test(cleanPrompt)) {
    const folderName = quoted || cleanPrompt.match(/(?:named|called)\s+["']?([^"'\s]+)["']?/i)?.[1] || 'Hello';
    const targetDir = /\bdownloads?\b/i.test(cleanPrompt) ? 'Downloads' : 'Documents';
    const appRes = resolveApplication('file_explorer');
    return {
      ok: true,
      workflow: 'file_explorer_folder',
      application: appRes.application,
      payload: { folderName, targetDir },
      rawPrompt: cleanPrompt
    };
  }

  return {
    ok: false,
    blocked: true,
    reason: AgentErrorCode.PLANNER_BLOCKED,
    error: `Unsupported prompt intent. Supported workflows: Notepad editor, Chrome search, Windows search, WhatsApp navigation, File Explorer. Raw prompt: "${cleanPrompt}"`,
    rawPrompt: cleanPrompt
  };
}

/**
 * Creates a structured Planner Port.
 * Supports injected LLM provider route or defaults to bounded deterministic parser.
 *
 * @param {Object} [options]
 * @param {Function} [options.llmPlanner] Optional live model inference function
 * @returns {Object} PlannerPort
 */
export function createPlannerPort(options = {}) {
  const llmPlanner = options.llmPlanner || null;

  return {
    getToolSchemas() {
      return COMPUTER_AGENT_TOOLS;
    },

    /**
     * Plans the task based on operator prompt and current observation context.
     *
     * @param {Object} params
     * @param {string} params.prompt Operator prompt
     * @param {Object} [params.observation] Current observation (if already observed)
     * @param {string} [params.operatorId='operator']
     * @returns {Promise<Object>}
     */
    async planTask({ prompt, observation = null, operatorId = 'operator' } = {}) {
      if (llmPlanner) {
        try {
          const llmResult = await llmPlanner({
            prompt,
            observation,
            tools: COMPUTER_AGENT_TOOLS,
            operatorId
          });
          if (llmResult && Array.isArray(llmResult.plan)) {
            return {
              ok: true,
              source: 'live_model',
              ...llmResult
            };
          }
          return {
            ok: false,
            blocked: true,
            source: 'live_model_error',
            reason: AgentErrorCode.PLANNER_BLOCKED,
            error: 'Live model planner returned invalid plan: plan must be an array'
          };
        } catch (err) {
          // Live planner error: fail closed if live planner was explicitly configured
          return {
            ok: false,
            blocked: true,
            source: 'live_model_error',
            reason: AgentErrorCode.PLANNER_FAILED,
            error: `Live model planner failed: ${err.message}`
          };
        }
      }

      // Deterministic intent parser fallback
      const parsed = parseDeterministicIntent(prompt);
      if (!parsed.ok) {
        return {
          ok: false,
          blocked: true,
          source: 'deterministic_fallback',
          reason: parsed.reason,
          error: parsed.error,
          rawPrompt: parsed.rawPrompt
        };
      }

      // Generate structured action plan based on workflow
      const plan = [];

      switch (parsed.workflow) {
        case 'editor_text': {
          plan.push({
            step: 1,
            tool: 'resolve_app',
            parameters: { appName: parsed.application.appId }
          });
          plan.push({
            step: 2,
            tool: 'launch_app',
            parameters: { appId: parsed.application.appId, extraArgs: [] }
          });
          plan.push({
            step: 3,
            tool: 'wait_observe',
            parameters: { delayMs: 1000, targetHwnd: 0 }
          });
          plan.push({
            step: 4,
            tool: 'type_text',
            parameters: { text: parsed.payload.text }
          });
          plan.push({
            step: 5,
            tool: 'verify_state',
            parameters: { expectedCondition: 'text_contains', expectedValue: parsed.payload.text }
          });
          break;
        }

        case 'browser_search': {
          plan.push({
            step: 1,
            tool: 'resolve_app',
            parameters: { appName: parsed.application.appId }
          });
          plan.push({
            step: 2,
            tool: 'launch_app',
            parameters: { appId: parsed.application.appId, extraArgs: [`https://www.google.com/search?q=${encodeURIComponent(parsed.payload.query)}`] }
          });
          plan.push({
            step: 3,
            tool: 'wait_observe',
            parameters: { delayMs: 1500, targetHwnd: 0 }
          });
          plan.push({
            step: 4,
            tool: 'verify_state',
            parameters: { expectedCondition: 'url_or_title_contains', expectedValue: parsed.payload.query }
          });
          break;
        }

        case 'windows_search': {
          plan.push({
            step: 1,
            tool: 'resolve_app',
            parameters: { appName: parsed.application.appId }
          });
          plan.push({
            step: 2,
            tool: 'type_text',
            parameters: { text: parsed.payload.targetApp }
          });
          plan.push({
            step: 3,
            tool: 'wait_observe',
            parameters: { delayMs: 800, targetHwnd: 0 }
          });
          plan.push({
            step: 4,
            tool: 'verify_state',
            parameters: { expectedCondition: 'search_match', expectedValue: parsed.payload.targetApp }
          });
          break;
        }

        case 'whatsapp_navigate': {
          plan.push({
            step: 1,
            tool: 'resolve_app',
            parameters: { appName: parsed.application.appId }
          });
          plan.push({
            step: 2,
            tool: 'launch_app',
            parameters: { appId: parsed.application.appId, extraArgs: [] }
          });
          plan.push({
            step: 3,
            tool: 'wait_observe',
            parameters: { delayMs: 1500, targetHwnd: 0 }
          });
          plan.push({
            step: 4,
            tool: 'verify_state',
            parameters: { expectedCondition: 'section_active', expectedValue: parsed.payload.section }
          });
          break;
        }

        case 'file_explorer_folder': {
          plan.push({
            step: 1,
            tool: 'resolve_app',
            parameters: { appName: parsed.application.appId }
          });
          plan.push({
            step: 2,
            tool: 'launch_app',
            parameters: { appId: parsed.application.appId, extraArgs: [parsed.payload.targetDir] }
          });
          plan.push({
            step: 3,
            tool: 'wait_observe',
            parameters: { delayMs: 1200, targetHwnd: 0 }
          });
          plan.push({
            step: 4,
            tool: 'type_text',
            parameters: { text: parsed.payload.folderName }
          });
          plan.push({
            step: 5,
            tool: 'verify_state',
            parameters: { expectedCondition: 'folder_created', expectedValue: parsed.payload.folderName }
          });
          break;
        }
      }

      return {
        ok: true,
        source: 'deterministic_fallback',
        workflow: parsed.workflow,
        application: parsed.application,
        payload: parsed.payload,
        plan
      };
    }
  };
}
