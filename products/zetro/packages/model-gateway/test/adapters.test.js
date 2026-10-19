import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  compileAnthropicTools,
  compileOpenAITools,
  compileGeminiTools,
  parseAnthropicComputerAction,
  parseOpenAIComputerAction,
  parseGeminiComputerAction,
  parseStructuredJsonAction,
  createOpenAICompatibleAdapter,
  createAnthropicAdapter,
  createGeminiAdapter,
  ComputerActionType,
  MouseButton,
  ClickType,
  ProviderTimeoutError,
  AdapterTranslationError
} from '../src/index.js';

describe('Milestone U3: Schema Compiler & Adapters', () => {
  describe('Anthropic Schema Compilation & Parsing', () => {
    it('compiles Anthropic native computer tools', () => {
      const tools = compileAnthropicTools({ displayWidth: 2560, displayHeight: 1440, nativeComputerUse: true });
      assert.ok(Array.isArray(tools));
      const computerTool = tools.find(t => t.name === 'computer');
      assert.ok(computerTool);
      assert.strictEqual(computerTool.display_width_px, 2560);
      assert.strictEqual(computerTool.display_height_px, 1440);
      assert.ok(tools.find(t => t.name === 'zetro_request_approval'));
      assert.ok(tools.find(t => t.name === 'zetro_finish'));
    });

    it('compiles Anthropic discrete tools when nativeComputerUse is false', () => {
      const tools = compileAnthropicTools({ nativeComputerUse: false });
      assert.strictEqual(tools.find(t => t.name === 'computer'), undefined);
      assert.ok(tools.find(t => t.name === 'zetro_click'));
      assert.ok(tools.find(t => t.name === 'zetro_type_text'));
      assert.ok(tools.find(t => t.name === 'zetro_press_keys'));
    });

    it('parses Anthropic native mouse_move, click, and drag', () => {
      const move = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'mouse_move', coordinate: [400, 300] }
      });
      assert.strictEqual(move.type, ComputerActionType.MOUSE_MOVE);
      assert.strictEqual(move.target.x, 400);
      assert.strictEqual(move.target.y, 300);

      const click = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'left_click', coordinate: [500, 600] }
      });
      assert.strictEqual(click.type, ComputerActionType.CLICK);
      assert.strictEqual(click.button, MouseButton.LEFT);
      assert.strictEqual(click.target.x, 500);
      assert.strictEqual(click.target.y, 600);

      const drag = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'left_click_drag', start_coordinate: [100, 100], coordinate: [300, 300] }
      });
      assert.strictEqual(drag.type, ComputerActionType.DRAG);
      assert.strictEqual(drag.start.x, 100);
      assert.strictEqual(drag.end.x, 300);
    });

    it('parses Anthropic type, key sequence, and observe', () => {
      const typeAction = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'type', text: 'Hello ZETRO' }
      });
      assert.strictEqual(typeAction.type, ComputerActionType.TYPE_TEXT);
      assert.strictEqual(typeAction.text, 'Hello ZETRO');

      const keyAction = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'key', text: 'ctrl+shift+esc' }
      });
      assert.strictEqual(keyAction.type, ComputerActionType.PRESS_KEYS);
      assert.deepStrictEqual(keyAction.keys, ['ctrl', 'shift', 'esc']);

      const shot = parseAnthropicComputerAction({
        name: 'computer',
        input: { action: 'screenshot' }
      });
      assert.strictEqual(shot.type, ComputerActionType.OBSERVE);
    });

    it('parses zetro_finish and zetro_request_approval', () => {
      const approval = parseAnthropicComputerAction({
        name: 'zetro_request_approval',
        input: { reason: 'Delete folder', proposedEffect: 'Remove directory C:\\temp', riskLevel: 'consequential' }
      });
      assert.strictEqual(approval.type, ComputerActionType.REQUEST_APPROVAL);
      assert.strictEqual(approval.reason, 'Delete folder');

      const finish = parseAnthropicComputerAction({
        name: 'zetro_finish',
        input: { success: true, summary: 'Created Hello folder' }
      });
      assert.strictEqual(finish.type, 'finish');
      assert.strictEqual(finish.success, true);
      assert.strictEqual(finish.summary, 'Created Hello folder');
    });
  });

  describe('OpenAI Schema Compilation & Parsing', () => {
    it('compiles OpenAI discrete and unified tools', () => {
      const discrete = compileOpenAITools({ mode: 'discrete' });
      assert.ok(discrete.length >= 8);
      assert.ok(discrete.find(t => t.function.name === 'zetro_click'));

      const unified = compileOpenAITools({ mode: 'unified' });
      assert.strictEqual(unified.length, 1);
      assert.strictEqual(unified[0].function.name, 'zetro_computer_action');
    });

    it('parses OpenAI tool calls with JSON string arguments', () => {
      const action = parseOpenAIComputerAction({
        function: {
          name: 'zetro_click',
          arguments: JSON.stringify({ x: 250, y: 700, button: 'right' })
        }
      });
      assert.strictEqual(action.type, ComputerActionType.CLICK);
      assert.strictEqual(action.button, MouseButton.RIGHT);
      assert.strictEqual(action.target.x, 250);
      assert.strictEqual(action.target.y, 700);
    });

    it('parses OpenAI unified computer action tool call', () => {
      const action = parseOpenAIComputerAction({
        function: {
          name: 'zetro_computer_action',
          arguments: {
            type: 'pressKeys',
            keys: ['alt', 'F4']
          }
        }
      });
      assert.strictEqual(action.type, ComputerActionType.PRESS_KEYS);
      assert.deepStrictEqual(action.keys, ['alt', 'F4']);
    });
  });

  describe('Gemini Schema Compilation & Parsing', () => {
    it('compiles Gemini function declarations with uppercase types', () => {
      const declarations = compileGeminiTools();
      assert.ok(Array.isArray(declarations));
      const clickDecl = declarations.find(d => d.name === 'zetro_click');
      assert.ok(clickDecl);
      assert.strictEqual(clickDecl.parameters.type, 'OBJECT');
      assert.strictEqual(clickDecl.parameters.properties.x.type, 'NUMBER');
    });

    it('parses Gemini function calls', () => {
      const action = parseGeminiComputerAction({
        name: 'zetro_scroll',
        args: { deltaY: -500, x: 300, y: 400 }
      });
      assert.strictEqual(action.type, ComputerActionType.SCROLL);
      assert.strictEqual(action.deltaY, -500);
      assert.strictEqual(action.anchor.x, 300);
    });
  });

  describe('Structured JSON Output Parsing', () => {
    it('parses markdown code fenced JSON', () => {
      const markdown = '```json\n{\n  "type": "typeText",\n  "text": "Hello World",\n  "delayMs": 10\n}\n```';
      const action = parseStructuredJsonAction(markdown);
      assert.strictEqual(action.type, ComputerActionType.TYPE_TEXT);
      assert.strictEqual(action.text, 'Hello World');
      assert.strictEqual(action.delayMs, 10);
    });

    it('parses JSON embedded in conversational prose', () => {
      const text = 'I will now click on the submit button:\n{"type": "click", "x": 600, "y": 450, "button": "left"}\nLet me know if you need more help.';
      const action = parseStructuredJsonAction(text);
      assert.strictEqual(action.type, ComputerActionType.CLICK);
      assert.strictEqual(action.target.x, 600);
    });
  });

  describe('Provider Adapter Integration Tests', () => {
    it('OpenAI-compatible adapter invokes mock endpoint and returns canonical action', async () => {
      const mockFetch = async (url, options) => {
        assert.ok(url.includes('/chat/completions'));
        const body = JSON.parse(options.body);
        assert.strictEqual(body.model, 'llama3.2-vision');
        assert.ok(body.tools.length > 0);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'zetro_click',
                        arguments: JSON.stringify({ x: 300, y: 400, button: 'left' })
                      }
                    }
                  ]
                }
              }
            ]
          })
        };
      };

      const adapter = createOpenAICompatibleAdapter({
        endpoint: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
        fetchFn: mockFetch
      });

      const { action } = await adapter.proposeAction({
        prompt: 'Click the button',
        screenshotBuffer: Buffer.from('fake-screenshot-bytes')
      });

      assert.strictEqual(action.type, ComputerActionType.CLICK);
      assert.strictEqual(action.target.x, 300);
      assert.strictEqual(action.target.y, 400);
    });

    it('OpenAI-compatible adapter handles timeout gracefully', async () => {
      const mockHangingFetch = () => new Promise((_, reject) => {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        setTimeout(() => reject(err), 50);
      });

      const adapter = createOpenAICompatibleAdapter({
        endpoint: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
        timeoutMs: 30,
        fetchFn: mockHangingFetch
      });

      await assert.rejects(
        () => adapter.proposeAction({ prompt: 'Click' }),
        ProviderTimeoutError
      );
    });

    it('Anthropic adapter invokes mock endpoint and parses native computer tool use', async () => {
      const mockFetch = async (url, options) => {
        assert.ok(url.includes('/messages'));
        const body = JSON.parse(options.body);
        assert.strictEqual(body.model, 'claude-3-5-sonnet-20241022');
        assert.strictEqual(options.headers['anthropic-beta'], 'computer-use-2024-10-22');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [
              {
                type: 'tool_use',
                id: 'tu_01',
                name: 'computer',
                input: {
                  action: 'left_click',
                  coordinate: [820, 540]
                }
              }
            ]
          })
        };
      };

      const adapter = createAnthropicAdapter({
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
        fetchFn: mockFetch
      });

      const { action } = await adapter.proposeAction({
        prompt: 'Click save',
        screenshotBuffer: Buffer.from('fake-image-bytes')
      });

      assert.strictEqual(action.type, ComputerActionType.CLICK);
      assert.strictEqual(action.target.x, 820);
      assert.strictEqual(action.target.y, 540);
    });

    it('Gemini adapter invokes mock endpoint and parses function declarations', async () => {
      const mockFetch = async (url, options) => {
        assert.ok(url.includes('generateContent'));
        const body = JSON.parse(options.body);
        assert.ok(body.tools[0].functionDeclarations.length > 0);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'zetro_type_text',
                        args: { text: 'Gemini Pro typing' }
                      }
                    }
                  ]
                }
              }
            ]
          })
        };
      };

      const adapter = createGeminiAdapter({
        model: 'gemini-2.0-flash',
        apiKey: 'test-gemini-key',
        fetchFn: mockFetch
      });

      const { action } = await adapter.proposeAction({
        prompt: 'Type text',
        screenshotBuffer: Buffer.from('fake-image-bytes')
      });

      assert.strictEqual(action.type, ComputerActionType.TYPE_TEXT);
      assert.strictEqual(action.text, 'Gemini Pro typing');
    });
  });
});
