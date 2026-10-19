/**
 * @file test/workspace-admission.test.js
 * Comprehensive integration tests for WorkspaceAdmission identity contract
 * in PolicyService and RctPolicyPort.
 *
 * Verifies:
 * 1. Admitted workspace identity contract consumption and validation.
 * 2. Canonical root and source baseline identity required on all effect requests
 *    (FILE_READ, FILE_WRITE, FILE_CREATE, FILE_DELETE, SHELL_EXEC).
 * 3. Fail-closed denial when actual workspace targets source baseline.
 * 4. Caller-context mutation resistance ("no mutable caller-context widening aftergrant"):
 *    mutating caller-provided assignment or workspace objects after grant issuance
 *    never widens authority or bypasses policy gates.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../src/policy-service.js';
import { RctPolicyPort } from '../src/ports/rct-port.js';
import {
  createWorkspaceAdmission,
  SCHEMA_VERSIONS,
  ActionType
} from '../../protocol/src/index.js';

describe('WorkspaceAdmission Policy Port Integration & Mutation Resistance', () => {
  let currentTime = 1700000000000;
  let policy;
  let rctPort;

  const canonicalAdmittedRoot = 'E:/Veyminore/products/zetro/sandboxes/attempt-01';
  const canonicalBaselineRoot = 'E:/Veyminore/products/zetro';

  const validAdmission = createWorkspaceAdmission({
    workspaceId: 'ws-attempt-01',
    taskId: 'task-sec-99',
    attemptId: 1,
    canonicalRoot: canonicalAdmittedRoot,
    sourceBaselineRoot: canonicalBaselineRoot,
    sourceBaselineHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    baselineCommit: '90db896ea4efd67cb7eb086fcf81b35a1e5e1291',
    scope: {
      readPaths: ['src/index.js', 'package.json'],
      writePaths: ['src/index.js'],
      createPaths: ['src/feature.js'],
      commands: [['npm', 'test']]
    }
  });

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy, {
      workspaceAdmission: validAdmission
    });
  });

  describe('Admitted Workspace Contract & Grant Issuance', () => {
    it('initializes port with immutable WorkspaceAdmission contract', () => {
      assert.equal(rctPort.admittedWorkspace.workspaceId, 'ws-attempt-01');
      assert.equal(rctPort.admittedWorkspaceRoot, canonicalAdmittedRoot);
      assert.equal(rctPort.admittedSourceBaselineRoot, canonicalBaselineRoot);
      assert.equal(Object.isFrozen(rctPort.admittedWorkspace), true);
    });

    it('attaches canonical root and source baseline to all issued grants', () => {
      const assignment = {
        id: 'task-sec-99',
        attemptId: 1,
        agent: 'RCT-1',
        sessionId: 'session-sec-99'
      };

      const grants = rctPort.createAssignmentGrants(assignment);
      assert.equal(grants.length >= 4, true);

      for (const grant of grants) {
        assert.equal(grant.scope.workspaceRoot, canonicalAdmittedRoot);
        assert.equal(grant.scope.sourceBaselineRoot, canonicalBaselineRoot);
      }
    });
  });

  describe('Canonical Root and Source Baseline Required on All Effect Requests', () => {
    let assignment;

    beforeEach(() => {
      assignment = {
        id: 'task-sec-99',
        attemptId: 1,
        agent: 'RCT-1',
        sessionId: 'session-sec-99',
        scope: {
          readPaths: ['src/index.js', 'package.json'],
          writePaths: ['src/index.js'],
          createPaths: ['src/feature.js'],
          commands: [['npm', 'test']]
        },
        checks: [
          { profile: 'test' }
        ]
      };
      rctPort.createAssignmentGrants(assignment);
    });

    it('enforces canonical root identity on FILE_READ and rejects substituted workspace', () => {
      // 1. Missing workspace.root fails closed
      const resMissing = rctPort.evaluateSync({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: {} }
      });
      assert.equal(resMissing.allowed, false);
      assert.equal(resMissing.reason, 'missing_workspace_root');

      // 2. Mismatched workspace.root fails closed
      const resMismatch = rctPort.evaluateSync({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: { root: 'E:/other/unknown' } }
      });
      assert.equal(resMismatch.allowed, false);
      assert.equal(resMismatch.reason, 'workspace_root_mismatch');

      // 3. Substituted baseline root under sandbox admission fails closed with workspace_root_mismatch
      const resBaseline = rctPort.evaluateSync({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: { root: canonicalBaselineRoot } }
      });
      assert.equal(resBaseline.allowed, false);
      assert.equal(resBaseline.reason, 'workspace_root_mismatch');

      // 4. Correct canonical admitted root succeeds
      const resValid = rctPort.evaluateSync({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: { root: canonicalAdmittedRoot } }
      });
      assert.equal(resValid.allowed, true);
    });

    it('enforces canonical root identity on FILE_WRITE and rejects substituted workspace', () => {
      // 1. Missing workspace.root
      const resMissing = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        assignment,
        context: { workspace: {} }
      });
      assert.equal(resMissing.allowed, false);
      assert.equal(resMissing.reason, 'missing_workspace_root');

      // 2. Mismatched workspace.root
      const resMismatch = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        assignment,
        context: { workspace: { root: 'E:/other/unknown' } }
      });
      assert.equal(resMismatch.allowed, false);
      assert.equal(resMismatch.reason, 'workspace_root_mismatch');

      // 3. Substituted baseline root under sandbox admission fails closed with workspace_root_mismatch
      const resBaseline = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        assignment,
        context: { workspace: { root: canonicalBaselineRoot } }
      });
      assert.equal(resBaseline.allowed, false);
      assert.equal(resBaseline.reason, 'workspace_root_mismatch');

      // 4. Correct canonical admitted root succeeds
      const resValid = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        assignment,
        context: { workspace: { root: canonicalAdmittedRoot } }
      });
      assert.equal(resValid.allowed, true);
    });

    it('enforces canonical root identity on FILE_CREATE and rejects substituted workspace', () => {
      // 1. Missing workspace.root
      const resMissing = rctPort.evaluateSync({
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/feature.js', content: '// new file' },
        assignment,
        context: { workspace: {} }
      });
      assert.equal(resMissing.allowed, false);
      assert.equal(resMissing.reason, 'missing_workspace_root');

      // 2. Mismatched workspace.root
      const resMismatch = rctPort.evaluateSync({
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/feature.js', content: '// new file' },
        assignment,
        context: { workspace: { root: 'E:/other/unknown' } }
      });
      assert.equal(resMismatch.allowed, false);
      assert.equal(resMismatch.reason, 'workspace_root_mismatch');

      // 3. Substituted baseline root under sandbox admission fails closed with workspace_root_mismatch
      const resBaseline = rctPort.evaluateSync({
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/feature.js', content: '// new file' },
        assignment,
        context: { workspace: { root: canonicalBaselineRoot } }
      });
      assert.equal(resBaseline.allowed, false);
      assert.equal(resBaseline.reason, 'workspace_root_mismatch');

      // 4. Correct canonical admitted root succeeds
      const resValid = rctPort.evaluateSync({
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/feature.js', content: '// new file' },
        assignment,
        context: { workspace: { root: canonicalAdmittedRoot } }
      });
      assert.equal(resValid.allowed, true);
    });

    it('enforces canonical root identity on FILE_DELETE and rejects substituted workspace', () => {
      // 1. Missing workspace.root
      const resMissing = rctPort.evaluateSync({
        tool: 'delete_file',
        effect: 'delete',
        capability: 'file:delete',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: {} }
      });
      assert.equal(resMissing.allowed, false);
      assert.equal(resMissing.reason, 'missing_workspace_root');

      // 2. Mismatched workspace.root
      const resMismatch = rctPort.evaluateSync({
        tool: 'delete_file',
        effect: 'delete',
        capability: 'file:delete',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: { root: 'E:/other/unknown' } }
      });
      assert.equal(resMismatch.allowed, false);
      assert.equal(resMismatch.reason, 'workspace_root_mismatch');

      // 3. Substituted baseline root under sandbox admission fails closed with workspace_root_mismatch
      const resBaseline = rctPort.evaluateSync({
        tool: 'delete_file',
        effect: 'delete',
        capability: 'file:delete',
        args: { path: 'src/index.js' },
        assignment,
        context: { workspace: { root: canonicalBaselineRoot } }
      });
      assert.equal(resBaseline.allowed, false);
      assert.equal(resBaseline.reason, 'workspace_root_mismatch');
    });

    it('fails closed with source_baseline_mutation_denied when mutating action targets admitted baseline', () => {
      // Admitting directly on baseline repository (e.g. read-only auditor)
      const baselineAdmission = createWorkspaceAdmission({
        workspaceId: 'ws-baseline-read',
        taskId: 'task-sec-99',
        attemptId: 1,
        canonicalRoot: canonicalBaselineRoot,
        sourceBaselineRoot: canonicalBaselineRoot,
        sourceBaselineHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        scope: {
          readPaths: ['src/index.js'],
          writePaths: [],
          createPaths: [],
          commands: [['npm', 'test']]
        }
      });
      const baselinePolicy = new PolicyService({ clock: () => currentTime });
      const baselinePort = new RctPolicyPort(baselinePolicy, {
        workspaceAdmission: baselineAdmission
      });
      baselinePort.createAssignmentGrants({
        id: 'task-sec-99',
        attemptId: 1,
        agent: 'RCT-1',
        sessionId: 'session-sec-99'
      });

      const writeRes = baselinePort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        workspace: { root: canonicalBaselineRoot }
      });
      assert.equal(writeRes.allowed, false);
      assert.equal(writeRes.reason, 'source_baseline_mutation_denied');

      const createRes = baselinePort.evaluateSync({
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/feature.js', content: 'test' },
        workspace: { root: canonicalBaselineRoot }
      });
      assert.equal(createRes.allowed, false);
      assert.equal(createRes.reason, 'source_baseline_mutation_denied');

      const deleteRes = baselinePort.evaluateSync({
        tool: 'delete_file',
        effect: 'delete',
        capability: 'file:delete',
        args: { path: 'src/index.js' },
        workspace: { root: canonicalBaselineRoot }
      });
      assert.equal(deleteRes.allowed, false);
      assert.equal(deleteRes.reason, 'source_baseline_mutation_denied');
    });

    it('enforces canonical root identity on SHELL_EXEC and rejects source baseline execution', () => {
      // 1. Shell execution executed in source baseline fails closed with source_baseline_execution_denied
      const resBaseline = rctPort.evaluateSync({
        tool: 'run_check',
        effect: 'execute',
        capability: 'check:execute',
        args: { command: ['npm', 'test'], cwd: canonicalBaselineRoot },
        assignment,
        context: { workspace: { root: canonicalBaselineRoot } }
      });
      assert.equal(resBaseline.allowed, false);
      assert.equal(resBaseline.reason, 'source_baseline_execution_denied');

      // 2. Shell execution with substituted workspace.root fails closed with workspace_root_mismatch
      const resMismatch = rctPort.evaluateSync({
        tool: 'run_check',
        effect: 'execute',
        capability: 'check:execute',
        args: { command: ['npm', 'test'], cwd: canonicalAdmittedRoot },
        assignment,
        context: { workspace: { root: 'E:/other/unknown' } }
      });
      assert.equal(resMismatch.allowed, false);
      assert.equal(resMismatch.reason, 'workspace_root_mismatch');

      // 3. Shell execution with unauthorized cwd fails closed with cwd_outside_grant_scope
      const resCwdOutside = rctPort.evaluateSync({
        tool: 'run_check',
        effect: 'execute',
        capability: 'check:execute',
        args: { command: ['npm', 'test'], cwd: 'E:/other/unknown' },
        assignment,
        context: { workspace: { root: canonicalAdmittedRoot } }
      });
      assert.equal(resCwdOutside.allowed, false);
      assert.equal(resCwdOutside.reason, 'cwd_outside_grant_scope');

      // 4. Shell execution in admitted workspace root succeeds
      const resValid = rctPort.evaluateSync({
        tool: 'run_check',
        effect: 'execute',
        capability: 'check:execute',
        args: { command: ['npm', 'test'], cwd: canonicalAdmittedRoot },
        assignment,
        context: { workspace: { root: canonicalAdmittedRoot } }
      });
      assert.equal(resValid.allowed, true);
    });
  });

  describe('Caller-Context Mutation Resistance ("No Mutable Caller-Context Widening Aftergrant")', () => {
    let mutableAssignment;
    let mutableWorkspace;

    beforeEach(() => {
      mutableAssignment = {
        id: 'task-sec-99',
        attemptId: 1,
        agent: 'RCT-1',
        sessionId: 'session-sec-99',
        scope: {
          root: canonicalAdmittedRoot,
          sourceRoot: canonicalBaselineRoot,
          readPaths: ['src/index.js'],
          writePaths: ['src/index.js'],
          createPaths: [],
          commands: [['npm', 'test']]
        }
      };

      mutableWorkspace = {
        root: canonicalAdmittedRoot
      };

      // Grants issued from initial context
      rctPort.createAssignmentGrants(mutableAssignment);
    });

    it('prevents authority widening when caller mutates assignment.scope.writePaths after grant', () => {
      // Caller attempts to widen write authority by modifying assignment in memory
      mutableAssignment.scope.writePaths.push('secret/config.json');
      mutableAssignment.scope.writePaths.push('other/private.key');

      // Attempt write to the newly pushed unauthorized path
      const res = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'secret/config.json', content: 'hacked' },
        assignment: mutableAssignment,
        context: { workspace: mutableWorkspace }
      });

      // Evaluation fails closed against stored immutable Grant in PolicyService
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'path_outside_grant_scope');
    });

    it('prevents authority widening when caller mutates assignment.scope.readPaths after grant', () => {
      // Caller attempts to widen read authority by modifying assignment in memory
      mutableAssignment.scope.readPaths.push('env/secret_key.txt');

      const res = rctPort.evaluateSync({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'env/secret_key.txt' },
        assignment: mutableAssignment,
        context: { workspace: mutableWorkspace }
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'path_outside_grant_scope');
    });

    it('prevents policy bypass when caller mutates assignment.scope.root after grant', () => {
      // Caller attempts to mutate assignment root to an unauthorized path
      mutableAssignment.scope.root = 'E:/malicious/escape';
      mutableWorkspace.root = 'E:/malicious/escape';

      const res = rctPort.evaluateSync({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/index.js', content: 'test content' },
        assignment: mutableAssignment,
        context: { workspace: mutableWorkspace }
      });

      // Port maintains binding to admitted workspace root; rejects caller's escaped root
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'workspace_root_mismatch');
      assert.equal(res.details.expected, canonicalAdmittedRoot);
      assert.equal(res.details.actual, 'E:/malicious/escape');
    });

    it('prevents command execution widening when caller mutates assignment.scope.commands after grant', () => {
      // Caller attempts to inject a destructive command after grant
      mutableAssignment.scope.commands.push(['rm', '-rf', '/']);

      const res = rctPort.evaluateSync({
        tool: 'check_command',
        effect: 'execute',
        capability: 'check:execute',
        args: { command: ['rm', '-rf', '/'] },
        assignment: mutableAssignment,
        context: { workspace: mutableWorkspace }
      });

      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'command_not_permitted');
    });

    it('resists direct mutation of admittedWorkspace object', () => {
      // Deep freeze prevents mutating admittedWorkspace properties
      assert.throws(() => {
        rctPort.admittedWorkspace.canonicalRoot = 'E:/malicious/escape';
      }, TypeError);

      assert.throws(() => {
        rctPort.admittedWorkspace.sourceBaselineRoot = 'E:/malicious/escape';
      }, TypeError);

      assert.throws(() => {
        rctPort.admittedWorkspace.scope.writePaths.push('secret/file.js');
      }, TypeError);
    });
  });
});
