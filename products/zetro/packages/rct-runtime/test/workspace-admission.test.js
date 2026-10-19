/**
 * @file test/workspace-admission.test.js
 * Comprehensive integration tests for consuming WorkspaceAdmission protocol contract
 * in @zetro/rct-runtime using trusted execution identity and injected policy port.
 *
 * Verifies:
 * 1. Authoritative trusted execution identity binding & stale attempt denial (0 provider calls, 0 effects).
 * 2. Wrong root / sourceBaseline rejection (canonicalRoot, sourceBaselineRoot, taskId).
 * 3. Stale / altered admission rejection (admissionDigest tampering, sourceBaselineHash mismatch).
 * 4. Mutable caller context cannot widen file or command grants.
 * 5. Symlink / junction escape denied (fail-closed before read/write).
 * 6. Baseline cannot be mutated or affected (zero baseline mutation, byte-identical baseline).
 * 7. Injected PolicyPort (RctPolicyPort) integration and identity binding on receipts.
 * 8. Legacy non-admission execution path compatibility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runAssignment,
  ScopedWorkspace,
  ToolRegistry,
  AuthorityPort,
  createDefaultRegistry,
  validateWorkspaceAdmission,
  createWorkspaceAdmission,
  validateExecutionIdentity,
  sha256
} from '../src/index.js';
import { PolicyService, RctPolicyPort } from '../../policy/src/index.js';

class FakeStepProvider {
  constructor(steps = []) {
    this.name = 'fake';
    this.steps = [...steps];
    this.calls = 0;
  }
  async next() {
    this.calls++;
    const step = this.steps.shift();
    if (!step) {
      return { toolCalls: [{ name: 'submit_receipt', args: { summary: 'completed' } }] };
    }
    return step;
  }
}

async function withTempFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zetro-admission-test-'));
  const sourceRoot = path.join(root, 'source');
  const snapshotRoot = path.join(root, 'snapshot');
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await mkdir(path.join(snapshotRoot, 'src'), { recursive: true });

  await writeFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'hello\n');
  await writeFile(path.join(sourceRoot, 'src', 'secret.txt'), 'confidential-baseline-data\n');
  await writeFile(path.join(snapshotRoot, 'src', 'greeting.txt'), 'hello\n');

  try {
    return await fn({ root, sourceRoot, snapshotRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function getDirectoryFileHashes(dir) {
  const hashes = {};
  async function scan(currentDir, rel = '') {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, entryRel);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        hashes[entryRel] = sha256(content);
      }
    }
  }
  await scan(dir);
  return hashes;
}

function normalizePathForProtocol(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

describe('WorkspaceAdmission Protocol Consumption & Policy Port Invariants (W6-AGR2)', () => {

  describe('1. Authoritative Trusted Execution Identity Binding & Stale Attempt Denial', () => {
    it('rejects missing trusted executionIdentity when WorkspaceAdmission is supplied (0 provider calls, 0 effects)', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-ident-test',
        taskId: 'task-ident-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-ident-1',
        objective: 'Test missing identity',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider();

      await assert.rejects(
        runAssignment(assignment, provider, snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission
          // executionIdentity intentionally omitted!
        }),
        /Missing trusted executionIdentity/
      );

      // Verify zero provider calls and zero side effects
      assert.equal(provider.calls, 0);
    }));

    it('rejects stale prior attempt with 0 provider calls and 0 effects', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-stale-test',
        taskId: 'task-stale-1',
        attemptId: 1, // admitted attempt 1
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-stale-1',
        objective: 'Test stale attempt rejection',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider();

      // Current execution is attempt 2, but admission was issued for stale attempt 1
      await assert.rejects(
        runAssignment(assignment, provider, snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-stale-1',
            attemptId: 2, // mismatch!
            workspaceId: 'ws-stale-test'
          }
        }),
        /Execution identity attemptId mismatch \(stale attempt rejection\)/
      );

      // Verify provider was never invoked (0 calls)
      assert.equal(provider.calls, 0);
    }));

    it('rejects executionIdentity workspaceId mismatch with 0 provider calls', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-expected-id',
        taskId: 'task-ws-mismatch',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-ws-mismatch',
        objective: 'Test workspaceId mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider();

      await assert.rejects(
        runAssignment(assignment, provider, snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-ws-mismatch',
            attemptId: 1,
            workspaceId: 'ws-wrong-substituted' // mismatch!
          }
        }),
        /Execution identity workspaceId mismatch/
      );

      assert.equal(provider.calls, 0);
    }));

    it('rejects executionIdentity taskId mismatch with 0 provider calls', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-task-test',
        taskId: 'task-expected-id',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-expected-id',
        objective: 'Test taskId mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider();

      await assert.rejects(
        runAssignment(assignment, provider, snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-wrong-identity',
            attemptId: 1,
            workspaceId: 'ws-task-test'
          }
        }),
        /Execution identity taskId mismatch/
      );

      assert.equal(provider.calls, 0);
    }));

    it('positive exact match: authorizes and binds executionIdentity on receipt', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-exact-match',
        taskId: 'task-exact-1',
        attemptId: 3,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-exact-1',
        objective: 'Test positive exact match',
        acceptance: 'Greeting says hello world',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Completed' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: admission,
        executionIdentity: {
          taskId: 'task-exact-1',
          attemptId: 3,
          workspaceId: 'ws-exact-match'
        }
      });

      assert.equal(receipt.state, 'review_ready');
      assert.equal(receipt.executionIdentity.taskId, 'task-exact-1');
      assert.equal(receipt.executionIdentity.attemptId, 3);
      assert.equal(receipt.executionIdentity.workspaceId, 'ws-exact-match');
      assert.equal(receipt.workspaceAdmission.taskId, 'task-exact-1');
      assert.equal(receipt.workspaceAdmission.attemptId, 3);
      assert.equal(receipt.workspaceAdmission.workspaceId, 'ws-exact-match');
    }));

    it('shorthand identity options (options.attemptId, options.workspaceId, options.taskId) are accepted', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-shorthand',
        taskId: 'task-short-1',
        attemptId: 5,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-short-1',
        objective: 'Test shorthand identity',
        acceptance: 'Greeting says hello world',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Completed' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: admission,
        taskId: 'task-short-1',
        attemptId: 5,
        workspaceId: 'ws-shorthand'
      });

      assert.equal(receipt.state, 'review_ready');
      assert.equal(receipt.executionIdentity.attemptId, 5);
      assert.equal(receipt.executionIdentity.workspaceId, 'ws-shorthand');
    }));

    it('legacy non-admission execution path does not require executionIdentity', () => withTempFixture(async ({ snapshotRoot }) => {
      const assignment = {
        taskId: 'task-legacy-1',
        objective: 'Test legacy execution',
        acceptance: 'Greeting says hello world',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Completed' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true
      });

      assert.equal(receipt.state, 'review_ready');
      assert.equal(receipt.diffOutcome, 'applied');
    }));
  });

  describe('2. Wrong root / sourceBaseline rejection', () => {
    it('rejects when isolatedRoot does not match admission.canonicalRoot', () => withTempFixture(async ({ root, sourceRoot, snapshotRoot }) => {
      const wrongSnapshotRoot = path.join(root, 'other-snapshot');
      await mkdir(wrongSnapshotRoot, { recursive: true });

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-root-test',
        taskId: 'task-root-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-root-1',
        objective: 'Test root mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), wrongSnapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-root-1',
            attemptId: 1,
            workspaceId: 'ws-root-test'
          }
        }),
        /Workspace admission canonicalRoot mismatch/
      );
    }));

    it('rejects when options.sourceRoot does not match admission.sourceBaselineRoot', () => withTempFixture(async ({ root, sourceRoot, snapshotRoot }) => {
      const wrongSourceRoot = path.join(root, 'other-source');
      await mkdir(wrongSourceRoot, { recursive: true });

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-source-test',
        taskId: 'task-source-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-source-1',
        objective: 'Test source baseline mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot: wrongSourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-source-1',
            attemptId: 1,
            workspaceId: 'ws-source-test'
          }
        }),
        /Workspace admission sourceBaselineRoot mismatch/
      );
    }));

    it('rejects when canonicalRoot equals sourceBaselineRoot (mutating worker cannot run in baseline)', () => withTempFixture(async ({ sourceRoot }) => {
      assert.throws(
        () => createWorkspaceAdmission({
          workspaceId: 'ws-same-root',
          taskId: 'task-same-root',
          attemptId: 1,
          canonicalRoot: normalizePathForProtocol(sourceRoot),
          sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
          scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            commands: ['test']
          }
        }),
        /canonicalRoot must not equal sourceBaselineRoot/
      );
    }));

    it('rejects when assignment.id / taskId does not match admission.taskId', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-task-mismatch',
        taskId: 'task-declared-id',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-different-id',
        objective: 'Test taskId mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-declared-id',
            attemptId: 1,
            workspaceId: 'ws-task-mismatch'
          }
        }),
        /Execution identity taskId mismatch/
      );
    }));
  });

  describe('3. Stale / altered admission rejection', () => {
    it('rejects when admission cryptographic digest is tampered with (verifyDigest)', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-tamper-test',
        taskId: 'task-tamper-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      // Clone and tamper with fields while retaining original admissionDigest
      const tamperedAdmission = {
        ...admission,
        taskId: 'task-tamper-altered'
      };

      const assignment = {
        taskId: 'task-tamper-altered',
        objective: 'Test tampered admission digest',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: tamperedAdmission,
          executionIdentity: {
            taskId: 'task-tamper-altered',
            attemptId: 1,
            workspaceId: 'ws-tamper-test'
          }
        }),
        /admissionDigest mismatch/
      );
    }));

    it('rejects when options.sourceBaselineHash mismatches admission.sourceBaselineHash', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const validHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-hash-test',
        taskId: 'task-hash-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        sourceBaselineHash: validHash,
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-hash-1',
        objective: 'Test source baseline hash mismatch',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot,
          sourceBaselineHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-hash-1',
            attemptId: 1,
            workspaceId: 'ws-hash-test'
          }
        }),
        /Workspace admission sourceBaselineHash mismatch/
      );
    }));

    it('rejects when assignment attempts paths outside admitted scope', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-scope-test',
        taskId: 'task-scope-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-scope-1',
        objective: 'Test scope overflow in assignment',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt', 'src/secret.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-scope-1',
            attemptId: 1,
            workspaceId: 'ws-scope-test'
          }
        }),
        /Assignment path 'src\/secret.txt' is outside workspace admission scope/
      );
    }));

    it('rejects when assignment writePaths exceed admitted write scope', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-write-scope-test',
        taskId: 'task-write-scope-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt', 'src/secret.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-write-scope-1',
        objective: 'Test unauthorized write in assignment scope',
        acceptance: 'Greeting updated',
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt', 'src/secret.txt']
        },
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      await assert.rejects(
        runAssignment(assignment, new FakeStepProvider(), snapshotRoot, {
          isolated: true,
          sourceRoot,
          workspaceAdmission: admission,
          executionIdentity: {
            taskId: 'task-write-scope-1',
            attemptId: 1,
            workspaceId: 'ws-write-scope-test'
          }
        }),
        /Assignment write path 'src\/secret.txt' is outside workspace admission write scope/
      );
    }));
  });

  describe('4. Mutable caller context cannot widen file or command grants', () => {
    it('caller mutating admission object after admission cannot access newly pushed read paths', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const callerAdmission = {
        schemaVersion: 'zetro.protocol.workspace_admission.v1',
        workspaceId: 'ws-mutation-test',
        taskId: 'task-mut-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      };

      const assignment = {
        taskId: 'task-mut-1',
        objective: 'Test caller context mutation widening defense',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'read_slice',
            args: { path: 'src/secret.txt', start: 0, length: 100 }
          }]
        }
      ]);

      const runPromise = runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: callerAdmission,
        executionIdentity: {
          taskId: 'task-mut-1',
          attemptId: 1,
          workspaceId: 'ws-mutation-test'
        }
      });

      // Caller mutates their local arrays
      callerAdmission.scope.readPaths.push('src/secret.txt');
      callerAdmission.scope.commands.push('evil_command');

      const receipt = await runPromise;
      const readEvent = receipt.events.find(e => e.tool === 'read_slice');
      assert.equal(readEvent.ok, false);
      assert.match(readEvent.error, /outside assignment scope|Path outside|path_outside_read_scope/i);
    }));

    it('caller mutating rawAssignment.allowedPaths after start cannot widen access', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-assign-mut',
        taskId: 'task-assign-mut-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const rawAssignment = {
        taskId: 'task-assign-mut-1',
        objective: 'Test rawAssignment mutation',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'read_slice',
            args: { path: 'src/secret.txt', start: 0, length: 100 }
          }]
        }
      ]);

      const runPromise = runAssignment(rawAssignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: admission,
        executionIdentity: {
          taskId: 'task-assign-mut-1',
          attemptId: 1,
          workspaceId: 'ws-assign-mut'
        }
      });

      rawAssignment.allowedPaths.push('src/secret.txt');

      const receipt = await runPromise;
      const readEvent = receipt.events.find(e => e.tool === 'read_slice');
      assert.equal(readEvent.ok, false);
      assert.match(readEvent.error, /outside assignment scope|Path outside|path_outside_read_scope/i);
    }));

    it('caller pushing unadmitted command cannot execute check_command profile', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const callerAdmission = {
        schemaVersion: 'zetro.protocol.workspace_admission.v1',
        workspaceId: 'ws-cmd-mut',
        taskId: 'task-cmd-mut-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test'] // only test profile admitted
        }
      };

      const assignment = {
        taskId: 'task-cmd-mut-1',
        objective: 'Test unadmitted command execution',
        acceptance: 'Greeting updated',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'check_command',
            args: { profile: 'lint', path: 'src/greeting.txt' }
          }]
        }
      ]);

      const runPromise = runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        enableExtensions: true,
        workspaceAdmission: callerAdmission,
        executionIdentity: {
          taskId: 'task-cmd-mut-1',
          attemptId: 1,
          workspaceId: 'ws-cmd-mut'
        }
      });

      callerAdmission.scope.commands.push('lint');

      const receipt = await runPromise;
      const cmdEvent = receipt.events.find(e => e.tool === 'check_command');
      assert.equal(cmdEvent.ok, false);
      assert.match(cmdEvent.error, /not in admitted workspace commands|command_not_permitted/i);
    }));

    it('direct mutation attempt on ScopedWorkspace.allowed or writePaths throws', () => withTempFixture(async ({ snapshotRoot }) => {
      const workspace = new ScopedWorkspace(snapshotRoot, ['src/greeting.txt']);
      assert.throws(() => {
        workspace.allowed.add('src/secret.txt');
      }, /Cannot mutate frozen Set/);

      assert.throws(() => {
        workspace.writePaths.add('src/secret.txt');
      }, /Cannot mutate frozen Set/);
    }));

    it('ToolRegistry authority check fails closed when tool targets path outside frozen admission scope', async () => {
      const registry = createDefaultRegistry();
      const frozenAdmission = createWorkspaceAdmission({
        workspaceId: 'ws-reg-test',
        taskId: 'task-reg-1',
        attemptId: 1,
        canonicalRoot: 'E:/sandboxes/snap-1',
        sourceBaselineRoot: 'E:/source/repo',
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const auth = new AuthorityPort(null, { workspaceAdmission: frozenAdmission });
      const decision = await auth.evaluate({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/secret.txt' },
        workspace: { root: 'E:/sandboxes/snap-1' }
      });

      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, 'path_outside_read_scope');
    });
  });

  describe('5. Symlink / junction escape denied', () => {
    it('reading through directory junction escaping to source baseline is denied', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const junctionPath = path.join(snapshotRoot, 'junc_to_source');
      try {
        await symlink(sourceRoot, junctionPath, 'junction');
      } catch (err) {
        if (process.platform === 'win32' && err.code === 'EPERM') return;
        throw err;
      }

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-junc-test',
        taskId: 'task-junc-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const workspace = new ScopedWorkspace(snapshotRoot, ['src/greeting.txt'], {}, {
        admission,
        sourceBaselineRoot: sourceRoot
      });

      await assert.rejects(
        workspace.resolveFile('junc_to_source/src/secret.txt'),
        /Path outside assignment scope|Symbolic links are not allowed|Path escaped workspace|Baseline escape denied/
      );
    }));

    it('writing through directory junction escaping to source baseline is denied', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const junctionPath = path.join(snapshotRoot, 'junc_write');
      try {
        await symlink(sourceRoot, junctionPath, 'junction');
      } catch (err) {
        if (process.platform === 'win32' && err.code === 'EPERM') return;
        throw err;
      }

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-junc-write-test',
        taskId: 'task-junc-write-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const workspace = new ScopedWorkspace(snapshotRoot, ['src/greeting.txt'], {}, {
        admission,
        sourceBaselineRoot: sourceRoot
      });

      await assert.rejects(
        workspace.proposePatch('junc_write/src/secret.txt', sha256('confidential-baseline-data\n'), 'hacked\n'),
        /Path outside assignment scope|Path not in write scope|Symbolic links are not allowed|Path escaped workspace|Baseline escape denied/
      );
    }));

    it('path traversal escape attempting to reach source baseline is denied', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-trav-test',
        taskId: 'task-trav-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const workspace = new ScopedWorkspace(snapshotRoot, ['src/greeting.txt'], {}, {
        admission,
        sourceBaselineRoot: sourceRoot
      });

      await assert.rejects(
        workspace.resolveFile('../source/src/secret.txt'),
        /Invalid relative path|Path outside assignment scope|Path escaped workspace/
      );
    }));
  });

  describe('6. Baseline cannot be mutated or affected (zero baseline mutation)', () => {
    it('successful runAssignment in snapshot leaves source baseline 100% byte-identical', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const initialBaselineHashes = await getDirectoryFileHashes(sourceRoot);

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-clean-run',
        taskId: 'task-clean-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-clean-1',
        objective: 'Update greeting in isolated snapshot',
        acceptance: 'Greeting says hello world',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Applied greeting patch' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: admission,
        executionIdentity: {
          taskId: 'task-clean-1',
          attemptId: 1,
          workspaceId: 'ws-clean-run'
        }
      });

      assert.equal(receipt.state, 'review_ready');
      assert.equal(receipt.diffOutcome, 'applied');

      const snapshotGreeting = await readFile(path.join(snapshotRoot, 'src', 'greeting.txt'), 'utf8');
      assert.equal(snapshotGreeting, 'hello world\n');

      const finalBaselineHashes = await getDirectoryFileHashes(sourceRoot);
      assert.deepEqual(finalBaselineHashes, initialBaselineHashes);

      const sourceGreeting = await readFile(path.join(sourceRoot, 'src', 'greeting.txt'), 'utf8');
      assert.equal(sourceGreeting, 'hello\n');

      const sourceSecret = await readFile(path.join(sourceRoot, 'src', 'secret.txt'), 'utf8');
      assert.equal(sourceSecret, 'confidential-baseline-data\n');
    }));

    it('failing worker and errors leave source baseline 100% byte-identical', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const initialBaselineHashes = await getDirectoryFileHashes(sourceRoot);

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-fail-run',
        taskId: 'task-fail-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const assignment = {
        taskId: 'task-fail-1',
        objective: 'Failing worker task',
        acceptance: 'Requires matching text',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'unmatched check' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'partially modified\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Claimed completion' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        workspaceAdmission: admission,
        executionIdentity: {
          taskId: 'task-fail-1',
          attemptId: 1,
          workspaceId: 'ws-fail-run'
        }
      });

      assert.notEqual(receipt.state, 'review_ready');
      assert.ok(['failed', 'budget_exhausted'].includes(receipt.state));

      const finalBaselineHashes = await getDirectoryFileHashes(sourceRoot);
      assert.deepEqual(finalBaselineHashes, initialBaselineHashes);
    }));
  });

  describe('7. Injected PolicyPort (RctPolicyPort) Integration', () => {
    it('authorizes permitted tools and binds WorkspaceAdmission identity on receipt and reviewPatch', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const initialBaselineHashes = await getDirectoryFileHashes(sourceRoot);

      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-policy-port-1',
        taskId: 'task-policy-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        sourceBaselineHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        baselineCommit: '90db896ea4efd67cb7eb086fcf81b35a1e5e1291',
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const policyService = new PolicyService({ clock: () => 1700000000000 });
      const policyPort = new RctPolicyPort(policyService, {
        workspaceAdmission: admission
      });

      const assignment = {
        taskId: 'task-policy-1',
        objective: 'Update greeting with policy port authorization',
        acceptance: 'Greeting says hello world',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
      };

      const provider = new FakeStepProvider([
        {
          toolCalls: [{
            name: 'read_slice',
            args: { path: 'src/greeting.txt', start: 0, length: 100 }
          }]
        },
        {
          toolCalls: [{
            name: 'propose_patch',
            args: {
              path: 'src/greeting.txt',
              expectedSha256: sha256('hello\n'),
              content: 'hello world\n'
            }
          }]
        },
        {
          toolCalls: [{
            name: 'submit_receipt',
            args: { summary: 'Updated greeting with policy port' }
          }]
        }
      ]);

      const receipt = await runAssignment(assignment, provider, snapshotRoot, {
        isolated: true,
        sourceRoot,
        policyPort,
        workspaceAdmission: admission,
        executionIdentity: {
          taskId: 'task-policy-1',
          attemptId: 1,
          workspaceId: 'ws-policy-port-1'
        }
      });

      assert.equal(receipt.state, 'review_ready');
      assert.equal(receipt.diffOutcome, 'applied');
      assert.equal(receipt.workspaceAdmission.workspaceId, 'ws-policy-port-1');
      assert.equal(receipt.workspaceAdmission.taskId, 'task-policy-1');
      assert.equal(receipt.workspaceAdmission.attemptId, 1);
      assert.equal(receipt.workspaceAdmission.canonicalRoot, normalizePathForProtocol(snapshotRoot));
      assert.equal(receipt.workspaceAdmission.sourceBaselineRoot, normalizePathForProtocol(sourceRoot));
      assert.equal(typeof receipt.workspaceAdmission.admissionDigest, 'string');

      assert.ok(receipt.reviewPatch);
      assert.equal(receipt.reviewPatch.task.id, 'task-policy-1');
      assert.equal(receipt.reviewPatch.changes.length, 1);
      assert.equal(receipt.reviewPatch.changes[0].path, 'src/greeting.txt');

      const finalBaselineHashes = await getDirectoryFileHashes(sourceRoot);
      assert.deepEqual(finalBaselineHashes, initialBaselineHashes);
    }));

    it('injected RctPolicyPort denies execution when actual workspace targets source baseline', () => withTempFixture(async ({ sourceRoot, snapshotRoot }) => {
      const admission = createWorkspaceAdmission({
        workspaceId: 'ws-baseline-deny-test',
        taskId: 'task-base-deny-1',
        attemptId: 1,
        canonicalRoot: normalizePathForProtocol(snapshotRoot),
        sourceBaselineRoot: normalizePathForProtocol(sourceRoot),
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          commands: ['test']
        }
      });

      const policyService = new PolicyService({ clock: () => 1700000000000 });
      const policyPort = new RctPolicyPort(policyService, {
        workspaceAdmission: admission
      });

      const decision = policyPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hack\n' },
        assignment: { id: 'task-base-deny-1', attemptId: 1 },
        context: { workspace: { root: sourceRoot } }
      });

      assert.equal(decision.allowed, false);
      assert.ok(['source_baseline_mutation_denied', 'workspace_root_mismatch'].includes(decision.reason));

      const auth = new AuthorityPort(null, { workspaceAdmission: admission });
      const authDecision = await auth.evaluate({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/greeting.txt' },
        workspace: { root: sourceRoot }
      });
      assert.equal(authDecision.allowed, false);
      assert.equal(authDecision.reason, 'source_baseline_mutation_denied');
    }));
  });
});
