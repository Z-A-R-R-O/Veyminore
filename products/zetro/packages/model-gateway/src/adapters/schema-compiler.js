/**
 * @file schema-compiler.js
 * Universal schema compiler and response translator for ZETRO Universal Agent 2.0.
 *
 * Compiles canonical action definitions into vendor-specific tool schemas
 * (Anthropic, OpenAI, Gemini) and translates raw vendor tool responses
 * into validated canonical ComputerAction contracts.
 */

import {
  ComputerActionType,
  MouseButton,
  ClickType,
  RiskLevel,
  validateComputerAction
} from '../contracts/action-contract.js';

/**
 * Compiles Anthropic tool declarations.
 * Supports native computer use (Claude 3.5 Sonnet / 3.7 Sonnet) and discrete tools.
 *
 * @param {Object} options
 * @param {number} [options.displayWidth=1920]
 * @param {number} [options.displayHeight=1080]
 * @param {boolean} [options.nativeComputerUse=true]
 * @param {string} [options.computerVersion='computer_20241022']
 * @returns {Array<Object>}
 */
export function compileAnthropicTools({
  displayWidth = 1920,
  displayHeight = 1080,
  nativeComputerUse = true,
  computerVersion = 'computer_20241022'
} = {}) {
  const tools = [];

  if (nativeComputerUse) {
    tools.push({
      type: computerVersion,
      name: 'computer',
      display_width_px: displayWidth,
      display_height_px: displayHeight,
      display_number: 0
    });
  } else {
    // Discrete tools for Anthropic models without native computer use support
    tools.push(
      {
        name: 'zetro_click',
        description: 'Click on the screen at specified coordinates',
        input_schema: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Horizontal pixel coordinate' },
            y: { type: 'number', description: 'Vertical pixel coordinate' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
            clickType: { type: 'string', enum: ['single', 'double', 'triple'], default: 'single' }
          },
          required: ['x', 'y']
        }
      },
      {
        name: 'zetro_mouse_move',
        description: 'Move mouse cursor to coordinates',
        input_schema: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            durationMs: { type: 'number', default: 0 }
          },
          required: ['x', 'y']
        }
      },
      {
        name: 'zetro_drag',
        description: 'Drag mouse from start coordinate to end coordinate',
        input_schema: {
          type: 'object',
          properties: {
            startX: { type: 'number' },
            startY: { type: 'number' },
            endX: { type: 'number' },
            endY: { type: 'number' },
            durationMs: { type: 'number', default: 500 }
          },
          required: ['startX', 'startY', 'endX', 'endY']
        }
      },
      {
        name: 'zetro_type_text',
        description: 'Type text into currently focused control',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            delayMs: { type: 'number', default: 0 }
          },
          required: ['text']
        }
      },
      {
        name: 'zetro_press_keys',
        description: 'Press keyboard shortcuts or key combinations (e.g. ["ctrl", "c"], ["Return"])',
        input_schema: {
          type: 'object',
          properties: {
            keys: { type: 'array', items: { type: 'string' } }
          },
          required: ['keys']
        }
      },
      {
        name: 'zetro_scroll',
        description: 'Scroll screen horizontally or vertically',
        input_schema: {
          type: 'object',
          properties: {
            deltaX: { type: 'number', default: 0 },
            deltaY: { type: 'number', default: 0 },
            x: { type: 'number' },
            y: { type: 'number' }
          }
        }
      },
      {
        name: 'zetro_wait',
        description: 'Pause execution for specified milliseconds',
        input_schema: {
          type: 'object',
          properties: {
            durationMs: { type: 'number', default: 500 },
            expectedCondition: { type: 'string' }
          }
        }
      },
      {
        name: 'zetro_observe',
        description: 'Take a screenshot of screen or region to observe UI state',
        input_schema: {
          type: 'object',
          properties: {
            cropRegion: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' }
              },
              required: ['x', 'y', 'width', 'height']
            }
          }
        }
      }
    );
  }

  // Universal supervisor approval and finish tools (always present)
  tools.push(
    {
      name: 'zetro_request_approval',
      description: 'Request supervisor approval before performing consequential or irreversible actions (file deletion, credential entry, sending emails/messages)',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why approval is necessary' },
          proposedEffect: { type: 'string', description: 'Exact changes or effects that will occur' },
          riskLevel: { type: 'string', enum: ['consequential', 'critical'], default: 'consequential' }
        },
        required: ['reason', 'proposedEffect']
      }
    },
    {
      name: 'zetro_finish',
      description: 'Signal that the user task has been completed or cannot proceed',
      input_schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: 'Whether the goal was achieved' },
          summary: { type: 'string', description: 'Summary of what was done and outcome' }
        },
        required: ['success', 'summary']
      }
    }
  );

  return tools;
}

