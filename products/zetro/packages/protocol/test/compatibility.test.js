import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rctManifestToProtocolAssignment,
  protocolAssignmentToRctManifest,
  rctReceiptToTaskResult,
  dispatcherEnvelopeToProtocolAssignment,
  protocolAssignmentToDispatcherEnvelope,
  dispatcherReceiptToTaskResult,
  taskResultToDispatcherReceipt,
  bridgeMcpReceiptToWorkerClaim,
  bridgeEventToProtocolEvent,
  protocolEventToBridgeEvent,
  TaskState,
  VerificationStatus,
  WorkerReportedState
} from '../src/index.js';

describe('Protocol Compatibility Adapters', () => {
  describe('RCT Compatibility', () => {
    const sampleRctManifest = {
      schemaVersion: 'rct.assignment.v1',
      taskId: 'rct-001',
      objective: 'Refactor parser function',
      acceptance: ['Unit test passes', 'No lint errors'],
      source: {
        root: 'E:/Veyminore/products/zetro'
      },
      scope: {
        readPaths: ['src/parser.js'],
        writePaths: ['src/parser.js'],
        createPaths: []
      },
      checks: [
        {
          type: 'contains',
          path: 'src/parser.js',
          text: 'export function parse()'
        }
      ],
      dataPolicy: {
        classification: 'public',
        allowRemoteInference: false,
        provider: 'mock-provider',
        model: 'mock-v1'
      },
      budget: {
        maxTurns: 8,
        maxInputTokens: 5000,
        maxOutputTokens: 2500,
        maxPromptChars: 12000,
        maxReadBytes: 4096,
        maxWriteBytes: 4096,
        maxWallMs: 25000
      }
    };

    it('converts an RCT manifest into a valid Protocol Assignment', () => {
      const assignment = rctManifestToProtocolAssignment(sampleRctManifest, {
        attemptId: 2,
        agentId: 'AGR-2'
      });

      assert.equal(assignment.taskId, 'rct-001');
      assert.equal(assignment.attemptId, 2);
      assert.equal(assignment.agentId, 'AGR-2');
      assert.deepEqual(assignment.scope.readPaths, ['src/parser.js']);
      assert.equal(assignment.checks[0].type, 'contains');
    });

    it('roundtrips from RCT manifest to Protocol Assignment and back', () => {
      const assignment = rctManifestToProtocolAssignment(sampleRctManifest);
      const backToManifest = protocolAssignmentToRctManifest(assignment);

      assert.equal(backToManifest.schemaVersion, 'rct.assignment.v1');
      assert.equal(backToManifest.taskId, sampleRctManifest.taskId);
      assert.equal(backToManifest.objective, sampleRctManifest.objective);
      assert.deepEqual(backToManifest.checks, sampleRctManifest.checks);
    });

    it('maps RCT receipt review_ready to completed only when checks pass', () => {
      const rctSuccessReceipt = {
        id: 'rct-001',
        state: 'review_ready',
        workerSummary: 'Fixed the parser implementation',
        patches: [
          {
            path: 'src/parser.js',
            before: 'old',
            after: 'new',
            applied: true
          }
        ],
        checks: [
          {
            type: 'contains',
            path: 'src/parser.js',
            passed: true
          }
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
        elapsedMs: 2000
      };

      const result = rctReceiptToTaskResult(rctSuccessReceipt, { attemptId: 1 });
      assert.equal(result.status, TaskState.COMPLETED);
      assert.equal(result.verification.verified, true);
      assert.equal(result.verification.status, VerificationStatus.PASSED);
      assert.equal(result.workerClaim.reportedState, WorkerReportedState.SUBMITTED);
      assert.equal(result.effects.applied, true);
    });

    it('maps RCT receipt with failed checks to failed status even if state is review_ready', () => {
      const rctFailedReceipt = {
        id: 'rct-001',
        state: 'review_ready',
        workerSummary: 'Attempted fix but checks did not pass',
        patches: [],
        checks: [
          {
            type: 'contains',
            path: 'src/parser.js',
            passed: false
          }
        ]
      };

      const result = rctReceiptToTaskResult(rctFailedReceipt, { attemptId: 1 });
      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.status, VerificationStatus.FAILED);
    });

    it('maps RCT transport unknown error to TaskState.UNKNOWN with uncertainty details', () => {
      const rctUnknownReceipt = {
        id: 'rct-001',
        state: 'unknown',
        failureReason: 'transport_error',
        remoteUsageUncertain: true,
        patches: [],
        checks: []
      };

      const result = rctReceiptToTaskResult(rctUnknownReceipt, { attemptId: 1 });
      assert.equal(result.status, TaskState.UNKNOWN);
      assert.equal(result.uncertainty.isUncertain, true);
      assert(result.uncertainty.reasons.includes('transport_error'));
    });
  });

  describe('Dispatcher Compatibility', () => {
    const sampleEnvelope = {
      id: 'disp-001',
      agent: 'AGR-3',
      objective: 'Run test validation suite',
      contextRefs: ['ref-1'],
      allowedPaths: ['src/dispatcher.js'],
      acceptance: 'All dispatcher tests pass',
      verification: 'node --test test/*.test.js',
      deadlineMs: 40000,
      budget: {
        maxContextChars: 45000,
        maxReplyChars: 8000
      }
    };

    it('converts Dispatcher TaskEnvelope to Protocol Assignment', () => {
      const assignment = dispatcherEnvelopeToProtocolAssignment(sampleEnvelope, {
        attemptId: 1,
        sourceRoot: 'E:/Veyminore/products/zetro'
      });

      assert.equal(assignment.taskId, 'disp-001');
      assert.equal(assignment.agentId, 'AGR-3');
      assert.equal(assignment.deadlineMs, 40000);
      assert.deepEqual(assignment.scope.readPaths, ['src/dispatcher.js']);
    });

    it('roundtrips Protocol Assignment to Dispatcher TaskEnvelope', () => {
      const assignment = dispatcherEnvelopeToProtocolAssignment(sampleEnvelope);
      const envelope = protocolAssignmentToDispatcherEnvelope(assignment);

      assert.equal(envelope.id, sampleEnvelope.id);
      assert.equal(envelope.agent, sampleEnvelope.agent);
      assert.equal(envelope.deadlineMs, sampleEnvelope.deadlineMs);
      assert.deepEqual(envelope.scope.readPaths, ['src/dispatcher.js']);
      assert.deepEqual(envelope.scope.writePaths, ['src/dispatcher.js']);

      // Roundtrips back to Assignment preserving partitioned scope
      const restored = dispatcherEnvelopeToProtocolAssignment(envelope);
      assert.deepEqual(restored.scope.readPaths, assignment.scope.readPaths);
      assert.deepEqual(restored.scope.writePaths, assignment.scope.writePaths);
    });

    it('converts Dispatcher TaskReceipt to TaskResult and back with trustedChecks', () => {
      const receipt = {
        id: 'disp-001',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/dispatcher.js'],
        checks: ['npm test: passed'],
        evidenceRefs: [],
        summary: 'Finished successfully',
        uncertainty: ''
      };

      const taskResult = dispatcherReceiptToTaskResult(receipt, {
        attemptId: 1,
        verifierId: 'independent_verifier',
        trustedChecks: [{ checkId: 'c1', passed: true }]
      });
      assert.equal(taskResult.status, TaskState.COMPLETED);
      assert.equal(taskResult.verification.verified, true);
      assert.equal(taskResult.verification.verifierId, 'independent_verifier');

      const back = taskResultToDispatcherReceipt(taskResult);
      assert.equal(back.id, 'disp-001');
      assert.equal(back.state, 'COMPLETED');
    });
  });

  describe('Bridge Compatibility', () => {
    it('maps bridge MCP submit_receipt to unverified worker claim', () => {
      const mcpSubmission = {
        taskId: 'bridge-001',
        capabilityDigest: 'cap-1234',
        receipt: {
          status: 'success',
          agent: 'AGR-4',
          paths: ['src/index.js'],
          summary: 'Worker reports done'
        }
      };

      const claim = bridgeMcpReceiptToWorkerClaim(mcpSubmission);
      assert.equal(claim.taskId, 'bridge-001');
      assert.equal(claim.agentId, 'AGR-4');
      assert.equal(claim.reportedState, WorkerReportedState.SUBMITTED);
      assert.equal(claim.verified, false); // Must never claim verification!
    });

    it('roundtrips bridge journal events to Protocol Events', () => {
      const bridgeEvent = {
        taskId: 'bridge-001',
        agent: 'AGR-1',
        type: 'submitted',
        attempt: 1,
        timestamp: 1700000000000,
        status: 'ok',
        details: { step: 5 }
      };

      const protocolEvent = bridgeEventToProtocolEvent(bridgeEvent);
      assert.equal(protocolEvent.type, 'submitted');
      assert.equal(protocolEvent.actor.principalId, 'AGR-1');

      const backToBridge = protocolEventToBridgeEvent(protocolEvent);
      assert.equal(backToBridge.taskId, bridgeEvent.taskId);
      assert.equal(backToBridge.type, 'submitted');
    });
  });
});
