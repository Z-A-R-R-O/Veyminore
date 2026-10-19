import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  VerificationState,
  ModelCompatibilityLevel,
  validateModelProfile,
  determineCompatibilityLevel,
  CapabilityValidationError
} from '../src/contracts/capabilities.js';

describe('Model Capabilities and Compatibility Ladder', () => {
  it('validates a complete model profile and computes compatibility level', () => {
    const profile = validateModelProfile({
      id: 'local-qwen-vl',
      provider: 'openai-compatible',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen2.5-vl:7b',
      enabled: true,
      capabilities: {
        vision: VerificationState.VERIFIED,
        toolCalling: VerificationState.VERIFIED,
        structuredOutput: VerificationState.VERIFIED,
        nativeComputerUse: VerificationState.UNSUPPORTED,
        streaming: VerificationState.VERIFIED,
        local: VerificationState.VERIFIED
      },
      limits: {
        maxContextTokens: 65536,
        maxImagesPerRequest: 2,
        maxRequestsPerMinute: 100
      },
      policy: {
        maxActionsPerRun: 20,
        allowTier2WithoutApproval: false
      }
    });

    assert.strictEqual(profile.id, 'local-qwen-vl');
    assert.strictEqual(profile.provider, 'openai-compatible');
    assert.strictEqual(profile.endpoint, 'http://localhost:11434/v1');
    assert.strictEqual(profile.enabled, true);
    assert.strictEqual(profile.capabilities.vision, 'verified');
    assert.strictEqual(profile.capabilities.toolCalling, 'verified');
    assert.strictEqual(profile.capabilities.nativeComputerUse, 'unsupported');
    assert.strictEqual(profile.compatibilityLevel, ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING);
  });

  it('determines Level 1 for Vision + Native Computer Use', () => {
    const level = determineCompatibilityLevel({
      vision: VerificationState.VERIFIED,
      nativeComputerUse: VerificationState.VERIFIED,
      toolCalling: VerificationState.VERIFIED
    });
    assert.strictEqual(level, ModelCompatibilityLevel.LEVEL_1_NATIVE_COMPUTER_USE);
  });

  it('determines Level 2 for Vision + Function Calling', () => {
    const level = determineCompatibilityLevel({
      vision: VerificationState.VERIFIED,
      nativeComputerUse: VerificationState.UNSUPPORTED,
      toolCalling: VerificationState.VERIFIED
    });
    assert.strictEqual(level, ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING);
  });

  it('determines Level 3 for Vision + Structured JSON Output', () => {
    const level = determineCompatibilityLevel({
      vision: VerificationState.VERIFIED,
      nativeComputerUse: VerificationState.UNSUPPORTED,
      toolCalling: VerificationState.UNSUPPORTED,
      structuredOutput: VerificationState.VERIFIED
    });
    assert.strictEqual(level, ModelCompatibilityLevel.LEVEL_3_STRUCTURED_OUTPUT);
  });

  it('determines Level 4 for text-only or non-vision models', () => {
    const level = determineCompatibilityLevel({
      vision: VerificationState.UNSUPPORTED,
      toolCalling: VerificationState.VERIFIED
    });
    assert.strictEqual(level, ModelCompatibilityLevel.LEVEL_4_TEXT_ONLY);
  });

  it('rejects profiles missing mandatory id, provider or model', () => {
    assert.throws(
      () => validateModelProfile({ provider: 'openai', model: 'gpt-4o' }),
      CapabilityValidationError
    );
    assert.throws(
      () => validateModelProfile({ id: 'test', model: 'gpt-4o' }),
      CapabilityValidationError
    );
    assert.throws(
      () => validateModelProfile({ id: 'test', provider: 'openai', model: '' }),
      CapabilityValidationError
    );
  });
});