/**
 * Compiles OpenAI function calling declarations.
 *
 * @param {Object} options
 * @param {'discrete'|'unified'} [options.mode='discrete']
 * @returns {Array<Object>}
 */
export function compileOpenAITools({ mode = 'discrete' } = {}) {
  if (mode === 'unified') {
    return [
      {
        type: 'function',
        function: {
          name: 'zetro_computer_action',
          description: 'Execute an action on the computer (click, type, mouseMove, drag, scroll, pressKeys, wait, observe, requestApproval, finish).',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'mouseMove', 'drag', 'typeText', 'pressKeys', 'scroll', 'wait', 'observe', 'requestApproval', 'finish'],
                description: 'The canonical action type'
              },
              x: { type: 'number', description: 'Target X coordinate' },
              y: { type: 'number', description: 'Target Y coordinate' },
              button: { type: 'string', enum: ['left', 'right', 'middle'] },
              clickType: { type: 'string', enum: ['single', 'double', 'triple'] },
              startX: { type: 'number' },
              startY: { type: 'number' },
              endX: { type: 'number' },
              endY: { type: 'number' },
              text: { type: 'string', description: 'Text to type' },
              keys: { type: 'array', items: { type: 'string' }, description: 'Keyboard keys to press' },
              deltaX: { type: 'number' },
              deltaY: { type: 'number' },
              durationMs: { type: 'number' },
              reason: { type: 'string' },
              proposedEffect: { type: 'string' },
              success: { type: 'boolean' },
              summary: { type: 'string' }
            },
            required: ['type']
          }
        }
      }
    ];
  }

  return [
    {
      type: 'function',
      function: {
        name: 'zetro_click',
        description: 'Click mouse at coordinate (x, y)',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate in pixels' },
            y: { type: 'number', description: 'Y coordinate in pixels' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
            clickType: { type: 'string', enum: ['single', 'double', 'triple'], default: 'single' }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_mouse_move',
        description: 'Move mouse cursor smoothly to coordinates',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            durationMs: { type: 'number', default: 0 }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_drag',
        description: 'Drag mouse from start to end coordinate',
        parameters: {
          type: 'object',
          properties: {
            startX: { type: 'number' },
            startY: { type: 'number' },
            endX: { type: 'number' },
            endY: { type: 'number' },
            durationMs: { type: 'number', default: 500 }
          },
          required: ['startX', 'startY', 'endX', 'endY']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_type_text',
        description: 'Type text string into active window / control',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text to type' },
            delayMs: { type: 'number', default: 0 }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_press_keys',
        description: 'Press keyboard keys or shortcut combo',
        parameters: {
          type: 'object',
          properties: {
            keys: { type: 'array', items: { type: 'string' }, description: 'Array of key names, e.g. ["ctrl", "c"] or ["Enter"]' }
          },
          required: ['keys']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_scroll',
        description: 'Scroll mouse wheel',
        parameters: {
          type: 'object',
          properties: {
            deltaX: { type: 'number', default: 0 },
            deltaY: { type: 'number', default: 0 },
            x: { type: 'number' },
            y: { type: 'number' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_wait',
        description: 'Wait for UI to settle or update',
        parameters: {
          type: 'object',
          properties: {
            durationMs: { type: 'number', default: 500 },
            expectedCondition: { type: 'string' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_observe',
        description: 'Capture screenshot of display or region',
        parameters: {
          type: 'object',
          properties: {
            cropRegion: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' }
              },
              required: ['x', 'y', 'width', 'height']
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_request_approval',
        description: 'Request supervisor approval before consequential actions',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            proposedEffect: { type: 'string' },
            riskLevel: { type: 'string', enum: ['consequential', 'critical'], default: 'consequential' }
          },
          required: ['reason', 'proposedEffect']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zetro_finish',
        description: 'Signal task completion or failure',
        parameters: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            summary: { type: 'string' }
          },
          required: ['success', 'summary']
        }
      }
    }
  ];
}

/**
 * Compiles Gemini function declarations (Google AI / Vertex AI format).
 *
 * @param {Object} options
 * @param {'discrete'|'unified'} [options.mode='discrete']
 * @returns {Array<Object>}
 */
export function compileGeminiTools({ mode = 'discrete' } = {}) {
  // Convert JSON Schema types to Gemini schema types (uppercase)
  const openAiTools = compileOpenAITools({ mode });
  return openAiTools.map(t => {
    const fn = t.function;
    const convertProperties = (props) => {
      const out = {};
      for (const [key, val] of Object.entries(props || {})) {
        out[key] = {
          type: (val.type || 'STRING').toUpperCase(),
          description: val.description || ''
        };
        if (val.enum) out[key].enum = val.enum;
        if (val.items) {
          out[key].items = {
            type: (val.items.type || 'STRING').toUpperCase()
          };
        }
        if (val.properties) {
          out[key].properties = convertProperties(val.properties);
        }
        if (val.required) {
          out[key].required = val.required;
        }
      }
      return out;
    };

    return {
      name: fn.name,
      description: fn.description,
      parameters: {
        type: 'OBJECT',
        properties: convertProperties(fn.parameters.properties),
        required: fn.parameters.required || []
      }
    };
  });
}

/**
 * Parses an Anthropic tool use block into a canonical ComputerAction (or finish action).
 *
 * @param {Object} toolUseBlock
 * @returns {Object} Validated ComputerAction or finish action
 */
export function parseAnthropicComputerAction(toolUseBlock) {
  if (!toolUseBlock || typeof toolUseBlock !== 'object') {
    throw new Error('Anthropic tool use block must be an object');
  }

  const { name, input = {} } = toolUseBlock;

  // 1. Native Anthropic computer tool
  if (name === 'computer') {
    const action = input.action;
    switch (action) {
      case 'mouse_move': {
        const coord = extractCoordinates(input.coordinate);
        return validateComputerAction({
          type: ComputerActionType.MOUSE_MOVE,
          target: { kind: 'point', x: coord.x, y: coord.y },
          durationMs: input.durationMs || 0
        });
      }

      case 'left_click':
      case 'click': {
        const coord = input.coordinate ? extractCoordinates(input.coordinate) : undefined;
        return validateComputerAction({
          type: ComputerActionType.CLICK,
          target: coord ? { kind: 'point', x: coord.x, y: coord.y } : { kind: 'point', x: 0, y: 0 },
          button: MouseButton.LEFT,
          clickType: ClickType.SINGLE
        });
      }

      case 'right_click': {
        const coord = input.coordinate ? extractCoordinates(input.coordinate) : undefined;
        return validateComputerAction({
          type: ComputerActionType.CLICK,
          target: coord ? { kind: 'point', x: coord.x, y: coord.y } : { kind: 'point', x: 0, y: 0 },
          button: MouseButton.RIGHT,
          clickType: ClickType.SINGLE
        });
      }

      case 'middle_click': {
        const coord = input.coordinate ? extractCoordinates(input.coordinate) : undefined;
        return validateComputerAction({
          type: ComputerActionType.CLICK,
          target: coord ? { kind: 'point', x: coord.x, y: coord.y } : { kind: 'point', x: 0, y: 0 },
          button: MouseButton.MIDDLE,
          clickType: ClickType.SINGLE
        });
      }

      case 'double_click': {
        const coord = input.coordinate ? extractCoordinates(input.coordinate) : undefined;
        return validateComputerAction({
          type: ComputerActionType.CLICK,
          target: coord ? { kind: 'point', x: coord.x, y: coord.y } : { kind: 'point', x: 0, y: 0 },
          button: MouseButton.LEFT,
          clickType: ClickType.DOUBLE
        });
      }

      case 'triple_click': {
        const coord = input.coordinate ? extractCoordinates(input.coordinate) : undefined;
        return validateComputerAction({
          type: ComputerActionType.CLICK,
          target: coord ? { kind: 'point', x: coord.x, y: coord.y } : { kind: 'point', x: 0, y: 0 },
          button: MouseButton.LEFT,
          clickType: ClickType.TRIPLE
        });
      }

      case 'left_click_drag': {
        const end = extractCoordinates(input.coordinate);
        const start = input.start_coordinate
          ? extractCoordinates(input.start_coordinate)
          : { x: end.x, y: end.y };
        return validateComputerAction({
          type: ComputerActionType.DRAG,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          durationMs: input.durationMs || 500
        });
      }

      case 'type': {
        return validateComputerAction({
          type: ComputerActionType.TYPE_TEXT,
          text: String(input.text || '')
        });
      }

      case 'key': {
        const keyText = String(input.text || input.key || '');
        const keys = parseKeySequence(keyText);
        return validateComputerAction({
          type: ComputerActionType.PRESS_KEYS,
          keys
        });
      }

      case 'screenshot':
      case 'cursor_position': {
        return validateComputerAction({
          type: ComputerActionType.OBSERVE
        });
      }

      case 'wait': {
        return validateComputerAction({
          type: ComputerActionType.WAIT,
          durationMs: input.duration_ms || input.durationMs || 500
        });
      }

      default:
        throw new Error(`Unsupported Anthropic computer action '${action}'`);
    }
  }

  // 2. Discrete tools
  return parseStandardToolCall(name, input);
}

/**
 * Parses an OpenAI tool call into a canonical ComputerAction (or finish action).
 *
 * @param {Object} toolCall
 * @returns {Object} Validated ComputerAction or finish action
 */
export function parseOpenAIComputerAction(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    throw new Error('OpenAI tool call must be an object');
  }

  const fn = toolCall.function || toolCall;
  const name = fn.name;
  let args = fn.arguments || {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch (err) {
      throw new Error(`Failed to parse OpenAI function arguments JSON: ${err.message}`);
    }
  }

  if (name === 'zetro_computer_action') {
    const type = args.type;
    return parseStandardToolCall(type, args);
  }

  return parseStandardToolCall(name, args);
}

/**
 * Parses a Gemini function call candidate part into a canonical ComputerAction (or finish action).
 *
 * @param {Object} functionCall
 * @returns {Object} Validated ComputerAction or finish action
 */
export function parseGeminiComputerAction(functionCall) {
  if (!functionCall || typeof functionCall !== 'object') {
    throw new Error('Gemini function call must be an object');
  }

  const name = functionCall.name;
  const args = functionCall.args || {};

  if (name === 'zetro_computer_action') {
    const type = args.type;
    return parseStandardToolCall(type, args);
  }

  return parseStandardToolCall(name, args);
}

/**
 * Parses structured JSON action output from Level 3 models that produce raw JSON
 * rather than structured tool calls.
 *
 * @param {string|Object} rawContent
 * @returns {Object} Validated ComputerAction or finish action
 */
export function parseStructuredJsonAction(rawContent) {
  let parsed = rawContent;
  if (typeof rawContent === 'string') {
    let clean = rawContent.trim();
    // Strip markdown code fence if present
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      // Attempt to locate first JSON block { ... }
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          throw new Error(`Failed to parse structured JSON action: ${err.message}`);
        }
      } else {
        throw new Error(`Failed to parse structured JSON action: ${err.message}`);
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Structured JSON output must evaluate to an object');
  }

  const actionName = parsed.action || parsed.type || parsed.name;
  return parseStandardToolCall(actionName, parsed);
}

/**
 * Internal normalizer translating standard tool calls to canonical ComputerAction.
 */
function parseStandardToolCall(name, args) {
  const normName = String(name || '').toLowerCase().replace(/^zetro_/, '').replace(/_/g, '');

  switch (normName) {
    case 'click': {
      const x = typeof args.x === 'number' ? args.x : args.target?.x;
      const y = typeof args.y === 'number' ? args.y : args.target?.y;
      const target = typeof x === 'number' && typeof y === 'number'
        ? { kind: 'point', x, y }
        : (args.target || { kind: 'point', x: 0, y: 0 });

      return validateComputerAction({
        type: ComputerActionType.CLICK,
        target,
        button: args.button || MouseButton.LEFT,
        clickType: args.clickType || ClickType.SINGLE,
        riskLevel: args.riskLevel
      });
    }

    case 'mousemove': {
      const x = typeof args.x === 'number' ? args.x : args.target?.x;
      const y = typeof args.y === 'number' ? args.y : args.target?.y;
      return validateComputerAction({
        type: ComputerActionType.MOUSE_MOVE,
        target: { kind: 'point', x, y },
        durationMs: args.durationMs || 0
      });
    }

    case 'drag': {
      const startX = typeof args.startX === 'number' ? args.startX : args.start?.x;
      const startY = typeof args.startY === 'number' ? args.startY : args.start?.y;
      const endX = typeof args.endX === 'number' ? args.endX : args.end?.x;
      const endY = typeof args.endY === 'number' ? args.endY : args.end?.y;

      return validateComputerAction({
        type: ComputerActionType.DRAG,
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        durationMs: args.durationMs || 500
      });
    }

    case 'typetext':
    case 'type': {
      return validateComputerAction({
        type: ComputerActionType.TYPE_TEXT,
        text: String(args.text || ''),
        delayMs: args.delayMs || 0
      });
    }

    case 'presskeys':
    case 'key':
    case 'shortcut': {
      let keys = args.keys;
      if (typeof keys === 'string') {
        keys = parseKeySequence(keys);
      } else if (!Array.isArray(keys) && typeof args.key === 'string') {
        keys = parseKeySequence(args.key);
      } else if (!Array.isArray(keys)) {
        keys = [];
      }
      return validateComputerAction({
        type: ComputerActionType.PRESS_KEYS,
        keys
      });
    }

    case 'scroll': {
      const anchor = (typeof args.x === 'number' && typeof args.y === 'number')
        ? { kind: 'point', x: args.x, y: args.y }
        : args.anchor;

      return validateComputerAction({
        type: ComputerActionType.SCROLL,
        deltaX: args.deltaX || 0,
        deltaY: args.deltaY || 0,
        anchor
      });
    }

    case 'wait': {
      return validateComputerAction({
        type: ComputerActionType.WAIT,
        durationMs: args.durationMs || 500,
        expectedCondition: args.expectedCondition
      });
    }

    case 'observe':
    case 'screenshot': {
      return validateComputerAction({
        type: ComputerActionType.OBSERVE,
        cropRegion: args.cropRegion,
        displayId: args.displayId
      });
    }

    case 'requestapproval': {
      return validateComputerAction({
        type: ComputerActionType.REQUEST_APPROVAL,
        reason: args.reason,
        proposedEffect: args.proposedEffect,
        riskLevel: args.riskLevel || RiskLevel.CONSEQUENTIAL
      });
    }

    case 'finish': {
      return validateComputerAction({
        id: args.id || 'finish-' + Date.now(),
        type: ComputerActionType.FINISH,
        success: args.success !== false,
        summary: String(args.summary || '')
      });
    }

    default:
      throw new Error(`Unknown or unsupported tool action '${name}'`);
  }
}

/**
 * Extracts { x, y } from Anthropic [x, y] coordinate array or object.
 */
function extractCoordinates(coord) {
  if (Array.isArray(coord) && coord.length >= 2) {
    return { x: Number(coord[0]), y: Number(coord[1]) };
  }
  if (coord && typeof coord === 'object' && typeof coord.x === 'number' && typeof coord.y === 'number') {
    return { x: coord.x, y: coord.y };
  }
  throw new Error(`Invalid coordinate parameter: ${JSON.stringify(coord)}`);
}

/**
 * Parses key strings like "ctrl+c" or "Ctrl+Shift+Escape" or "Return" into an array of key tokens.
 */
function parseKeySequence(keyStr) {
  if (!keyStr || typeof keyStr !== 'string') return [];
  if (keyStr.includes('+')) {
    return keyStr.split('+').map(k => k.trim()).filter(Boolean);
  }
  return [keyStr.trim()];
}
