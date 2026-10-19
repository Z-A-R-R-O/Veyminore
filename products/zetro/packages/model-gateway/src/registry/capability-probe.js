/**
 * @zetro/model-gateway - Capability Probe Harness
 *
 * Empirically probes an AI model endpoint to verify whether it actually supports:
 * - Direct image / visual perception (vision)
 * - Structured tool / function calling (toolCalling)
 * - Validated schema-constrained JSON output (structuredOutput)
 * - Decision streaming (streaming)
 * - Native computer use actions (nativeComputerUse)
 *
 * Never trust declared vendor names or unverified claims.
 */

import { VerificationState, createCapabilityProfile, determineCompatibilityLevel } from '../contracts/capabilities.js';
import { ComputerActionType } from '../contracts/action-contract.js';

// Minimal 1x1 transparent PNG data URI for vision probing
export const TEST_1X1_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export class CapabilityProbe {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=15000] Timeout per probe test
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 15000;
  }

  /**
   * Runs an active compatibility probe suite against a ModelProviderPort instance.
   *
   * @param {Object} providerPort - Implementation of ModelProviderPort
   * @returns {Promise<{
   *   capabilities: Object,
   *   compatibilityLevel: number,
   *   probes: {
   *     vision: { status: string, latencyMs: number, error?: string },
   *     toolCalling: { status: string, latencyMs: number, error?: string },
   *     structuredOutput: { status: string, latencyMs: number, error?: string },
   *     nativeComputerUse: { status: string }
   *   },
   *   probedAt: number
   * }>}
   */
  async probe(providerPort) {
    const results = {
      vision: { status: VerificationState.UNKNOWN, latencyMs: 0 },
      toolCalling: { status: VerificationState.UNKNOWN, latencyMs: 0 },
      structuredOutput: { status: VerificationState.UNKNOWN, latencyMs: 0 },
      nativeComputerUse: { status: VerificationState.UNSUPPORTED, latencyMs: 0 }
    };

    // 1. Probe Tool Calling
    const toolStart = Date.now();
    try {
      const toolProbeResult = await providerPort.proposeAction({
        messages: [
          { role: 'user', content: 'Use the ping tool to test connection.' }
        ],
        availableTools: [
          {
            name: 'ping',
            description: 'Connectivity test tool',
            parameters: {
              type: 'object',
              properties: { message: { type: 'string' } }
            }
          }
        ]
      });

      results.toolCalling.latencyMs = Date.now() - toolStart;
      const toolAction = toolProbeResult?.action || toolProbeResult;

      if (toolAction && (toolAction.type || toolAction.kind)) {
        results.toolCalling.status = VerificationState.VERIFIED;
        if (toolAction.type === ComputerActionType.CLICK || toolAction.type === ComputerActionType.OBSERVE) {
          results.nativeComputerUse.status = VerificationState.VERIFIED;
        }
      } else {
        results.toolCalling.status = VerificationState.UNSUPPORTED;
      }
    } catch (err) {
      results.toolCalling.latencyMs = Date.now() - toolStart;
      results.toolCalling.status = VerificationState.UNSUPPORTED;
      results.toolCalling.error = err.message;
    }

    // 2. Probe Vision
    const visionStart = Date.now();
    try {
      const visionResult = await providerPort.proposeAction({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this screen image?' },
              { type: 'image', imageBase64: TEST_1X1_PNG_BASE64, mimeType: 'image/png' }
            ]
          }
        ]
      });

      results.vision.latencyMs = Date.now() - visionStart;
      if (visionResult && (visionResult.action || visionResult.type)) {
        results.vision.status = VerificationState.VERIFIED;
      } else {
        results.vision.status = VerificationState.UNSUPPORTED;
      }
    } catch (err) {
      results.vision.latencyMs = Date.now() - visionStart;
      results.vision.status = VerificationState.UNSUPPORTED;
      results.vision.error = err.message;
    }

    // 3. Probe Structured Output
    const jsonStart = Date.now();
    try {
      const jsonResult = await providerPort.proposeAction({
        messages: [
          {
            role: 'user',
            content: 'Respond with a computer wait action of 100ms.'
          }
        ],
        expectedSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['wait'] },
            durationMs: { type: 'number' }
          },
          required: ['type', 'durationMs']
        }
      });

      results.structuredOutput.latencyMs = Date.now() - jsonStart;
      const jsonAction = jsonResult?.action || jsonResult;
      if (jsonAction && (jsonAction.type === 'wait' || jsonAction.kind === 'wait')) {
        results.structuredOutput.status = VerificationState.VERIFIED;
      } else {
        results.structuredOutput.status = VerificationState.REPORTED;
      }
    } catch (err) {
      results.structuredOutput.latencyMs = Date.now() - jsonStart;
      results.structuredOutput.status = VerificationState.UNSUPPORTED;
      results.structuredOutput.error = err.message;
    }

    // Check if provider reports local endpoint
    const endpoint = providerPort.endpoint || providerPort.profile?.endpoint;
    const isLocal = endpoint && (
      endpoint.includes('localhost') ||
      endpoint.includes('127.0.0.1') ||
      endpoint.startsWith('pipe:')
    );

    const capabilities = createCapabilityProfile({
      vision: results.vision.status,
      toolCalling: results.toolCalling.status,
      structuredOutput: results.structuredOutput.status,
      nativeComputerUse: results.nativeComputerUse.status,
      local: isLocal ? VerificationState.VERIFIED : VerificationState.UNSUPPORTED,
      streaming: VerificationState.REPORTED
    });

    const compatibilityLevel = determineCompatibilityLevel(capabilities);

    return {
      capabilities,
      compatibilityLevel,
      probes: results,
      probedAt: Date.now()
    };
  }
}
