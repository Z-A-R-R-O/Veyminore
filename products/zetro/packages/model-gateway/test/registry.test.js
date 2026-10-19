import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelProviderRegistry,
  ModelRegistryError,
  RegistryEvent,
  CapabilityProbe,
  VerificationState,
  ModelCompatibilityLevel,
  CapabilityMismatchError,
  createModelProviderPort
} from '../src/index.js';

test('ModelProviderRegistry: registers and retrieves models', () => {
  const registry = new ModelProviderRegistry();

  const model = registry.register({
    id: 'local-test-model',
    provider: 'openai-compatible',
    model: 'qwen2.5-coder:7b',
    endpoint: 'http://localhost:11434/v1',
    capabilities: {
      vision: VerificationState.VERIFIED,
      toolCalling: VerificationState.VERIFIED
    }
  });

  assert.equal(model.id, 'local-test-model');
  assert.equal(model.enabled, true);
  assert.equal(model.compatibilityLevel, ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING);
  assert.equal(registry.getDefaultModel().id, 'local-test-model');
});

test('ModelProviderRegistry: rejects duplicate or malformed registrations', () => {
  const registry = new ModelProviderRegistry();

  registry.register({
    id: 'm1',
    provider: 'driver-a',
    model: 'model-a'
  });

  // Duplicate ID
  assert.throws(() => {
    registry.register({ id: 'm1', provider: 'driver-b', model: 'model-b' });
  }, ModelRegistryError);

  // Missing fields
  assert.throws(() => registry.register({}), ModelRegistryError);
  assert.throws(() => registry.register({ id: 'm2' }), ModelRegistryError);
  assert.throws(() => registry.register({ id: 'm2', provider: 'driver-a' }), ModelRegistryError);
});

test('ModelProviderRegistry: manages lifecycle, enable/disable, and unregistration', () => {
  const registry = new ModelProviderRegistry();
  const events = [];

  registry.on(RegistryEvent.MODEL_REGISTERED, (e) => events.push(`reg:${e.model.id}`));
  registry.on(RegistryEvent.MODEL_STATUS_CHANGED, (e) => events.push(`status:${e.modelId}:${e.enabled}`));
  registry.on(RegistryEvent.MODEL_UNREGISTERED, (e) => events.push(`unreg:${e.modelId}`));

  registry.register({ id: 'model-1', provider: 'p1', model: 'm1' });
  registry.register({ id: 'model-2', provider: 'p2', model: 'm2' });

  assert.equal(registry.getDefaultModel().id, 'model-1');

  registry.setEnabled('model-1', false);
  assert.equal(registry.get('model-1').enabled, false);

  registry.unregister('model-1');
  assert.equal(registry.get('model-1'), null);
  // Default shifts to model-2
  assert.equal(registry.getDefaultModel().id, 'model-2');

  assert.ok(events.includes('reg:model-1'));
  assert.ok(events.includes('status:model-1:false'));
  assert.ok(events.includes('unreg:model-1'));
});

test('ModelProviderRegistry: dynamic capability updates recompute compatibility level', () => {
  const registry = new ModelProviderRegistry();
  registry.register({
    id: 'dynamic-model',
    provider: 'custom',
    model: 'unknown-model',
    capabilities: {
      vision: VerificationState.UNKNOWN,
      toolCalling: VerificationState.UNKNOWN
    }
  });

  const initial = registry.get('dynamic-model');
  assert.equal(initial.compatibilityLevel, ModelCompatibilityLevel.LEVEL_4_TEXT_ONLY);

  // Probe verified vision and tools!
  registry.updateCapabilities('dynamic-model', {
    vision: VerificationState.VERIFIED,
    toolCalling: VerificationState.VERIFIED
  });

  const updated = registry.get('dynamic-model');
  assert.equal(updated.compatibilityLevel, ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING);
  assert.ok(updated.lastVerifiedAt > 0);
});

test('ModelProviderRegistry: resolveModelForTask selects best eligible model', () => {
  const registry = new ModelProviderRegistry();

  registry.register({
    id: 'text-only-cloud',
    provider: 'cloud-a',
    model: 'text-model',
    capabilities: {
      vision: VerificationState.UNSUPPORTED,
      toolCalling: VerificationState.VERIFIED
    }
  });

  registry.register({
    id: 'multimodal-vision-tools',
    provider: 'cloud-b',
    model: 'vision-model',
    capabilities: {
      vision: VerificationState.VERIFIED,
      toolCalling: VerificationState.VERIFIED
    }
  });

  registry.register({
    id: 'local-vision-model',
    provider: 'local-server',
    model: 'local-v',
    endpoint: 'http://localhost:11434',
    capabilities: {
      vision: VerificationState.VERIFIED,
      toolCalling: VerificationState.VERIFIED,
      local: VerificationState.VERIFIED
    }
  });

  // Task 1: Requires vision -> must pick vision-capable model
  const resolvedVision = registry.resolveModelForTask({ requireVision: true });
  assert.equal(resolvedVision.capabilities.vision, VerificationState.VERIFIED);

  // Task 2: Requires vision + prefers local -> must pick local-vision-model
  const resolvedLocal = registry.resolveModelForTask({ requireVision: true, preferLocal: true });
  assert.equal(resolvedLocal.id, 'local-vision-model');

  // Task 3: Impossible requirement -> fails closed with CapabilityMismatchError
  assert.throws(() => {
    registry.resolveModelForTask({ requireVision: true, requireStructuredOutput: true });
  }, CapabilityMismatchError);
});

test('ModelProviderRegistry: toJSON and fromJSON roundtrip with secret redaction', () => {
  const registry = new ModelProviderRegistry();
  registry.register({
    id: 'secure-model',
    provider: 'secret-provider',
    model: 'secret-model',
    apiKey: 'sk-very-secret-key-123'
  });

  const serialized = registry.toJSON({ includeSecrets: false });
  assert.equal(serialized.models[0].apiKey, '***REDACTED***');

  const serializedWithSecrets = registry.toJSON({ includeSecrets: true });
  assert.equal(serializedWithSecrets.models[0].apiKey, 'sk-very-secret-key-123');

  const restored = ModelProviderRegistry.fromJSON(serializedWithSecrets);
  assert.equal(restored.get('secure-model').apiKey, 'sk-very-secret-key-123');
});

test('CapabilityProbe: actively evaluates provider capabilities', async () => {
  const probe = new CapabilityProbe();

  // Create a mock provider port that responds to tools and vision
  const mockPort = createModelProviderPort({
    profile: {
      id: 'test-port-1',
      provider: 'test-driver',
      model: 'test-mock-model',
      endpoint: 'http://localhost:8080/v1'
    },
    proposeActionImpl: async (req) => {
      if (req.availableTools) {
        return {
          action: {
            id: 'action-test-1',
            type: 'click',
            target: { kind: 'point', x: 100, y: 100 }
          }
        };
      }
      if (req.expectedSchema) {
        return {
          action: {
            id: 'action-test-2',
            type: 'wait',
            durationMs: 100
          }
        };
      }
      return {
        action: {
          id: 'action-test-3',
          type: 'observe'
        }
      };
    }
  });

  const result = await probe.probe(mockPort);

  assert.equal(result.probes.toolCalling.status, VerificationState.VERIFIED);
  assert.equal(result.probes.vision.status, VerificationState.VERIFIED);
  assert.equal(result.probes.structuredOutput.status, VerificationState.VERIFIED);
  assert.equal(result.capabilities.local, VerificationState.VERIFIED);
  assert.equal(result.compatibilityLevel, ModelCompatibilityLevel.LEVEL_1_NATIVE_COMPUTER_USE);
});
