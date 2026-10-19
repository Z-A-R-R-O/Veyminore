/**
 * @file mcp-server.js
 * Model Context Protocol (MCP) server for ZETRO Universal Computer Interface.
 *
 * Implements the standard JSON-RPC 2.0 MCP protocol over stdio or programmatic transport,
 * allowing external AI systems (Claude Desktop, Cursor, OpenAI Agents, custom scripts)
 * to interact with Windows through ZETRO's guarded computer actions.
 */

import { compileOpenAITools } from '../adapters/schema-compiler.js';
import { parseOpenAIComputerAction } from '../adapters/schema-compiler.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'zetro-universal-computer';
export const MCP_SERVER_VERSION = '2.0.0';

/**
 * Creates an in-process MCP Server instance bound to an ActionDispatcher.
 *
 * @param {Object} options
 * @param {import('@zetro/computer-windows-provider').ActionDispatcher} options.actionDispatcher
 * @param {Function} [options.screenCapturer]
 * @param {string} [options.serverName=MCP_SERVER_NAME]
 * @param {string} [options.serverVersion=MCP_SERVER_VERSION]
 * @returns {McpServer}
 */
export function createMcpServer({
  actionDispatcher,
  screenCapturer = null,
  serverName = MCP_SERVER_NAME,
  serverVersion = MCP_SERVER_VERSION
}) {
  if (!actionDispatcher || typeof actionDispatcher.dispatch !== 'function') {
    throw new Error('createMcpServer requires a valid actionDispatcher instance');
  }

  /**
   * Generates MCP tools catalog by converting canonical schemas to MCP tool format.
   */
  function listTools() {
    const openAiTools = compileOpenAITools({ mode: 'discrete' });
    return openAiTools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters
    }));
  }

  /**
   * Dispatches an MCP tool call request to the guarded action dispatcher.
   */
  async function callTool(name, args = {}) {
    // 1. Special handling for observe tool returning image
    if (name === 'zetro_observe' || name === 'observe') {
      let imageBuffer = null;
      if (typeof screenCapturer === 'function') {
        imageBuffer = await screenCapturer();
      } else {
        const obsResult = await actionDispatcher.dispatch({
          type: 'observe',
          cropRegion: args.cropRegion
        });
        imageBuffer = obsResult.details?.imageBuffer || obsResult.imageBuffer || null;
      }

      if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
        return {
          content: [
            {
              type: 'text',
              text: `Screen captured successfully (${imageBuffer.length} bytes).`
            },
            {
              type: 'image',
              data: imageBuffer.toString('base64'),
              mimeType: 'image/png'
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Screen observed successfully.'
          }
        ]
      };
    }

    // 2. Parse arguments to canonical ComputerAction
    let canonicalAction;
    try {
      canonicalAction = parseOpenAIComputerAction({
        name,
        arguments: args
      });
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid tool arguments for '${name}': ${err.message}`
          }
        ]
      };
    }

    // 3. Dispatch to guarded executor
    try {
      const result = await actionDispatcher.dispatch(canonicalAction);
      if (result.interrupted) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Action interrupted: zero-latency human takeover triggered.'
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Action '${canonicalAction.type}' executed successfully in ${result.durationMs || 0}ms.`
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Execution failed for action '${canonicalAction.type}': ${err.message}`
          }
        ]
      };
    }
  }

  /**
   * Processes an incoming JSON-RPC 2.0 message.
   *
   * @param {Object} message - JSON-RPC request object
   * @returns {Promise<Object>} JSON-RPC response object
   */
  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: payload must be a JSON object' }
      };
    }

    const { id = null, method, params = {} } = message;

    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false }
            },
            serverInfo: {
              name: serverName,
              version: serverVersion
            }
          }
        };
      }

      case 'notifications/initialized': {
        // Notification, no response required per JSON-RPC
        return null;
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {}
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: listTools()
          }
        };
      }

      case 'tools/call': {
        const toolName = params.name;
        const toolArgs = params.arguments || {};
        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: "Missing required parameter 'name'" }
          };
        }

        const callResult = await callTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: callResult
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: '${method}'` }
        };
    }
  }

  return {
    handleMessage,
    listTools,
    callTool
  };
}
