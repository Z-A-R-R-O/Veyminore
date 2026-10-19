/**
 * @file test/rct-conformance.test.js
 * Policy-to-RCT ToolRegistry Integration Conformance Suite (W3-AGR1).
 *
 * Imports actual RCT runtime exports:
 * - AuthorityPort, ToolRegistry, createDefaultRegistry, EFFECTS, CAPABILITIES, CHECK_COMMAND_PROFILES
 * - ScopedWorkspace, cleanRelative, sha256
 *
 * Proves:
 * 1. Exact read/write/create/command capabilities and explicit cwd flow through real AuthorityPort.
 * 2. Denied handlers are NEVER invoked (zero calls to workspace or subprocess handlers upon denial).
 * 3. Expiry and revocation between admission and effect time fail closed.
 * 4. Changed arguments, parameter tampering, and unauthorized/descendant cwd are denied.
 * 5. Uses synthetic temp workspace on disk and injected mock subprocess (zero live provider/external calls).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { PolicyService } from '../src/policy-service.js';
import { RctPolicyPort } from '../src/ports/rct-port.js';
import {
  AuthorityPort,
  ToolRegistry,
  createDefaultRegistry,
  EFFECTS,
  CAPABILITIES,
  CHECK_COMMAND_PROFILES
} from '../../rct-runtime/src/tool-registry.js';
import { ScopedWorkspace, sha256 } from '../../rct-runtime/src/workspace.js';
import { ActionType, SCHEMA_VERSIONS, createActionRequest } from '../../protocol/src/index.js';

describe('RCT Runtime & Policy Conformance Integration Suite (W3-AGR1 / W4-AGR1)', () => {
  let tempDir;
  let sourceDir;
  let currentTime;
  let policy;
  let rctPort;
  let authorityPort;
  let registry;
  let rawWorkspace;
  let spiedWorkspace;
  let mockExecFile;
  let handlerInvocations;
  let lastExecution = null;

  let conformanceAssignment;

  beforeEach(async () => {
    currentTime = 1700000000000;
    lastExecution = null;
    handlerInvocations = {
      readSlice: 0,
      proposePatch: 0,
      search: 0,
      listPaths: 0,
      execFile: 0,
      verify: 0
    };

    // 1. Create temporary synthetic workspace snapshot and baseline source repository on disk
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zetro-rct-conf-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'docs'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'test'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'secrets'), { recursive: true });

    await fs.writeFile(path.join(tempDir, 'src/index.js'), 'export const version = "1.0.0";\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'src/app.js'), 'export function run() { return 42; }\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'docs/guide.md'), '# Developer Guide\nRead only doc.\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'test/safe.test.js'), '// safe test\n', 'utf8');
    await fs.writeFile(path.join(tempDir, 'secrets/creds.json'), '{"apiKey":"sensitive-value"}\n', 'utf8');

    // Create baseline source repository to verify snapshot vs source distinction
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zetro-rct-source-'));
    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src/app.js'), 'export function run() { return 42; }\n', 'utf8');
    await fs.writeFile(path.join(sourceDir, 'docs/guide.md'), '# Developer Guide\nRead only doc.\n', 'utf8');

    // 2. Real ScopedWorkspace from rct-runtime (pointing to isolated snapshot)
    rawWorkspace = new ScopedWorkspace(tempDir, {
      readPaths: ['src/index.js', 'src/app.js', 'docs/guide.md', 'test/safe.test.js'],
      writePaths: ['src/index.js', 'src/app.js']
    });

    // 3. Spy on workspace methods to verify handler invocation invariants
    spiedWorkspace = {
      root: rawWorkspace.root,
      allowed: rawWorkspace.allowed,
      writePaths: rawWorkspace.writePaths,
      readBytes: 0,
      maxReadBytes: rawWorkspace.maxReadBytes,
      maxWriteBytes: rawWorkspace.maxWriteBytes,
      searchBytes: 0,
      writeBytes: 0,
      resolveFile: (p, write) => rawWorkspace.resolveFile(p, write),
      listPaths: async () => {
        handlerInvocations.listPaths++;
        return await rawWorkspace.listPaths();
      },
      search: async (term) => {
        handlerInvocations.search++;
        return await rawWorkspace.search(term);
      },
      readSlice: async (p, start, len) => {
        handlerInvocations.readSlice++;
        return await rawWorkspace.readSlice(p, start, len);
      },
      proposePatch: async (p, expectedSha, content) => {
        handlerInvocations.proposePatch++;
        return await rawWorkspace.proposePatch(p, expectedSha, content);
      }
    };

    // 4. Injected mock subprocess executor (captures actual executable, args, and cwd)
    mockExecFile = (file, args, options, callback) => {
      handlerInvocations.execFile++;
      lastExecution = {
        executable: file,
        args: Array.isArray(args) ? [...args] : args,
        cwd: options?.cwd
      };
      const cb = typeof options === 'function' ? options : callback;
      if (typeof cb === 'function') {
        cb(null, { stdout: 'conformance-tests-passed\n', stderr: '' });
      }
    };

    // 5. Initialize PolicyService with deterministic clock and AuthorityPort
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy);
    authorityPort = new AuthorityPort(rctPort);
    registry = createDefaultRegistry({ authority: authorityPort });

    // 6. Assignment declaration with exact scopes (confining worker to snapshot root)
    conformanceAssignment = {
      id: 'rct-conf-01',
      attemptId: 1,
      agent: 'RCT-1',
      sessionId: 'rct-sess-conf-01',
      cwd: 'src',
      scope: {
        root: tempDir,
        sourceRoot: sourceDir,
        readPaths: ['src/index.js', 'src/app.js', 'docs/guide.md', 'test/safe.test.js'],
        writePaths: ['src/index.js', 'src/app.js'],
        createPaths: ['src/new-feature.js']
      },
      checks: [
        {
          type: 'command',
          command: ['node', '--test', 'test/safe.test.js'],
          cwd: 'src'
        },
        {
          profile: 'test',
          path: 'test/safe.test.js',
          cwd: tempDir
        }
      ]
    };

    // Issue grants for the assignment (separate capability-scoped grants)
    rctPort.createAssignmentGrants(conformanceAssignment, { ttlMs: 60000 });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    if (sourceDir) {
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Suite A: Exact Capability Gating & Explicit CWD Flow
  // =========================================================================
  describe('A. Exact Capability Gating & Explicit CWD Flow', () => {
    it('executes list_paths through real ToolRegistry under policy authority', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      const result = await registry.execute({ name: 'list_paths', args: {} }, context);
      assert.deepEqual(result, ['docs/guide.md', 'src/app.js', 'src/index.js', 'test/safe.test.js']);
      assert.equal(handlerInvocations.listPaths, 1);
    });

    it('executes search for term through real ToolRegistry under policy authority', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      const result = await registry.execute({ name: 'search', args: { term: 'version' } }, context);
      assert.equal(result.length, 1);
      assert.equal(result[0].path, 'src/index.js');
      assert.equal(handlerInvocations.search, 1);
    });

    it('executes read_slice on permitted read path (src/index.js)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      const result = await registry.execute({
        name: 'read_slice',
        args: { path: 'src/index.js', start: 0, length: 100 }
      }, context);

      assert.equal(result.path, 'src/index.js');
      assert(result.content.includes('version = "1.0.0"'));
      assert.equal(handlerInvocations.readSlice, 1);
    });

    it('executes propose_patch on authorized write path (src/app.js)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      const currentContent = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      const expectedSha256 = sha256(Buffer.from(currentContent));
      const newContent = 'export function run() { return 100; }\n';

      const result = await registry.execute({
        name: 'propose_patch',
        args: { path: 'src/app.js', expectedSha256, content: newContent }
      }, context);

      assert.equal(result.applied, true);
      assert.equal(handlerInvocations.proposePatch, 1);

      // Verify file was actually written to synthetic disk
      const updatedOnDisk = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      assert.equal(updatedOnDisk, newContent);
    });

    it('authorizes FILE_CREATE capability on declared createPaths (src/new-feature.js)', async () => {
      const createReq = {
        tool: 'propose_patch',
        effect: EFFECTS.WRITE,
        capability: CAPABILITIES.FILE_WRITE,
        args: {
          path: 'src/new-feature.js',
          content: 'export const newFeature = true;\n'
        },
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      // Authority Port evaluates FILE_CREATE grant for newly created file
      const evalResult = await authorityPort.evaluate(createReq);
      assert.equal(evalResult.allowed, true);
    });

    it('authorizes run_check on exact declared command and explicit cwd', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        verify: async (ws, checks) => [{ checkId: 'safe-test', passed: true }]
      };

      const result = await registry.execute({
        name: 'run_check',
        args: {
          command: ['node', '--test', 'test/safe.test.js'],
          cwd: 'src'
        }
      }, context);

      assert(Array.isArray(result.checks));
      assert.equal(result.checks[0].passed, true);
    });

    it('authorizes check_command binding actual executable, resolved target argv, and actual workspace cwd (default path)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      // 1. Evaluate authority decision directly and verify authorization
      const authDecision = await authorityPort.evaluate({
        tool: 'check_command',
        effect: EFFECTS.EXECUTE,
        capability: CAPABILITIES.CHECK_EXECUTE,
        args: { profile: 'test', path: 'test/safe.test.js' },
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      });
      assert.equal(authDecision.allowed, true, 'AuthorityPort must authorize check_command on declared profile and path');

      // 2. Execute through ToolRegistry under authority gate
      const result = await registry.execute({
        name: 'check_command',
        args: { profile: 'test', path: 'test/safe.test.js' }
      }, context);

      assert.equal(result.ok, true);
      assert.equal(result.profile, 'test');
      assert.equal(handlerInvocations.execFile, 1);

      // 3. Proves: Captured executor executable, args, and cwd EXACTLY equal authorized request
      assert(lastExecution !== null, 'Subprocess executor must have captured invocation parameters');
      assert(rctPort.lastActionRequest !== null, 'Policy port must have captured action request');

      assert.equal(lastExecution.executable, CHECK_COMMAND_PROFILES.test.executable);
      assert.deepEqual(lastExecution.args, ['--test', '--', 'test/safe.test.js']);

      const expectedCwd = tempDir.replace(/\\/g, '/');
      const executorCwd = lastExecution.cwd.replace(/\\/g, '/');
      const authorizedCwd = rctPort.lastActionRequest.parameters.cwd.replace(/\\/g, '/');

      assert.equal(executorCwd, expectedCwd);
      assert.equal(authorizedCwd, expectedCwd);
      assert.equal(executorCwd, authorizedCwd);
    });

    it('proves explicit malicious/alternate args.cwd binds actual workspace.root unconditionally (captured subprocess equals captured authorization)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      // Caller passes explicit malicious/alternate cwd in tool call arguments
      const result = await registry.execute({
        name: 'check_command',
        args: {
          profile: 'test',
          path: 'test/safe.test.js',
          cwd: 'malicious/alternate/path'
        }
      }, context);

      assert.equal(result.ok, true);
      assert.equal(result.profile, 'test');
      assert.equal(handlerInvocations.execFile, 1);

      // 1. Captured subprocess executor invocation
      assert(lastExecution !== null, 'Subprocess executor must have captured invocation parameters');
      assert.equal(lastExecution.executable, CHECK_COMMAND_PROFILES.test.executable);
      assert.deepEqual(lastExecution.args, ['--test', '--', 'test/safe.test.js']);

      // 2. Captured policy authorization
      assert(rctPort.lastActionRequest !== null, 'Policy port must have captured action request');
      const authorizedCwd = rctPort.lastActionRequest.parameters.cwd;

      // 3. Proves: Actual executor cwd strictly equals authorized canonical cwd (workspace.root)
      const expectedCwd = tempDir.replace(/\\/g, '/');
      assert.equal(lastExecution.cwd.replace(/\\/g, '/'), expectedCwd);
      assert.equal(authorizedCwd.replace(/\\/g, '/'), expectedCwd);
      assert.equal(lastExecution.cwd.replace(/\\/g, '/'), authorizedCwd.replace(/\\/g, '/'));

      // 4. Proves: Neither executor nor authorization used the malicious/alternate args.cwd
      assert.notEqual(lastExecution.cwd, 'malicious/alternate/path');
      assert.notEqual(authorizedCwd, 'malicious/alternate/path');
    });

    it('proves explicit args.cwd "src" binds actual workspace.root unconditionally (captured subprocess equals captured authorization)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      // Caller passes explicit alternate cwd 'src' (matching assignment.cwd, but not workspace.root)
      const result = await registry.execute({
        name: 'check_command',
        args: {
          profile: 'test',
          path: 'test/safe.test.js',
          cwd: 'src'
        }
      }, context);

      assert.equal(result.ok, true);
      assert.equal(result.profile, 'test');
      assert.equal(handlerInvocations.execFile, 1);

      // Captured subprocess and authorization both equal workspace.root unconditionally
      assert(lastExecution !== null);
      assert(rctPort.lastActionRequest !== null);

      const expectedCwd = tempDir.replace(/\\/g, '/');
      const executorCwd = lastExecution.cwd.replace(/\\/g, '/');
      const authorizedCwd = rctPort.lastActionRequest.parameters.cwd.replace(/\\/g, '/');

      assert.equal(executorCwd, expectedCwd);
      assert.equal(authorizedCwd, expectedCwd);
      assert.equal(executorCwd, authorizedCwd);

      // Neither executor nor authorization diverged to 'src'
      assert.notEqual(executorCwd, 'src');
      assert.notEqual(authorizedCwd, 'src');
    });
  });

  // =========================================================================
  // Suite B: Denied Handlers Are Not Invoked
  // =========================================================================
  describe('B. Denied Handlers Are Not Invoked', () => {
    it('proves workspace.readSlice is NEVER called when authority denies unauthorized path', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'read_slice',
            args: { path: 'secrets/creds.json', start: 0, length: 100 }
          }, context);
        },
        (err) => {
          assert(err.message.includes('path_outside_grant_scope'));
          return true;
        }
      );

      // Invariant: handler must NEVER be invoked upon authority denial
      assert.equal(handlerInvocations.readSlice, 0, 'workspace.readSlice must not be called when authority denies');
    });

    it('proves workspace.proposePatch is NEVER called when authority denies read-only path', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      const fakeSha = '0'.repeat(64);
      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'docs/guide.md', expectedSha256: fakeSha, content: 'tampered doc' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('grant_scope') || err.message.includes('not_permitted'));
          return true;
        }
      );

      // Invariant: handler must NEVER be invoked upon authority denial
      assert.equal(handlerInvocations.proposePatch, 0, 'workspace.proposePatch must not be called when authority denies');
    });

    it('proves subprocess executor is NEVER called when authority denies unauthorized command', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '-e', 'process.exit(0)'],
              cwd: 'src'
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('command_not_permitted'));
          return true;
        }
      );

      // Invariant: subprocess must NEVER be executed upon authority denial
      assert.equal(handlerInvocations.execFile, 0, 'execFile must not be called when authority denies');
    });
  });

  // =========================================================================
  // Suite C: Expiry and Revocation Between Admission and Effect (Effect-Time Defense)
  // =========================================================================
  describe('C. Expiry and Revocation Between Admission and Effect', () => {
    it('fails closed when grant was revoked after admission but before tool execution', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      // Find the read grant for this session
      const activeGrants = policy.getActiveGrants({ sessionId: 'rct-sess-conf-01' });
      const readGrant = activeGrants.find(g => g.scope.actionTypes.includes(ActionType.FILE_READ));
      assert(readGrant);

      // Revoke the grant between admission and effect time
      policy.revokeGrant(readGrant.grantId, 'operator_emergency_revocation');

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'read_slice',
            args: { path: 'src/index.js', start: 0, length: 50 }
          }, context);
        },
        (err) => {
          assert(err.message.includes('grant_revoked'));
          return true;
        }
      );

      assert.equal(handlerInvocations.readSlice, 0, 'Handler must not execute after revocation');
    });

    it('fails closed when session was revoked after admission but before tool execution', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      // Revoke entire session between admission and effect time
      policy.revokeSession('rct-sess-conf-01', 'task_cancelled_by_coordinator');

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'read_slice',
            args: { path: 'src/app.js', start: 0, length: 50 }
          }, context);
        },
        (err) => {
          assert(err.message.includes('grant_revoked'));
          return true;
        }
      );

      assert.equal(handlerInvocations.readSlice, 0, 'Handler must not execute after session revocation');
    });

    it('fails closed when grant expired after admission but before tool execution', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      // Advance clock past expiration (TTL was 60000 ms = 60s)
      currentTime = 1700000000000 + 60001;

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'read_slice',
            args: { path: 'src/index.js', start: 0, length: 50 }
          }, context);
        },
        (err) => {
          assert(err.message.includes('grant_expired'));
          return true;
        }
      );

      assert.equal(handlerInvocations.readSlice, 0, 'Handler must not execute after grant expiration');
    });
  });

  // =========================================================================
  // Suite D: Changed Arguments, Parameters, and Scope Denials
  // =========================================================================
  describe('D. Changed Arguments, Parameters, and Scope Denials', () => {
    it('denies execution when command arguments are appended', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '--test', 'test/safe.test.js', '--eval', 'evil'],
              cwd: 'src'
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('command_not_permitted'));
          return true;
        }
      );

      assert.equal(handlerInvocations.execFile, 0);
    });

    it('denies execution when command arguments are changed', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '--test', 'test/malicious.test.js'],
              cwd: 'src'
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('command_not_permitted'));
          return true;
        }
      );

      assert.equal(handlerInvocations.execFile, 0);
    });

    it('denies execution when working directory is changed to unauthorized directory', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '--test', 'test/safe.test.js'],
              cwd: 'unauthorized-directory'
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('cwd_outside_grant_scope'));
          return true;
        }
      );

      assert.equal(handlerInvocations.execFile, 0);
    });

    it('denies execution when working directory is a descendant of authorized cwd (no prefix matching)', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '--test', 'test/safe.test.js'],
              cwd: 'src/subpackage' // descendant directory of 'src'
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('cwd_outside_grant_scope'));
          return true;
        }
      );

      assert.equal(handlerInvocations.execFile, 0);
    });

    it('denies execution when working directory is omitted under cwd-scoped grant', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'run_check',
            args: {
              command: ['node', '--test', 'test/safe.test.js']
              // cwd omitted!
            }
          }, context);
        },
        (err) => {
          assert(err.message.includes('missing_shell_cwd'));
          return true;
        }
      );

      assert.equal(handlerInvocations.execFile, 0);
    });

    it('denies execution when request parameters mismatch exactRequestDigest approval grant', async () => {
      const legitimateReq = createActionRequest({
        taskId: 'rct-conf-01',
        attemptId: 1,
        principalId: 'RCT-1',
        sessionId: 'rct-sess-exact-digest',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'src/app.js', patch: 'legitimate patch' }
      });

      // Issue grant bound strictly to legitimateReq's digest
      policy.issueGrant({
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: 'grant-exact-digest-conf',
        principalId: 'RCT-1',
        sessionId: 'rct-sess-exact-digest',
        scope: {
          actionTypes: [ActionType.FILE_WRITE],
          allowedPaths: ['src/app.js'],
          exactRequestDigest: legitimateReq.requestDigest
        },
        issuedAt: currentTime,
        expiresAt: currentTime + 60000,
        revoked: false,
        issuerId: 'policy'
      });

      // Tampered request modifying patch content
      const tamperedReq = createActionRequest({
        taskId: 'rct-conf-01',
        attemptId: 1,
        principalId: 'RCT-1',
        sessionId: 'rct-sess-exact-digest',
        actionType: ActionType.FILE_WRITE,
        parameters: { path: 'src/app.js', patch: 'malicious tampered patch' }
      });

      const evalResult = policy.evaluate(tamperedReq);
      assert.equal(evalResult.granted, false);
      assert.equal(evalResult.reason, 'exact_request_digest_mismatch');
    });

    it('denies check_command when profile is changed (unauthorized profile) before executor', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'lint', path: 'src/app.js' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('command_not_permitted') || err.message.includes('Authority denied'));
          return true;
        }
      );

      // Invariant: mock subprocess executor is NEVER called when profile is unauthorized
      assert.equal(handlerInvocations.execFile, 0, 'mock executor must not be called when profile is unauthorized');
    });

    it('denies check_command when targets are changed before executor', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'test', path: 'src/index.js' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('command_not_permitted') || err.message.includes('Authority denied'));
          return true;
        }
      );

      // Invariant: mock subprocess executor is NEVER called when targets are changed
      assert.equal(handlerInvocations.execFile, 0, 'mock executor must not be called when targets are changed');
    });

    it('denies check_command when target path is outside workspace scope before executor', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'test', path: 'secrets/creds.json' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('Path outside assignment scope') || err.message.includes('command_not_permitted') || err.message.includes('Authority denied'));
          return true;
        }
      );

      // Invariant: mock subprocess executor is NEVER called when target escapes scope
      assert.equal(handlerInvocations.execFile, 0, 'mock executor must not be called when target escapes scope');
    });

    it('denies check_command when cwd is changed to unauthorized directory before executor', async () => {
      const foreignWorkspace = {
        ...spiedWorkspace,
        root: path.join(tempDir, 'foreign-root')
      };
      const context = {
        assignment: conformanceAssignment,
        workspace: foreignWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'test', path: 'test/safe.test.js' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('cwd_outside_grant_scope') || err.message.includes('Authority denied'));
          return true;
        }
      );

      // Invariant: mock subprocess executor is NEVER called when cwd is unauthorized
      assert.equal(handlerInvocations.execFile, 0, 'mock executor must not be called when cwd is changed');
    });

    it('denies check_command when cwd is a descendant directory (no prefix matching) before executor', async () => {
      const descendantWorkspace = {
        ...spiedWorkspace,
        root: path.join(tempDir, 'test')
      };
      const context = {
        assignment: conformanceAssignment,
        workspace: descendantWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'test', path: 'test/safe.test.js' }
          }, context);
        },
        (err) => {
          assert(err.message.includes('cwd_outside_grant_scope') || err.message.includes('Authority denied'));
          return true;
        }
      );

      // Invariant: mock subprocess executor is NEVER called when cwd is descendant
      assert.equal(handlerInvocations.execFile, 0, 'mock executor must not be called when cwd is descendant');
    });
  });

  // =========================================================================
  // Suite E: Cross-Interface Policy Scope & Snapshot-Source Checklist (W4-AGR1)
  // =========================================================================
  describe('E. Cross-Interface Policy Scope & Snapshot-Source Checklist (W4-AGR1)', () => {
    it('1. Exact scope partitioning: permits read on readPaths, write on writePaths, and create on createPaths', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      // Read permitted on read-only file
      const readRes = await registry.execute({
        name: 'read_slice',
        args: { path: 'docs/guide.md', start: 0, length: 50 }
      }, context);
      assert(readRes.content.includes('Developer Guide'));

      // Write permitted on write-authorized file
      const currentHash = sha256(await fs.readFile(path.join(tempDir, 'src/app.js')));
      const patchRes = await registry.execute({
        name: 'propose_patch',
        args: { path: 'src/app.js', expectedSha256: currentHash, content: 'export function run() { return 100; }\n' }
      }, context);
      assert.equal(patchRes.applied, true);

      // Create permitted on declared createPaths
      const createEval = await authorityPort.evaluate({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/new-feature.js', content: 'export const feature = 1;\n' },
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      });
      assert.equal(createEval.allowed, true);
    });

    it('2. Exact scope partitioning: denies write on read-only path and undeclared path', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      // Write to read-only path denied
      const docHash = sha256(await fs.readFile(path.join(tempDir, 'docs/guide.md')));
      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'docs/guide.md', expectedSha256: docHash, content: 'hacked doc' }
          }, context);
        },
        (err) => err.message.includes('grant_scope') || err.message.includes('Authority denied')
      );

      // Write to undeclared path denied
      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'secrets/creds.json', expectedSha256: '0'.repeat(64), content: 'stolen' }
          }, context);
        },
        (err) => err.message.includes('grant_scope') || err.message.includes('Authority denied')
      );
    });

    it('3. Snapshot vs. source distinction: modifications remain confined to snapshot; sourceRoot remains untouched', async () => {
      const initialSourceContent = await fs.readFile(path.join(sourceDir, 'src/app.js'), 'utf8');

      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      // Mutate snapshot file
      const currentSnapshotHash = sha256(await fs.readFile(path.join(tempDir, 'src/app.js')));
      const patchRes = await registry.execute({
        name: 'propose_patch',
        args: { path: 'src/app.js', expectedSha256: currentSnapshotHash, content: 'export function run() { return 999; }\n' }
      }, context);
      assert.equal(patchRes.applied, true);

      // Verify snapshot was mutated
      const updatedSnapshotContent = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      assert.equal(updatedSnapshotContent, 'export function run() { return 999; }\n');

      // Verify baseline source repository file remains strictly bitwise identical (sourceUnchanged)
      const afterSourceContent = await fs.readFile(path.join(sourceDir, 'src/app.js'), 'utf8');
      assert.equal(afterSourceContent, initialSourceContent, 'Source root repository must remain completely untouched');
    });

    it('4a. Snapshot vs. source distinction: policy denies check_command directed at sourceRoot (prior subprocess cwd denial)', async () => {
      // Prior subprocess cwd denial: check_command targeting sourceRoot directory is denied because grant is scoped strictly to snapshot root
      const sourceRootReq = {
        tool: 'check_command',
        effect: EFFECTS.EXECUTE,
        capability: CAPABILITIES.CHECK_EXECUTE,
        args: { profile: 'test', path: 'test/safe.test.js' },
        execution: {
          executable: 'node',
          argv: ['--test', '--', 'test/safe.test.js'],
          command: ['node', '--test', '--', 'test/safe.test.js'],
          cwd: sourceDir // Escaping snapshot to source root!
        },
        assignment: conformanceAssignment,
        workspace: { ...spiedWorkspace, root: sourceDir }
      };

      const evalRes = await authorityPort.evaluate(sourceRootReq);
      assert.equal(evalRes.allowed, false);
      assert(evalRes.reason.includes('grant_scope') || evalRes.reason.includes('cwd_outside_grant_scope'));
    });

    it('4b. W4R-AGR1 Negative Fixture (Read): actual registry rejects source-root substitution before handler', async () => {
      // Proves prior subprocess cwd denial alone was insufficient: file authority must bind exact canonical workspace root.
      const rawSourceWorkspace = new ScopedWorkspace(sourceDir, {
        readPaths: ['src/app.js', 'docs/guide.md'],
        writePaths: ['src/app.js']
      });
      const sourceHandlerInvocations = { readSlice: 0, proposePatch: 0 };
      const spiedSourceWorkspace = {
        root: rawSourceWorkspace.root,
        allowed: rawSourceWorkspace.allowed,
        writePaths: rawSourceWorkspace.writePaths,
        readBytes: 0,
        maxReadBytes: rawSourceWorkspace.maxReadBytes,
        maxWriteBytes: rawSourceWorkspace.maxWriteBytes,
        searchBytes: 0,
        writeBytes: 0,
        resolveFile: (p, write) => rawSourceWorkspace.resolveFile(p, write),
        listPaths: () => rawSourceWorkspace.listPaths(),
        search: (term) => rawSourceWorkspace.search(term),
        readSlice: async (p, start, len) => {
          sourceHandlerInvocations.readSlice++;
          return await rawSourceWorkspace.readSlice(p, start, len);
        },
        proposePatch: async (p, expectedSha, content) => {
          sourceHandlerInvocations.proposePatch++;
          return await rawSourceWorkspace.proposePatch(p, expectedSha, content);
        }
      };

      const context = {
        assignment: conformanceAssignment,
        workspace: spiedSourceWorkspace
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'read_slice',
            args: { path: 'src/app.js', start: 0, length: 50 }
          }, context);
        },
        (err) => err.message.includes('workspace_root_mismatch')
      );

      // Handler is NEVER reached: rejected at authority evaluation before handler
      assert.equal(sourceHandlerInvocations.readSlice, 0, 'Source workspace readSlice handler must NEVER be invoked');
    });

    it('4c. W4R-AGR1 Negative Fixture (Write): actual registry rejects source-root substitution before handler and source remains untouched', async () => {
      const rawSourceWorkspace = new ScopedWorkspace(sourceDir, {
        readPaths: ['src/app.js', 'docs/guide.md'],
        writePaths: ['src/app.js']
      });
      const sourceHandlerInvocations = { readSlice: 0, proposePatch: 0 };
      const spiedSourceWorkspace = {
        root: rawSourceWorkspace.root,
        allowed: rawSourceWorkspace.allowed,
        writePaths: rawSourceWorkspace.writePaths,
        readBytes: 0,
        maxReadBytes: rawSourceWorkspace.maxReadBytes,
        maxWriteBytes: rawSourceWorkspace.maxWriteBytes,
        searchBytes: 0,
        writeBytes: 0,
        resolveFile: (p, write) => rawSourceWorkspace.resolveFile(p, write),
        listPaths: () => rawSourceWorkspace.listPaths(),
        search: (term) => rawSourceWorkspace.search(term),
        readSlice: async (p, start, len) => {
          sourceHandlerInvocations.readSlice++;
          return await rawSourceWorkspace.readSlice(p, start, len);
        },
        proposePatch: async (p, expectedSha, content) => {
          sourceHandlerInvocations.proposePatch++;
          return await rawSourceWorkspace.proposePatch(p, expectedSha, content);
        }
      };

      const initialSourceContent = await fs.readFile(path.join(sourceDir, 'src/app.js'), 'utf8');
      const sourceHash = sha256(initialSourceContent);

      const context = {
        assignment: conformanceAssignment,
        workspace: spiedSourceWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'src/app.js', expectedSha256: sourceHash, content: 'export function run() { return 666; }\n' }
          }, context);
        },
        (err) => err.message.includes('workspace_root_mismatch')
      );

      // Handler is NEVER reached: rejected at authority evaluation before handler
      assert.equal(sourceHandlerInvocations.proposePatch, 0, 'Source workspace proposePatch handler must NEVER be invoked');

      // Verify baseline source repository file remains strictly bitwise identical
      const afterSourceContent = await fs.readFile(path.join(sourceDir, 'src/app.js'), 'utf8');
      assert.equal(afterSourceContent, initialSourceContent, 'Source root repository must remain completely untouched after malicious write attempt');
    });

    it('4d. W4R-AGR1 Negative Fixture (Create): actual registry rejects source-root substitution before handler on createPaths', async () => {
      const rawSourceWorkspace = new ScopedWorkspace(sourceDir, {
        readPaths: ['src/app.js', 'docs/guide.md', 'src/new-feature.js'],
        writePaths: ['src/app.js', 'src/new-feature.js']
      });
      const sourceHandlerInvocations = { readSlice: 0, proposePatch: 0 };
      const spiedSourceWorkspace = {
        root: rawSourceWorkspace.root,
        allowed: rawSourceWorkspace.allowed,
        writePaths: rawSourceWorkspace.writePaths,
        readBytes: 0,
        maxReadBytes: rawSourceWorkspace.maxReadBytes,
        maxWriteBytes: rawSourceWorkspace.maxWriteBytes,
        searchBytes: 0,
        writeBytes: 0,
        resolveFile: (p, write) => rawSourceWorkspace.resolveFile(p, write),
        listPaths: () => rawSourceWorkspace.listPaths(),
        search: (term) => rawSourceWorkspace.search(term),
        readSlice: async (p, start, len) => {
          sourceHandlerInvocations.readSlice++;
          return await rawSourceWorkspace.readSlice(p, start, len);
        },
        proposePatch: async (p, expectedSha, content) => {
          sourceHandlerInvocations.proposePatch++;
          return await rawSourceWorkspace.proposePatch(p, expectedSha, content);
        }
      };

      const context = {
        assignment: conformanceAssignment,
        workspace: spiedSourceWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'src/new-feature.js', expectedSha256: '0'.repeat(64), content: 'export const evil = 1;\n' }
          }, context);
        },
        (err) => err.message.includes('workspace_root_mismatch')
      );

      assert.equal(sourceHandlerInvocations.proposePatch, 0, 'Source workspace proposePatch handler must NEVER be invoked');

      let fileExistsInSource = false;
      try {
        await fs.access(path.join(sourceDir, 'src/new-feature.js'));
        fileExistsInSource = true;
      } catch {
        fileExistsInSource = false;
      }
      assert.equal(fileExistsInSource, false, 'New file must NOT be created in baseline source repository');
    });

    it('4e. W4R-AGR1 Direct Port Evaluation: fails closed on substituted or missing workspace root for read/write/create', async () => {
      // 1. Read with substituted source root fails closed
      const readEval = await authorityPort.evaluate({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/app.js' },
        assignment: conformanceAssignment,
        workspace: { root: sourceDir }
      });
      assert.equal(readEval.allowed, false);
      assert.equal(readEval.reason, 'workspace_root_mismatch');

      // 2. Write with substituted source root fails closed
      const writeEval = await authorityPort.evaluate({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/app.js', content: 'update' },
        assignment: conformanceAssignment,
        workspace: { root: sourceDir }
      });
      assert.equal(writeEval.allowed, false);
      assert.equal(writeEval.reason, 'workspace_root_mismatch');

      // 3. Create with substituted source root fails closed
      const createEval = await authorityPort.evaluate({
        tool: 'propose_patch',
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/new-feature.js', content: 'new code' },
        assignment: conformanceAssignment,
        workspace: { root: sourceDir }
      });
      assert.equal(createEval.allowed, false);
      assert.equal(createEval.reason, 'workspace_root_mismatch');

      // 4. Missing workspace root under rooted assignment fails closed
      const missingRootEval = await authorityPort.evaluate({
        tool: 'read_slice',
        effect: 'read',
        capability: 'file:read',
        args: { path: 'src/app.js' },
        assignment: conformanceAssignment,
        workspace: {}
      });
      assert.equal(missingRootEval.allowed, false);
      assert.equal(missingRootEval.reason, 'missing_workspace_root');
    });

    it('4f. W4R-AGR1 Positive Fixture: valid snapshot root execution succeeds for read, write, and create', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        verify: async () => [{ checkId: 'c1', passed: true }]
      };

      // 1. Valid snapshot read
      const readRes = await registry.execute({
        name: 'read_slice',
        args: { path: 'src/index.js', start: 0, length: 50 }
      }, context);
      assert(readRes.content.includes('export const version'));

      // 2. Valid snapshot write: mutates tempDir snapshot only
      const initialAppContent = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      const appHash = sha256(initialAppContent);
      const patchRes = await registry.execute({
        name: 'propose_patch',
        args: { path: 'src/app.js', expectedSha256: appHash, content: 'export function run() { return 777; }\n' }
      }, context);
      assert.equal(patchRes.applied, true);

      // Verify tempDir snapshot was mutated
      const updatedTempApp = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      assert.equal(updatedTempApp, 'export function run() { return 777; }\n');

      // Verify sourceDir remains bitwise untouched
      const sourceApp = await fs.readFile(path.join(sourceDir, 'src/app.js'), 'utf8');
      assert.equal(sourceApp, 'export function run() { return 42; }\n');

      // 3. Valid snapshot create evaluation authorized
      const createEval = await authorityPort.evaluate({
        tool: 'propose_patch',
        effect: 'create',
        capability: 'file:create',
        args: { path: 'src/new-feature.js', content: 'valid' },
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      });
      assert.equal(createEval.allowed, true);
    });

    it('5. Effect-time revocation & expiry: prevents disk modification and process spawning at effect-time', async () => {
      const context = {
        assignment: conformanceAssignment,
        workspace: spiedWorkspace,
        execFile: mockExecFile,
        startTime: Date.now()
      };

      // 5a. Revoke write grant before tool execution
      const writeGrant = policy.getActiveGrants({ sessionId: conformanceAssignment.sessionId })
        .find(g => g.scope.actionTypes.includes(ActionType.FILE_WRITE));
      assert(writeGrant);
      policy.revokeGrant(writeGrant.grantId, 'admin_revoke_before_write');

      const appHash = sha256(await fs.readFile(path.join(tempDir, 'src/app.js')));
      const initialDiskContent = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'propose_patch',
            args: { path: 'src/app.js', expectedSha256: appHash, content: 'never_applied\n' }
          }, context);
        },
        (err) => err.message.includes('grant_revoked')
      );

      // Verify 0 handler invocations and disk remains unmodified
      assert.equal(handlerInvocations.proposePatch, 0);
      const diskContentAfterDenied = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      assert.equal(diskContentAfterDenied, initialDiskContent);

      // 5b. Revoke entire session before check execution
      policy.revokeSession(conformanceAssignment.sessionId, 'admin_revoke_session');

      await assert.rejects(
        async () => {
          await registry.execute({
            name: 'check_command',
            args: { profile: 'test', path: 'test/safe.test.js' }
          }, context);
        },
        (err) => err.message.includes('grant_revoked')
      );

      // Verify 0 executor invocations
      assert.equal(handlerInvocations.execFile, 0);
    });

    it('6. Preserved discrete tuple semantics: command authorized for snapshot root fails closed in unauthorized directory', async () => {
      // Invariant: Discrete (commandArgv, canonicalCwd) tuple prevents cross-product and prefix matching
      const unauthorizedCwdReq = {
        tool: 'run_check',
        effect: EFFECTS.EXECUTE,
        capability: CAPABILITIES.CHECK_EXECUTE,
        args: {
          command: ['node', '--test', 'test/safe.test.js'],
          cwd: 'unauthorized/path'
        },
        assignment: conformanceAssignment,
        workspace: spiedWorkspace
      };

      const evalRes = await authorityPort.evaluate(unauthorizedCwdReq);
      assert.equal(evalRes.allowed, false);
      assert.equal(evalRes.reason, 'cwd_outside_grant_scope');
    });

    it('7. AGR-5 product smoke cross-interface conformance: ungranted tool request fails closed with no_matching_grant and zero effect', async () => {
      // Replicates AGR-5 Scenario 3: ungranted policy request against ScopedWorkspace & ToolRegistry
      const freshPolicy = new PolicyService({ clock: () => currentTime });
      const freshRctPort = new RctPolicyPort(freshPolicy);
      const freshRegistry = createDefaultRegistry({ authority: freshRctPort });

      const initialAppContent = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      const appHash = sha256(initialAppContent);

      // Direct port evaluation
      const directEval = await freshRctPort.evaluate({
        tool: 'propose_patch',
        effect: 'write',
        capability: 'file:write',
        args: { path: 'src/app.js', expectedSha256: appHash, content: 'unauthorized\n' },
        assignment: { id: 'smoke-task-1', agent: 'worker-smoke' }
      });

      assert.equal(directEval.allowed, false);
      assert.equal(directEval.reason, 'no_matching_grant');

      // Registry execution throws matching error and does not touch disk
      await assert.rejects(
        async () => {
          await freshRegistry.execute({
            name: 'propose_patch',
            args: { path: 'src/app.js', expectedSha256: appHash, content: 'unauthorized\n' }
          }, {
            workspace: spiedWorkspace,
            assignment: { id: 'smoke-task-1', agent: 'worker-smoke', checks: [] }
          });
        },
        (err) => err.message === 'no_matching_grant'
      );

      const diskAfter = await fs.readFile(path.join(tempDir, 'src/app.js'), 'utf8');
      assert.equal(diskAfter, initialAppContent, 'Disk must remain completely untouched on denied grant');
    });
  });
});
