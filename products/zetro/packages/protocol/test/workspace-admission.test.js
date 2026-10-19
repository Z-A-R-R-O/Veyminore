import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceAdmission,
  validateWorkspaceAdmission,
  isWorkspaceAdmission,
  computeWorkspaceAdmissionDigest,
  evaluateAuthority,
  createActionRequest,
  ActionType,
  SCHEMA_VERSIONS,
  ValidationError
} from '../src/index.js';

describe('WorkspaceAdmission Contract (zetro.protocol.workspace_admission.v1)', () => {
  const validAdmissionParams = {
    workspaceId: 'ws-sandbox-01',
    taskId: 'task-build-42',
    attemptId: 1,
    canonicalRoot: 'E:/Veyminore/products/zetro/sandboxes/ws-sandbox-01',
    sourceBaselineRoot: 'E:/Veyminore/products/zetro',
    sourceBaselineHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    baselineCommit: '90db896ea4efd67cb7eb086fcf81b35a1e5e1291',
    scope: {
      readPaths: ['src/index.js', 'package.json'],
      writePaths: ['src/index.js'],
      createPaths: ['src/new-feature.js'],
      commands: [['npm', 'test']]
    }
  };

  it('creates and validates an immutable WorkspaceAdmission contract', () => {
    const adm = createWorkspaceAdmission(validAdmissionParams);

    assert.equal(adm.schemaVersion, SCHEMA_VERSIONS.WORKSPACE_ADMISSION);
    assert.equal(adm.workspaceId, 'ws-sandbox-01');
    assert.equal(adm.taskId, 'task-build-42');
    assert.equal(adm.attemptId, 1);
    assert.equal(adm.canonicalRoot, 'E:/Veyminore/products/zetro/sandboxes/ws-sandbox-01');
    assert.equal(adm.sourceBaselineRoot, 'E:/Veyminore/products/zetro');
    assert.equal(adm.sourceBaselineHash.length, 64);
    assert.equal(adm.baselineCommit, '90db896ea4efd67cb7eb086fcf81b35a1e5e1291');
    assert.equal(adm.admissionDigest.length, 64);
    assert.deepEqual(adm.scope.readPaths, ['package.json', 'src/index.js']);
    assert.deepEqual(adm.scope.writePaths, ['src/index.js']);
    assert.deepEqual(adm.scope.createPaths, ['src/new-feature.js']);
    assert.deepEqual(adm.scope.commands, [['npm', 'test']]);
    assert.equal(isWorkspaceAdmission(adm), true);

    const revalidated = validateWorkspaceAdmission(adm, { verifyDigest: true });
    assert.equal(revalidated.admissionDigest, adm.admissionDigest);
  });

  it('enforces deep freeze immutability: prevents property addition or modification', () => {
    const adm = createWorkspaceAdmission(validAdmissionParams);

    assert.throws(() => {
      adm.canonicalRoot = 'E:/malicious/escape';
    }, TypeError);

    assert.throws(() => {
      adm.scope.readPaths.push('evil/secret.txt');
    }, TypeError);

    assert.throws(() => {
      adm.scope.writePaths[0] = 'evil/overwrite.js';
    }, TypeError);

    assert.throws(() => {
      adm.extraField = 'injected';
    }, TypeError);
  });

  it('enforces root separation invariant when write or create scopes are declared', () => {
    // Attempting to admit workspace with canonicalRoot === sourceBaselineRoot when writePaths > 0
    assert.throws(
      () => createWorkspaceAdmission({
        ...validAdmissionParams,
        canonicalRoot: 'E:/Veyminore/products/zetro',
        sourceBaselineRoot: 'E:/Veyminore/products/zetro',
        scope: {
          readPaths: ['src/index.js'],
          writePaths: ['src/index.js']
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert.match(err.message, /must not equal sourceBaselineRoot/);
        return true;
      }
    );

    // Attempting to admit workspace with canonicalRoot === sourceBaselineRoot when createPaths > 0
    assert.throws(
      () => createWorkspaceAdmission({
        ...validAdmissionParams,
        canonicalRoot: 'E:/Veyminore/products/zetro',
        sourceBaselineRoot: 'E:/Veyminore/products/zetro',
        scope: {
          readPaths: ['src/index.js'],
          createPaths: ['src/new.js']
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert.match(err.message, /must not equal sourceBaselineRoot/);
        return true;
      }
    );

    // Read-only scope is permitted to share sourceBaselineRoot (e.g. read-only auditor/inspector)
    const readOnlyAdm = createWorkspaceAdmission({
      ...validAdmissionParams,
      canonicalRoot: 'E:/Veyminore/products/zetro',
      sourceBaselineRoot: 'E:/Veyminore/products/zetro',
      scope: {
        readPaths: ['src/index.js'],
        writePaths: [],
        createPaths: [],
        commands: [['npm', 'test']]
      }
    });
    assert.equal(readOnlyAdm.canonicalRoot, readOnlyAdm.sourceBaselineRoot);
    assert.equal(isWorkspaceAdmission(readOnlyAdm), true);
  });

  it('detects digest tampering and validates cryptographic admission digest', () => {
    const adm = createWorkspaceAdmission(validAdmissionParams);
    const expectedDigest = computeWorkspaceAdmissionDigest(adm);
    assert.equal(adm.admissionDigest, expectedDigest);

    // Tampered admission with invalid digest
    const tampered = {
      ...adm,
      admissionDigest: '0000000000000000000000000000000000000000000000000000000000000000'
    };
    assert.throws(
      () => validateWorkspaceAdmission(tampered, { verifyDigest: true }),
      (err) => {
        assert(err instanceof ValidationError);
        assert.match(err.message, /admissionDigest mismatch/);
        return true;
      }
    );
  });

  it('rejects malformed workspace paths and traversal segments', () => {
    // Relative canonicalRoot
    assert.throws(
      () => createWorkspaceAdmission({ ...validAdmissionParams, canonicalRoot: 'relative/path' }),
      /canonicalRoot must be an absolute directory path/
    );

    // Traversal in canonicalRoot
    assert.throws(
      () => createWorkspaceAdmission({ ...validAdmissionParams, canonicalRoot: 'E:/Veyminore/../products' }),
      /traversal segment/
    );

    // Traversal in readPaths
    assert.throws(
      () => createWorkspaceAdmission({
        ...validAdmissionParams,
        scope: { readPaths: ['../outside.js'] }
      }),
      /traversal segment/
    );

    // Absolute path in writePaths
    assert.throws(
      () => createWorkspaceAdmission({
        ...validAdmissionParams,
        scope: { writePaths: ['/absolute/file.js'] }
      }),
      /Path is absolute/i
    );
  });

  describe('AuthorityEvaluator Root and Source Baseline Invariants', () => {
    const grantBase = {
      schemaVersion: SCHEMA_VERSIONS.GRANT,
      grantId: 'grant-test-01',
      principalId: 'worker-1',
      sessionId: 'sess-01',
      issuedAt: 1000,
      expiresAt: 5000000000000,
      revoked: false,
      issuerId: 'coordinator'
    };

    const admittedRoot = 'E:/Veyminore/products/zetro/sandboxes/ws-01';
    const baselineRoot = 'E:/Veyminore/products/zetro';

    it('requires explicit matching workspaceRoot on FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE', () => {
      const fileActionTypes = [
        ActionType.FILE_READ,
        ActionType.FILE_WRITE,
        ActionType.FILE_CREATE,
        ActionType.FILE_DELETE
      ];

      for (const actionType of fileActionTypes) {
        const grant = {
          ...grantBase,
          scope: {
            actionTypes: [actionType],
            allowedPaths: ['src/file.js'],
            workspaceRoot: admittedRoot,
            sourceBaselineRoot: baselineRoot
          }
        };

        // 1. Missing workspaceRoot fails closed
        const reqMissingRoot = createActionRequest({
          taskId: 'task-42',
          attemptId: 1,
          principalId: 'worker-1',
          sessionId: 'sess-01',
          actionType,
          parameters: {
            path: 'src/file.js'
          }
        });
        const evalMissing = evaluateAuthority(grant, reqMissingRoot);
        assert.equal(evalMissing.granted, false);
        assert.equal(evalMissing.reason, 'missing_workspace_root');

        // 2. Mismatched workspaceRoot fails closed
        const reqMismatchedRoot = createActionRequest({
          taskId: 'task-42',
          attemptId: 1,
          principalId: 'worker-1',
          sessionId: 'sess-01',
          actionType,
          parameters: {
            path: 'src/file.js',
            workspaceRoot: 'E:/other/workspace'
          }
        });
        const evalMismatch = evaluateAuthority(grant, reqMismatchedRoot);
        assert.equal(evalMismatch.granted, false);
        assert.equal(evalMismatch.reason, 'workspace_root_mismatch');

        // 3. WorkspaceRoot targeting source baseline fails closed
        const reqBaselineRoot = createActionRequest({
          taskId: 'task-42',
          attemptId: 1,
          principalId: 'worker-1',
          sessionId: 'sess-01',
          actionType,
          parameters: {
            path: 'src/file.js',
            workspaceRoot: baselineRoot
          }
        });
        const evalBaseline = evaluateAuthority(grant, reqBaselineRoot);
        assert.equal(evalBaseline.granted, false);
        assert.equal(evalBaseline.reason, 'source_baseline_mutation_denied');

        // 4. Correct admitted workspaceRoot passes
        const reqValid = createActionRequest({
          taskId: 'task-42',
          attemptId: 1,
          principalId: 'worker-1',
          sessionId: 'sess-01',
          actionType,
          parameters: {
            path: 'src/file.js',
            workspaceRoot: admittedRoot
          }
        });
        const evalValid = evaluateAuthority(grant, reqValid);
        assert.equal(evalValid.granted, true);
      }
    });

    it('requires explicit authorized cwd and denies source baseline execution on SHELL_EXEC', () => {
      const execGrant = {
        ...grantBase,
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedCommands: [['npm', 'test']],
          allowedPaths: [admittedRoot],
          exactArgs: true,
          exactCwd: true,
          workspaceRoot: admittedRoot,
          sourceBaselineRoot: baselineRoot
        }
      };

      // 1. Missing cwd fails closed
      const reqNoCwd = createActionRequest({
        taskId: 'task-42',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-01',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          workspaceRoot: admittedRoot
        }
      });
      const evalNoCwd = evaluateAuthority(execGrant, reqNoCwd);
      assert.equal(evalNoCwd.granted, false);
      assert.equal(evalNoCwd.reason, 'missing_shell_cwd');

      // 2. Cwd targeting source baseline fails closed
      const reqBaselineCwd = createActionRequest({
        taskId: 'task-42',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-01',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: baselineRoot,
          workspaceRoot: admittedRoot
        }
      });
      const evalBaselineCwd = evaluateAuthority(execGrant, reqBaselineCwd);
      assert.equal(evalBaselineCwd.granted, false);
      assert.equal(evalBaselineCwd.reason, 'source_baseline_execution_denied');

      // 3. WorkspaceRoot targeting source baseline on SHELL_EXEC fails closed
      const reqBaselineWorkspace = createActionRequest({
        taskId: 'task-42',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-01',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: admittedRoot,
          workspaceRoot: baselineRoot
        }
      });
      const evalBaselineWorkspace = evaluateAuthority(execGrant, reqBaselineWorkspace);
      assert.equal(evalBaselineWorkspace.granted, false);
      assert.equal(evalBaselineWorkspace.reason, 'source_baseline_execution_denied');

      // 4. Mismatched workspaceRoot fails closed
      const reqMismatchWorkspace = createActionRequest({
        taskId: 'task-42',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-01',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: admittedRoot,
          workspaceRoot: 'E:/other/root'
        }
      });
      const evalMismatchWorkspace = evaluateAuthority(execGrant, reqMismatchWorkspace);
      assert.equal(evalMismatchWorkspace.granted, false);
      assert.equal(evalMismatchWorkspace.reason, 'workspace_root_mismatch');

      // 5. Valid shell execution in admitted root passes
      const reqValidExec = createActionRequest({
        taskId: 'task-42',
        attemptId: 1,
        principalId: 'worker-1',
        sessionId: 'sess-01',
        actionType: ActionType.SHELL_EXEC,
        parameters: {
          command: ['npm', 'test'],
          cwd: admittedRoot,
          workspaceRoot: admittedRoot
        }
      });
      const evalValidExec = evaluateAuthority(execGrant, reqValidExec);
      assert.equal(evalValidExec.granted, true);
    });
  });
});
