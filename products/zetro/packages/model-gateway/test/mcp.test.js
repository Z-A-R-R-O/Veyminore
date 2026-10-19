import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMcpServer,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME
} from '../src/index.js';

describe('Milestone U5: MCP Server & Tool Interoperability', () => {
  function createMockActionDispatcher(overrides = {}) {
    const dispatched = [];
    return {
      dispatched,
      dispatch: async (action) => {
        dispatched.push(action);
        if (overrides.interrupted) {
          return { success: false, interrupted: true, durationMs: 5 };
        }
        if (overrides.error) {
          throw new Error(overrides.error);
        }
        return { success: true, durationMs: 12 };
      }
    };
  }

  it('handles initialize and ping JSON-RPC requests', async () => {
    const dispatcher = createMockActionDispatcher();
    const server = createMcpServer({ actionDispatcher: dispatcher });

    const initRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    });

    assert.strictEqual(initRes.id, 1);
    assert.strictEqual(initRes.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.strictEqual(initRes.result.serverInfo.name, MCP_SERVER_NAME);
    assert.ok(initRes.result.capabilities.tools);

    const pingRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping'
    });
    assert.strictEqual(pingRes.id, 2);
    assert.deepStrictEqual(pingRes.result, {});

    const notifRes = await server.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    assert.strictEqual(notifRes, null);
  });

  it('lists exposed MCP computer tools with input schemas', async () => {
    const dispatcher = createMockActionDispatcher();
    const server = createMcpServer({ actionDispatcher: dispatcher });

    const listRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list'
    });

    assert.strictEqual(listRes.id, 3);
    const tools = listRes.result.tools;
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length >= 8);

    const clickTool = tools.find(t => t.name === 'zetro_click');
    assert.ok(clickTool);
    assert.strictEqual(clickTool.inputSchema.type, 'object');
    assert.deepStrictEqual(clickTool.inputSchema.required, ['x', 'y']);

    const typeTool = tools.find(t => t.name === 'zetro_type_text');
    assert.ok(typeTool);
  });

  it('executes zetro_click tool call through guarded dispatcher', async () => {
    const dispatcher = createMockActionDispatcher();
    const server = createMcpServer({ actionDispatcher: dispatcher });

    const callRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'zetro_click',
        arguments: { x: 450, y: 350, button: 'left' }
      }
    });

    assert.strictEqual(callRes.id, 4);
    assert.ok(!callRes.result.isError);
    assert.ok(callRes.result.content[0].text.includes("Action 'click' executed successfully"));
    assert.strictEqual(dispatcher.dispatched.length, 1);
    assert.strictEqual(dispatcher.dispatched[0].type, 'click');
    assert.strictEqual(dispatcher.dispatched[0].target.x, 450);
    assert.strictEqual(dispatcher.dispatched[0].target.y, 350);
  });

  it('executes zetro_observe and returns base64 image content', async () => {
    const dispatcher = createMockActionDispatcher();
    const fakeScreenshot = Buffer.from('png-binary-screen-bytes');
    const server = createMcpServer({
      actionDispatcher: dispatcher,
      screenCapturer: async () => fakeScreenshot
    });

    const callRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'zetro_observe'
      }
    });

    assert.strictEqual(callRes.id, 5);
    assert.strictEqual(callRes.result.content.length, 2);
    assert.strictEqual(callRes.result.content[1].type, 'image');
    assert.strictEqual(callRes.result.content[1].mimeType, 'image/png');
    assert.strictEqual(callRes.result.content[1].data, fakeScreenshot.toString('base64'));
  });

  it('handles human takeover interruption gracefully via MCP protocol', async () => {
    const dispatcher = createMockActionDispatcher({ interrupted: true });
    const server = createMcpServer({ actionDispatcher: dispatcher });

    const callRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'zetro_click',
        arguments: { x: 100, y: 100 }
      }
    });

    assert.strictEqual(callRes.id, 6);
    assert.strictEqual(callRes.result.isError, true);
    assert.ok(callRes.result.content[0].text.includes('human takeover'));
  });

  it('rejects unknown methods with standard JSON-RPC -32601 code', async () => {
    const dispatcher = createMockActionDispatcher();
    const server = createMcpServer({ actionDispatcher: dispatcher });

    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'unknown/method'
    });

    assert.strictEqual(res.id, 7);
    assert.strictEqual(res.error.code, -32601);
  });
});
