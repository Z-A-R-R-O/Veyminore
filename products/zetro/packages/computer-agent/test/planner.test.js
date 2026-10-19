import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  COMPUTER_AGENT_TOOLS,
  validateToolProposal,
  parseDeterministicIntent,
  createPlannerPort
} from '../src/planner.js';
import { AgentErrorCode } from '../src/types.js';

describe('Structured Tool Schemas', () => {
  it('exposes defined tool schemas', () => {
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'resolve_app'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'launch_app'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'focus_window'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'type_text'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'click_element'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'press_key'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'wait_observe'));
    assert.ok(COMPUTER_AGENT_TOOLS.some(t => t.name === 'verify_state'));
  });

  it('validates tool proposals against schema', () => {
    const valid = validateToolProposal('type_text', {
      windowHandle: 100,
      processId: 200,
      text: 'hello'
    });
    assert.strictEqual(valid.valid, true);

    const missingParam = validateToolProposal('type_text', {
      windowHandle: 100
    });
    assert.strictEqual(missingParam.valid, false);
    assert.match(missingParam.error, /Missing required parameter/);

    const unknown = validateToolProposal('non_existent_tool', {});
    assert.strictEqual(unknown.valid, false);
    assert.match(unknown.error, /Unknown tool/);
  });
});

describe('Deterministic Intent Parser (Bounded Fallback)', () => {
  it('parses Workflow A: Notepad editor text entry with paraphrases', () => {
    const prompts = [
      'Open Notepad and type "Success — AGR-6 verified ZETRO."',
      'Please open a new Notepad document and type: "Testing ZETRO Computing"',
      'Launch notepad and write "Hello world"',
      'Start notepad and enter "Arbitrary content"'
    ];

    for (const p of prompts) {
      const parsed = parseDeterministicIntent(p);
      assert.strictEqual(parsed.ok, true, `Prompt '${p}' should have parsed`);
      assert.strictEqual(parsed.workflow, 'editor_text');
      assert.strictEqual(parsed.application.appId, 'notepad');
      assert.ok(parsed.payload.text);
    }
  });

  it('parses Workflow B: Chrome browser search with paraphrases', () => {
    const prompts = [
      'Open Chrome and search for "Veyminore ZETRO"',
      'Open google chrome and search "autonomous computing"',
      'Launch browser and look up "latest updates"'
    ];

    for (const p of prompts) {
      const parsed = parseDeterministicIntent(p);
      assert.strictEqual(parsed.ok, true, `Prompt '${p}' should have parsed`);
      assert.strictEqual(parsed.workflow, 'browser_search');
      assert.strictEqual(parsed.application.appId, 'chrome');
      assert.ok(parsed.payload.query);
    }
  });

  it('parses Workflow C: Windows Search with paraphrases', () => {
    const prompts = [
      'Open Windows Search and find "Calculator"',
      'Find and open application "Terminal"',
      'Search for app "Settings"'
    ];

    for (const p of prompts) {
      const parsed = parseDeterministicIntent(p);
      assert.strictEqual(parsed.ok, true, `Prompt '${p}' should have parsed`);
      assert.strictEqual(parsed.workflow, 'windows_search');
      assert.strictEqual(parsed.application.appId, 'windows_search');
      assert.ok(parsed.payload.targetApp);
    }
  });

  it('parses Workflow D: WhatsApp navigation', () => {
    const parsed = parseDeterministicIntent('Open WhatsApp and navigate to "Settings"');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.workflow, 'whatsapp_navigate');
    assert.strictEqual(parsed.application.appId, 'whatsapp');
    assert.strictEqual(parsed.payload.section, 'Settings');
  });

  it('blocks consequential action: WhatsApp messaging without explicit recipient and content', () => {
    const parsed = parseDeterministicIntent('Open WhatsApp and send message');
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.blocked, true);
    assert.strictEqual(parsed.reason, AgentErrorCode.AUTHORITY_DENIED);
    assert.match(parsed.error, /Consequential action blocked/);
  });

  it('rejects shell metacharacters in prompt', () => {
    const parsed = parseDeterministicIntent('Open Notepad; rm -rf /; and type "hi"');
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.blocked, true);
    assert.strictEqual(parsed.reason, AgentErrorCode.MALICIOUS_ARGUMENTS);
  });
});

describe('Planner Port', () => {
  it('generates multi-step structured plan from prompt', async () => {
    const planner = createPlannerPort();
    const result = await planner.planTask({
      prompt: 'Open Notepad and type "Hello from planner"'
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.workflow, 'editor_text');
    assert.ok(Array.isArray(result.plan));
    assert.strictEqual(result.plan.length, 5);
    assert.strictEqual(result.plan[0].tool, 'resolve_app');
    assert.strictEqual(result.plan[1].tool, 'launch_app');
    assert.strictEqual(result.plan[2].tool, 'wait_observe');
    assert.strictEqual(result.plan[3].tool, 'type_text');
    assert.strictEqual(result.plan[4].tool, 'verify_state');
  });

  it('supports injected live model planner', async () => {
    const mockLlm = async ({ prompt }) => ({
      plan: [
        { tool: 'resolve_app', parameters: { appName: 'notepad' } },
        { tool: 'type_text', parameters: { text: 'custom from LLM' } }
      ]
    });

    const planner = createPlannerPort({ llmPlanner: mockLlm });
    const result = await planner.planTask({ prompt: 'Custom prompt' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.source, 'live_model');
    assert.strictEqual(result.plan.length, 2);
  });

  it('fails closed when live model planner throws', async () => {
    const mockFailingLlm = async () => {
      throw new Error('API quota exceeded');
    };

    const planner = createPlannerPort({ llmPlanner: mockFailingLlm });
    const result = await planner.planTask({ prompt: 'Custom prompt' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.reason, AgentErrorCode.PLANNER_FAILED);
    assert.match(result.error, /API quota exceeded/);
  });
});
