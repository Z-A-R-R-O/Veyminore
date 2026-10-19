import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createExecutionJournal,
  createModelRouter,
  ModelRouterError,
  runUniversalComputerAgent,
  UniversalAgentLoopError
} from '../src/index.js';
import {
  ModelProviderRegistry,
  createModelProviderPort,
  ProviderTimeoutError,
  ModelCompatibilityLevel
} from '../../model-gateway/src/index.js';


function admittedFixture() {
  const target = { targetId: 'fixture-window', hwnd: 1, processId: 42, processStartedAt: 1 };
  return {
    session: { sessionId: 'fixture-session', targetId: target.targetId, target, expiresAt: Date.now() + 10000 },
    observer: { observe: async () => ({ timestamp: Date.now(), target }) },
    policyGate: { evaluate: async () => ({ allowed: true }) },
    verifier: { verifyStep: async () => ({ verified: true }), verifyGoal: async () => ({ verified: true }) }
  };
}

describe('Milestone U4: Universal Agent & Execution Journal', () => {
  describe('ExecutionJournal & Cryptographic Chain', () => {
    it('creates execution journal, appends steps, and verifies SHA-256 hash integrity', () => {
      const journal = createExecutionJournal({ taskGoal: 'Create hello folder in Downloads' });

      const e1 = journal.appendStep({
        modelId: 'claude-3-7-sonnet',
        action: { type: 'observe' },
        status: 'success'
      });
      assert.ok(e1.hash);
      assert.strictEqual(e1.stepIndex, 0);

      const e2 = journal.appendStep({
        modelId: 'claude-3-7-sonnet',
        action: { type: 'click', target: { kind: 'point', x: 200, y: 300 } },
        status: 'success'
      });
      assert.strictEqual(e2.previousHash, e1.hash);
      assert.ok(journal.verifyIntegrity());

      const summary = journal.getSummary();
      assert.strictEqual(summary.totalSteps, 2);
      assert.strictEqual(summary.successfulSteps, 2);
      assert.deepStrictEqual(summary.modelsUsed, ['claude-3-7-sonnet']);
      assert.strictEqual(summary.integrityVerified, true);
    });

    it('detects tampering in execution journal', () => {
      const journal = createExecutionJournal({ taskGoal: 'Tamper test' });
      journal.appendStep({ modelId: 'gpt-4o', action: { type: 'observe' } });
      journal.appendStep({ modelId: 'gpt-4o', action: { type: 'click', target: { kind: 'point', x: 10, y: 20 } } });

      assert.ok(journal.verifyIntegrity());

      // Tamper with an entry in-place
      journal.getEntries()[0].modelId = 'malicious-injected-model';
      // Integrity check should fail because hash no longer matches payload
      assert.strictEqual(journal.verifyIntegrity(), false);
    });
  });

  describe('Capability-Aware ModelRouter', () => {
    function createMockRegistry() {
      const registry = new ModelProviderRegistry();

      // Model A: Level 1 (Vision + Native Computer Use)
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'claude-sonnet-computer',
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          capabilities: { vision: 'verified', toolCalling: 'verified', nativeComputerUse: 'verified' }
        },
        proposeActionImpl: async () => ({
          action: { type: 'click', target: { kind: 'point', x: 100, y: 100 } }
        })
      }));

      // Model B: Level 2 (Vision + Function Calling)
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'gpt-4o-vision',
          provider: 'openai',
          model: 'gpt-4o',
          capabilities: { vision: 'verified', toolCalling: 'verified', nativeComputerUse: 'unsupported' }
        },
        proposeActionImpl: async () => ({
          action: { type: 'click', target: { kind: 'point', x: 200, y: 200 } }
        })
      }));

      // Model C: Level 3 (Vision + Structured JSON)
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'local-qwen-vl',
          provider: 'openai-compatible',
          model: 'qwen2.5-vl',
          capabilities: { vision: 'verified', toolCalling: 'unsupported', structuredOutput: 'verified' }
        },
        proposeActionImpl: async () => ({
          action: { type: 'click', target: { kind: 'point', x: 300, y: 300 } }
        })
      }));

      return registry;
    }

    it('ranks candidate models in order of capability level', () => {
      const registry = createMockRegistry();
      const router = createModelRouter({ registry });

      const ladder = router.resolveCandidateLadder({ requiredCapabilities: ['vision'] });
      assert.strictEqual(ladder.length, 3);
      // Level 1 first
      assert.strictEqual(ladder[0].id, 'claude-sonnet-computer');
      assert.strictEqual(ladder[0].compatibilityLevel, ModelCompatibilityLevel.LEVEL_1_NATIVE_COMPUTER_USE);
      // Level 2 second
      assert.strictEqual(ladder[1].id, 'gpt-4o-vision');
      assert.strictEqual(ladder[1].compatibilityLevel, ModelCompatibilityLevel.LEVEL_2_FUNCTION_CALLING);
      // Level 3 third
      assert.strictEqual(ladder[2].id, 'local-qwen-vl');
      assert.strictEqual(ladder[2].compatibilityLevel, ModelCompatibilityLevel.LEVEL_3_STRUCTURED_OUTPUT);
    });

    it('fails over cleanly to backup model when primary times out', async () => {
      const registry = new ModelProviderRegistry();
      let switches = [];

      // Primary model that always times out
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'failing-primary',
          provider: 'anthropic',
          model: 'failing-claude',
          capabilities: { vision: 'verified', toolCalling: 'verified', nativeComputerUse: 'verified' }
        },
        proposeActionImpl: async () => {
          throw new ProviderTimeoutError('failing-primary', 30000);
        }
      }));

      // Backup model that succeeds
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'reliable-backup',
          provider: 'openai',
          model: 'gpt-4o',
          capabilities: { vision: 'verified', toolCalling: 'verified' }
        },
        proposeActionImpl: async () => ({
          action: { type: 'typeText', text: 'Backup executed' }
        })
      }));

      const router = createModelRouter({
        registry,
        onModelSwitch: (sw) => switches.push(sw)
      });

      const proposal = await router.proposeWithFallback({
        prompt: 'Type text',
        requiredCapabilities: ['vision']
      });

      assert.strictEqual(proposal.modelId, 'reliable-backup');
      assert.strictEqual(proposal.action.type, 'typeText');
      assert.strictEqual(proposal.action.text, 'Backup executed');
      assert.strictEqual(switches.length, 1);
      assert.strictEqual(switches[0].from, 'failing-primary');
      assert.strictEqual(switches[0].to, 'reliable-backup');
    });
  });

  describe('Universal Computer Agent Loop', () => {
    it('executes prompt to verified finish completion', async () => {
      const registry = new ModelProviderRegistry();

      let stepNum = 0;
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'test-agent-brain',
          provider: 'test',
          model: 'mock-agent',
          capabilities: { vision: 'verified', toolCalling: 'verified' }
        },
        proposeActionImpl: async () => {
          stepNum++;
          if (stepNum === 1) {
            return {
              action: { type: 'click', target: { kind: 'point', x: 50, y: 50 } }
            };
          }
          return {
            action: { type: 'finish', success: true, summary: 'Created Hello folder successfully' }
          };
        }
      }));

      const router = createModelRouter({ registry });
      const actionsDispatched = [];

      const mockDispatcher = {
        dispatch: async (action) => {
          actionsDispatched.push(action);
          return { success: true, durationMs: 10 };
        }
      };

      const result = await runUniversalComputerAgent({
        ...admittedFixture(),
        goal: 'Open Downloads and create Hello folder',
        router,
        actionDispatcher: mockDispatcher,
        screenCapturer: async () => Buffer.from('fake-screen-data')
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.summary, 'Goal independently verified');
      assert.strictEqual(result.steps, 2);
      assert.strictEqual(actionsDispatched.length, 1);
      assert.strictEqual(actionsDispatched[0].type, 'click');
      assert.ok(result.journal.verifyIntegrity());
    });

    it('halts immediately upon human takeover', async () => {
      const registry = new ModelProviderRegistry();
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'test-brain',
          provider: 'test',
          model: 'mock',
          capabilities: { vision: 'verified', toolCalling: 'verified' }
        },
        proposeActionImpl: async () => ({
          action: { type: 'click', target: { kind: 'point', x: 200, y: 200 } }
        })
      }));

      const router = createModelRouter({ registry });
      let takeoverCalled = false;

      const mockDispatcher = {
        dispatch: async () => ({
          success: false,
          interrupted: true,
          details: 'Human takeover detected'
        })
      };

      const result = await runUniversalComputerAgent({
        ...admittedFixture(),
        goal: 'Move mouse and click',
        router,
        actionDispatcher: mockDispatcher,
        screenCapturer: async () => Buffer.from('fake-screen'),
        onHumanTakeover: () => {
          takeoverCalled = true;
        }
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.interrupted, true);
      assert.strictEqual(takeoverCalled, true);
      assert.strictEqual(result.journal.getSummary().interruptedSteps, 1);
    });

    it('halts and requests approval for consequential action', async () => {
      const registry = new ModelProviderRegistry();
      registry.registerModel(createModelProviderPort({
        profile: {
          id: 'consequential-brain',
          provider: 'test',
          model: 'mock',
          capabilities: { vision: 'verified', toolCalling: 'verified' }
        },
        proposeActionImpl: async () => ({
          action: {
            type: 'requestApproval',
            reason: 'Format hard drive or delete files',
            proposedEffect: 'Permanent file deletion',
            riskLevel: 'consequential'
          }
        })
      }));

      const router = createModelRouter({ registry });
      const mockDispatcher = { dispatch: async () => ({ success: true }) };

      // Case 1: Denied by supervisor
      const resultDenied = await runUniversalComputerAgent({
        ...admittedFixture(),
        goal: 'Delete files',
        router,
        actionDispatcher: mockDispatcher,
        screenCapturer: async () => Buffer.from('screen'),
        onApprovalNeeded: async () => false
      });

      assert.strictEqual(resultDenied.success, false);
      assert.strictEqual(resultDenied.approvalNeeded, true);

      // Case 2: Approved by supervisor
      let executionCount = 0;
      let stepCount = 0;
      const approvedRegistry = new ModelProviderRegistry();
      approvedRegistry.registerModel(createModelProviderPort({
        profile: {
          id: 'approved-brain',
          provider: 'test',
          model: 'mock',
          capabilities: { vision: 'verified', toolCalling: 'verified' }
        },
        proposeActionImpl: async () => {
          stepCount++;
          if (stepCount === 1) {
            return {
              action: {
                type: 'requestApproval',
                reason: 'Restart service',
                proposedEffect: 'Service restart',
                riskLevel: 'consequential'
              }
            };
          }
          return { action: { type: 'finish', success: true, summary: 'Service restarted' } };
        }
      }));

      const approvedRouter = createModelRouter({ registry: approvedRegistry });
      const approvedDispatcher = {
        dispatch: async () => {
          executionCount++;
          return { success: true };
        }
      };

      const resultApproved = await runUniversalComputerAgent({
        ...admittedFixture(),
        goal: 'Restart service',
        router: approvedRouter,
        actionDispatcher: approvedDispatcher,
        screenCapturer: async () => Buffer.from('screen'),
        onApprovalNeeded: async () => true
      });

      assert.strictEqual(resultApproved.success, false);
      assert.strictEqual(resultApproved.approvalNeeded, true);
      assert.strictEqual(executionCount, 0); // Approval requests are not executable effects.
    });
  });
});
