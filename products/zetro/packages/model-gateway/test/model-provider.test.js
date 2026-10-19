import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createModelProviderPort,
  ModelGatewayError,
  AdapterTranslationError
} from '../src/contracts/model-provider.js';
import { VerificationState } from '../src/contracts/capabilities.js';
import { ComputerActionType, MouseButton } from '../src/contracts/action-contract.js';

describe('ModelProviderPort Contract & Lifecycle', () => {
  const validProfile = {
    id: 'mock-multimodal-vlm',
    provider: 'test-harness',
    model: 'mock-v1',
    capabilities: {
      vision: VerificationState.VERIFIED,
      toolCalling: VerificationState.VERIFIED
    }
  };

  it('creates provider port and returns normalized action proposal', async () => {
    const provider = createModelProviderPort({
      profile: validProfile,
      async proposeActionImpl({ prompt }) {
        return {
          action: {
            type: ComputerActionType.CLICK,
            target: { kind: 'point', x: 200, y: 300 },
            button: MouseButton.LEFT
          },
          raw: { tool_calls: [{ name: 'click' }] },
          usage: { promptTokens: 120, completionTokens: 15 }
        };
      }
    });

    assert.strictEqual(provider.id, 'mock-multimodal-vlm');
    assert.strictEqual(provider.profile.id, 'mock-multimodal-vlm');

    const result = await provider.proposeAction({ prompt: 'Click the button' });
    assert.strictEqual(result.action.type, 'click');
    assert.strictEqual(result.action.target.x, 200);
    assert.strictEqual(result.action.target.y, 300);
    assert.ok(result.action.id);
    assert.strictEqual(result.usage.promptTokens, 120);
    assert.strictEqual(result.usage.completionTokens, 15);
  });

  it('fails closed when implementation returns no action', async () => {
    const provider = createModelProviderPort({
      profile: validProfile,
      async proposeActionImpl() {
        return null;
      }
    });

    await assert.rejects(
      () => provider.proposeAction({ prompt: 'Do something' }),
      AdapterTranslationError
    );
  });

  it('fails closed when implementation returns malformed canonical action', async () => {
    const provider = createModelProviderPort({
      profile: validProfile,
      async proposeActionImpl() {
        return {
          action: { type: 'invalid_unsupported_action_verb' }
        };
      }
    });

    await assert.rejects(
      () => provider.proposeAction({ prompt: 'Test' }),
      /Invalid or unsupported action type/
    );
  });

  it('rejects execution when provider is disabled', async () => {
    const provider = createModelProviderPort({
      profile: { ...validProfile, enabled: false },
      async proposeActionImpl() {
        return {};
      }
    });

    await assert.rejects(
      () => provider.proposeAction({ prompt: 'Test' }),
      /is disabled/
    );
  });

  it('tests connection probe successfully', async () => {
    let probeCalled = false;
    const provider = createModelProviderPort({
      profile: validProfile,
      async proposeActionImpl() { return {}; },
      async testConnectionImpl() {
        probeCalled = true;
        return { ok: true, latencyMs: 42 };
      }
    });

    const status = await provider.testConnection();
    assert.strictEqual(probeCalled, true);
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.latencyMs, 42);
  });
});
