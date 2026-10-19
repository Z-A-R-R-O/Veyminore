/**
 * @file test/rct-port.test.js
 * Unit and integration tests for RctPolicyPort with RCT runtime AuthorityPort
 * and ToolRegistry baseline task flow execution.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../src/policy-service.js';
import { RctPolicyPort } from '../src/ports/rct-port.js';
import {
  AuthorityPort,
  EFFECTS,
  CAPABILITIES,
  ToolRegistry,
  createDefaultRegistry
} from '../../rct-runtime/src/tool-registry.js';
import { ActionType, SCHEMA_VERSIONS } from '../../protocol/src/index.js';

describe('RctPolicyPort & AuthorityPort Integration', () => {
  let currentTime = 1700000000000;
  let policy;
  let rctPort;
  let authorityPort;

  const sampleAssignment = {
    id: 'rct-task-01',
    attemptId: 1,
    agent: 'RCT-1',
    sessionId: 'rct-sess-01',
    cwd: 'src',
    scope: {
      readPaths: ['src/app.js', 'src/config.js'],
      writePaths: ['src/app.js'],
      commands: [ ['npm', 'test'] ]
    }
  };

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy);
    authorityPort = new AuthorityPort(rctPort);

    // Issue grants using helper - produces separate capability-scoped grants
    rctPort.createAssignmentGrants(sampleAssignment, { ttlMs: 60000 });
  });

  it('authorizes read_slice for path within readPaths via AuthorityPort', async () => {
    const rctRequest = {
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'src/app.js', startLine: 1, endLine: 10 },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'authorized');
  });

  it('authorizes propose_patch for path within writePaths', async () => {
    const rctRequest = {
      tool: 'propose_patch',
      effect: EFFECTS.WRITE,
      capability: CAPABILITIES.FILE_WRITE,
      args: { path: 'src/app.js', patch: 'diff' },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, true);
  });

  it('fails closed when propose_patch targets a read-only path (config.js not in writePaths)', async () => {
    // config.js is in readPaths but NOT in writePaths: separate grants guarantee write denial!
    const rctRequest = {
      tool: 'propose_patch',
      effect: EFFECTS.WRITE,
      capability: CAPABILITIES.FILE_WRITE,
      args: { path: 'src/config.js', patch: 'diff' },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, false);
    // Write grant exists for session but does not include config.js; read grant denies FILE_WRITE
    assert(['path_outside_grant_scope', 'action_type_not_permitted'].includes(res.reason));
  });

  it('authorizes run_check when command is permitted', async () => {
    const rctRequest = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: { command: ['npm', 'test'], cwd: 'src' },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, true);
  });

  it('fails closed when run_check attempts unpermitted command', async () => {
    const rctRequest = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: { command: ['rm', '-rf', '/'], cwd: 'src' },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'command_not_permitted');
  });

  it('fails closed when tool request has unmapped or unknown effect', async () => {
    const rctRequest = {
      tool: 'unknown_tool',
      effect: 'arbitrary_network_download',
      args: {},
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, false);
    assert(res.reason.includes('unmapped_rct_effect'));
  });

  it('fails closed when assignment session has been revoked', async () => {
    policy.revokeSession('rct-sess-01', 'task_cancelled');

    const rctRequest = {
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'src/app.js' },
      assignment: sampleAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(rctRequest);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'grant_revoked');
  });
});

describe('Read-Only Assignment Confinement & Exact Scope Preservation', () => {
  let currentTime = 1700000000000;
  let policy;
  let rctPort;
  let authorityPort;

  const readOnlyAssignment = {
    id: 'rct-ro-task',
    attemptId: 1,
    agent: 'RCT-1',
    sessionId: 'rct-sess-ro',
    scope: {
      readPaths: ['docs/guide.md', 'docs/api.md']
      // writePaths omitted / empty
      // commands omitted / empty
    }
  };

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy);
    authorityPort = new AuthorityPort(rctPort);

    // Issue grants for read-only assignment
    rctPort.createAssignmentGrants(readOnlyAssignment, { ttlMs: 60000 });
  });

  it('issues strictly one read grant with exact declared paths and zero invented paths', () => {
    const activeGrants = policy.getActiveGrants({ sessionId: 'rct-sess-ro' });
    assert.equal(activeGrants.length, 1);

    const grant = activeGrants[0];
    assert.deepEqual(grant.scope.actionTypes, [ActionType.FILE_READ]);
    assert.deepEqual(grant.scope.allowedPaths, ['docs/api.md', 'docs/guide.md']);
    // Proves 'src' was NOT invented
    assert.equal(grant.scope.allowedPaths.includes('src'), false);
    // Proves allowedCommands is NOT auto-granted
    assert.equal(grant.scope.allowedCommands, undefined);
  });

  it('authorizes read_slice on declared read paths', async () => {
    const res1 = await authorityPort.evaluate({
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'docs/guide.md' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(res1.allowed, true);

    const res2 = await authorityPort.evaluate({
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'docs/api.md' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(res2.allowed, true);
  });

  it('denies read_slice on invented or undeclared paths (e.g. src or secrets)', async () => {
    const resSrc = await authorityPort.evaluate({
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'src/index.js' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resSrc.allowed, false);
    assert.equal(resSrc.reason, 'path_outside_grant_scope');

    const resSecret = await authorityPort.evaluate({
      tool: 'read_slice',
      effect: EFFECTS.READ,
      capability: CAPABILITIES.FILE_READ,
      args: { path: 'secrets.env' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resSecret.allowed, false);
    assert.equal(resSecret.reason, 'path_outside_grant_scope');
  });

  it('denies propose_patch (FILE_WRITE) for read-only assignment on any path', async () => {
    const res = await authorityPort.evaluate({
      tool: 'propose_patch',
      effect: EFFECTS.WRITE,
      capability: CAPABILITIES.FILE_WRITE,
      args: { path: 'docs/guide.md', patch: 'modification' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });

    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'action_type_not_permitted');
  });

  it('denies shell execution and check commands for read-only assignment', async () => {
    const res1 = await authorityPort.evaluate({
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: { command: ['npm', 'test'] },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(res1.allowed, false);
    assert.equal(res1.reason, 'action_type_not_permitted');

    const res2 = await authorityPort.evaluate({
      tool: 'check_command',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: { profile: 'test' },
      assignment: readOnlyAssignment,
      workspace: { root: '.' }
    });
    assert.equal(res2.allowed, false);
    assert.equal(res2.reason, 'action_type_not_permitted');
  });
});

describe('Baseline Task Flow via Actual ToolRegistry & AuthorityPort', () => {
  let currentTime = 1700000000000;
  let policy;
  let rctPort;
  let registry;

  const assignmentWithWrite = {
    id: 'rct-rw-task',
    attemptId: 1,
    agent: 'RCT-1',
    sessionId: 'rct-sess-flow',
    scope: {
      readPaths: ['src/app.js', 'src/config.js'],
      writePaths: ['src/app.js'],
      commands: ['npm']
    }
  };

  const readOnlyAssignment = {
    id: 'rct-ro-task',
    attemptId: 1,
    agent: 'RCT-1',
    sessionId: 'rct-sess-ro-flow',
    scope: {
      readPaths: ['src/app.js']
    }
  };

  // Mock workspace satisfying tool execution contracts
  const createMockWorkspace = (allowedPaths = ['src/app.js', 'src/config.js']) => ({
    allowed: new Set(allowedPaths),
    readBytes: 0,
    maxReadBytes: 100000,
    searchBytes: 0,
    writePaths: new Set(['src/app.js']),
    listPaths: async () => allowedPaths,
    search: async (term) => [{ path: 'src/app.js', line: 1 }],
    readSlice: async (p, start, len) => `content-of-${p}`
  });

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy);
    const authority = new AuthorityPort(rctPort);
    registry = createDefaultRegistry({ authority });

    // Issue grants
    rctPort.createAssignmentGrants(assignmentWithWrite, { ttlMs: 60000 });
    rctPort.createAssignmentGrants(readOnlyAssignment, { ttlMs: 60000 });
  });

  it('executes list_paths through actual ToolRegistry under authority port', async () => {
    const context = {
      assignment: assignmentWithWrite,
      workspace: createMockWorkspace()
    };

    const result = await registry.execute({ name: 'list_paths', args: {} }, context);
    assert.deepEqual(result, ['src/app.js', 'src/config.js']);
  });

  it('executes search through actual ToolRegistry under authority port', async () => {
    const context = {
      assignment: assignmentWithWrite,
      workspace: createMockWorkspace()
    };

    const result = await registry.execute({ name: 'search', args: { term: 'app' } }, context);
    assert.deepEqual(result, [{ path: 'src/app.js', line: 1 }]);
  });

  it('executes read_slice on permitted path through actual ToolRegistry', async () => {
    const context = {
      assignment: assignmentWithWrite,
      workspace: createMockWorkspace()
    };

    const result = await registry.execute({
      name: 'read_slice',
      args: { path: 'src/app.js', start: 0, length: 100 }
    }, context);

    assert.equal(result, 'content-of-src/app.js');
  });

  it('throws Authority denied when propose_patch targets a read-only path (config.js)', async () => {
    const context = {
      assignment: assignmentWithWrite,
      workspace: createMockWorkspace()
    };

    const validSha256 = '0'.repeat(64);

    await assert.rejects(
      async () => {
        await registry.execute({
          name: 'propose_patch',
          args: { path: 'src/config.js', expectedSha256: validSha256, content: 'new' }
        }, context);
      },
      (err) => {
        // AuthorityPort rejects before handler or scope check
        assert(err.message.includes('grant_scope') || err.message.includes('not_permitted'));
        return true;
      }
    );
  });

  it('throws Authority denied when propose_patch is invoked for read-only assignment', async () => {
    const context = {
      assignment: readOnlyAssignment,
      workspace: { ...createMockWorkspace(['src/app.js']), writePaths: new Set(['src/app.js']) }
    };

    const validSha256 = '0'.repeat(64);

    await assert.rejects(
      async () => {
        await registry.execute({
          name: 'propose_patch',
          args: { path: 'src/app.js', expectedSha256: validSha256, content: 'new' }
        }, context);
      },
      (err) => {
        assert(err.message.includes('action_type_not_permitted'));
        return true;
      }
    );
  });
});

describe('P1 Regression: Exact Command Argv Binding & Explicit Cwd Confinement', () => {
  let currentTime = 1700000000000;
  let policy;
  let rctPort;
  let authorityPort;

  // Assignment declaring exact command check: node --test test/safe.test.js in cwd 'src'
  const checkAssignment = {
    id: 'rct-check-exact-01',
    attemptId: 1,
    agent: 'RCT-1',
    sessionId: 'rct-sess-exact',
    scope: {
      readPaths: ['src/app.js']
    },
    checks: [
      {
        type: 'command',
        command: ['node', '--test', 'test/safe.test.js'],
        cwd: 'src'
      }
    ]
  };

  beforeEach(() => {
    currentTime = 1700000000000;
    policy = new PolicyService({ clock: () => currentTime });
    rctPort = new RctPolicyPort(policy);
    authorityPort = new AuthorityPort(rctPort);

    rctPort.createAssignmentGrants(checkAssignment, { ttlMs: 60000 });
  });

  it('binds full declared argv and explicit authorized cwd in issued grant', () => {
    const activeGrants = policy.getActiveGrants({ sessionId: 'rct-sess-exact' });
    const execGrant = activeGrants.find(g => g.scope.actionTypes.includes(ActionType.SHELL_EXEC));

    assert(execGrant, 'Command grant must be issued for declared check');
    assert.deepEqual(execGrant.scope.allowedCommands, [ ['node', '--test', 'test/safe.test.js'] ]);
    assert.deepEqual(execGrant.scope.allowedPaths, ['src']);
    assert.equal(execGrant.scope.exactArgs, true);
  });

  it('authorizes exact declared argv in authorized cwd', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/safe.test.js'],
        cwd: 'src'
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'authorized');
  });

  it('fails closed when attempting arbitrary command in other directory (reproduction of P1 finding)', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '-e', 'arbitrary-code'],
        cwd: 'other-directory'
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    // Unauthorized cwd fails closed
    assert.equal(res.reason, 'cwd_outside_grant_scope');
  });

  it('fails closed when attempting arbitrary command in authorized cwd', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '-e', 'arbitrary-code'],
        cwd: 'src'
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    // Unpermitted command fails closed
    assert.equal(res.reason, 'command_not_permitted');
  });

  it('fails closed when appending arguments to declared command', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/safe.test.js', '--eval', 'evil'],
        cwd: 'src'
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'command_not_permitted');
  });

  it('fails closed when changing argument in declared command', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/other.test.js'],
        cwd: 'src'
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'command_not_permitted');
  });

  it('fails closed when cwd is omitted under cwd-scoped grant (missingcwd)', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/safe.test.js']
        // cwd omitted!
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'missing_shell_cwd');
  });

  it('fails closed when command check omits cwd and readPaths is README.md (no cwd inference)', async () => {
    const noCwdAssignment = {
      id: 'rct-no-cwd-task',
      attemptId: 1,
      agent: 'RCT-1',
      sessionId: 'rct-sess-no-cwd',
      scope: {
        readPaths: ['README.md'] // No directory prefix!
      },
      checks: [
        {
          type: 'command',
          command: ['node', '--test', 'test/safe.test.js']
          // cwd omitted on check and assignment!
        }
      ]
    };

    const issuedGrants = rctPort.createAssignmentGrants(noCwdAssignment, { ttlMs: 60000 });
    const execGrants = issuedGrants.filter(g => g.scope.actionTypes.includes(ActionType.SHELL_EXEC));
    // Must NOT issue shell grant without explicit authorized cwd!
    assert.equal(execGrants.length, 0, 'No shell grant must be issued without explicit authorized cwd');

    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/safe.test.js'],
        cwd: 'unauthorized-dir'
      },
      assignment: noCwdAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    assert(['action_type_not_permitted', 'unauthorized'].includes(res.reason));
  });

  it('fails closed when attempting descendant cwd (no directory-prefix matching)', async () => {
    const req = {
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', '--test', 'test/safe.test.js'],
        cwd: 'src/subpackage' // descendant of authorized 'src'!
      },
      assignment: checkAssignment,
      workspace: { root: '.' }
    };

    const res = await authorityPort.evaluate(req);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'cwd_outside_grant_scope');
  });

  it('enforces exact command+argv+cwd tuple binding and fails closed on swapped tuples (no crossproduct)', async () => {
    const multiCheckAssignment = {
      id: 'rct-multi-task',
      attemptId: 1,
      agent: 'RCT-1',
      sessionId: 'rct-sess-multi',
      checks: [
        {
          type: 'command',
          command: ['node', 'test/a.test.js'],
          cwd: 'packages/pkg-a'
        },
        {
          type: 'command',
          command: ['node', 'test/b.test.js'],
          cwd: 'packages/pkg-b'
        }
      ]
    };

    const issued = rctPort.createAssignmentGrants(multiCheckAssignment, { ttlMs: 60000 });
    const execGrants = issued.filter(g => g.scope.actionTypes.includes(ActionType.SHELL_EXEC));

    // Must issue exactly 2 discrete grants, 1 per tuple
    assert.equal(execGrants.length, 2);
    assert.deepEqual(execGrants[0].scope.allowedCommands, [ ['node', 'test/a.test.js'] ]);
    assert.deepEqual(execGrants[0].scope.allowedPaths, [ 'packages/pkg-a' ]);
    assert.equal(execGrants[0].scope.exactCwd, true);

    assert.deepEqual(execGrants[1].scope.allowedCommands, [ ['node', 'test/b.test.js'] ]);
    assert.deepEqual(execGrants[1].scope.allowedPaths, [ 'packages/pkg-b' ]);
    assert.equal(execGrants[1].scope.exactCwd, true);

    // 1. Authorize exact Tuple A in its own cwd
    const resA = await authorityPort.evaluate({
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', 'test/a.test.js'],
        cwd: 'packages/pkg-a'
      },
      assignment: multiCheckAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resA.allowed, true);

    // 2. Authorize exact Tuple B in its own cwd
    const resB = await authorityPort.evaluate({
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', 'test/b.test.js'],
        cwd: 'packages/pkg-b'
      },
      assignment: multiCheckAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resB.allowed, true);

    // 3. Fails closed on Swapped Tuple 1: Check A command in Check B directory
    const resSwap1 = await authorityPort.evaluate({
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', 'test/a.test.js'],
        cwd: 'packages/pkg-b' // Swapped!
      },
      assignment: multiCheckAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resSwap1.allowed, false);

    // 4. Fails closed on Swapped Tuple 2: Check B command in Check A directory
    const resSwap2 = await authorityPort.evaluate({
      tool: 'run_check',
      effect: EFFECTS.EXECUTE,
      capability: CAPABILITIES.CHECK_EXECUTE,
      args: {
        command: ['node', 'test/b.test.js'],
        cwd: 'packages/pkg-a' // Swapped!
      },
      assignment: multiCheckAssignment,
      workspace: { root: '.' }
    });
    assert.equal(resSwap2.allowed, false);
  });
});

