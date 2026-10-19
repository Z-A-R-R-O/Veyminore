import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ToolRegistry,
  AuthorityPort,
  createDefaultRegistry,
  EFFECTS,
  CAPABILITIES,
  CHECK_COMMAND_PROFILES,
  checkCommandTool,
  gitReadonlyTool,
  readSliceTool,
  proposePatchTool,
  searchTool,
  listPathsTool,
  clipUtf8,
  boundAndAccountOutput,
  resolveCheckTargets,
  resolveGitTargets,
  ScopedWorkspace,
  runAssignment,
  sha256
} from '../src/index.js';
import { FakeProvider } from '../src/fake-provider.js';

describe('Tool Registry Architecture and Capability Declarations', () => {
  it('registers the six baseline tools with typed schemas, capabilities, and effects', () => {
    const registry = createDefaultRegistry();
    const baseline = ['list_paths', 'search', 'read_slice', 'propose_patch', 'run_check', 'submit_receipt'];
    for (const name of baseline) {
      assert.ok(registry.has(name), `Missing baseline tool: ${name}`);
      const tool = registry.get(name);
      assert.equal(tool.name, name);
      assert.ok(tool.description.length > 5);
      assert.ok(tool.capability, `Tool ${name} must declare a capability`);
      assert.ok(tool.effect, `Tool ${name} must declare an effect`);
      assert.equal(typeof tool.schema, 'object');
      assert.equal(tool.schema.type, 'object');
    }

    assert.equal(registry.get('list_paths').effect, EFFECTS.READ);
    assert.equal(registry.get('search').effect, EFFECTS.READ);
    assert.equal(registry.get('read_slice').effect, EFFECTS.READ);
    assert.equal(registry.get('propose_patch').effect, EFFECTS.WRITE);
    assert.equal(registry.get('run_check').effect, EFFECTS.VERIFY);
    assert.equal(registry.get('submit_receipt').effect, EFFECTS.SUBMIT);
  });

  it('exposes only permitted task subset to each provider', () => {
    const registry = createDefaultRegistry();

    // Task with write capability exposes propose_patch
    const writeTask = {
      scope: { readPaths: ['src/a.txt'], writePaths: ['src/a.txt'] }
    };
    const writePermitted = registry.getPermittedToolNames(writeTask);
    assert.ok(writePermitted.includes('propose_patch'));
    assert.ok(writePermitted.includes('read_slice'));
    assert.ok(writePermitted.includes('list_paths'));
    assert.ok(writePermitted.includes('search'));
    assert.ok(writePermitted.includes('run_check'));
    assert.ok(writePermitted.includes('submit_receipt'));
    assert.ok(!writePermitted.includes('check_command')); // extension excluded by default

    // Read-only task excludes propose_patch
    const readOnlyTask = {
      scope: { readPaths: ['src/a.txt'], writePaths: [] }
    };
    const readOnlyPermitted = registry.getPermittedToolNames(readOnlyTask);
    assert.ok(!readOnlyPermitted.includes('propose_patch'), 'Read-only task must not expose propose_patch');
    assert.ok(readOnlyPermitted.includes('read_slice'));
    assert.ok(readOnlyPermitted.includes('list_paths'));

    // Options.enableExtensions exposes extension tools
    const extPermitted = registry.getPermittedToolNames(writeTask, { enableExtensions: true });
    assert.ok(extPermitted.includes('check_command'));
    assert.ok(extPermitted.includes('git_readonly'));
  });

  it('intersects explicit options.tools with write capability: read-only tasks never advertise propose_patch', () => {
    const registry = createDefaultRegistry();
    const readOnlyTask = {
      scope: { readPaths: ['src/a.txt'], writePaths: [] }
    };
    // Explicitly requested propose_patch on read-only task must be stripped
    const permitted = registry.getPermittedToolNames(readOnlyTask, {
      tools: ['read_slice', 'propose_patch', 'run_check']
    });
    assert.deepEqual(permitted, ['read_slice', 'run_check']);
    assert.ok(!permitted.includes('propose_patch'), 'propose_patch must NOT be exposed for read-only tasks');

    // Schemas must not expose propose_patch
    const schemas = registry.getSchemas(permitted);
    assert.equal(schemas.length, 2);
    assert.ok(schemas.every(s => s.function.name !== 'propose_patch'));
  });

  it('generates valid provider tool schemas', () => {
    const registry = createDefaultRegistry();
    const schemas = registry.getSchemas(['read_slice', 'propose_patch']);
    assert.equal(schemas.length, 2);
    assert.equal(schemas[0].type, 'function');
    assert.equal(schemas[0].function.name, 'read_slice');
    assert.equal(schemas[0].function.parameters.type, 'object');
    assert.ok(schemas[0].function.parameters.properties.path);
    assert.equal(schemas[1].function.name, 'propose_patch');
    assert.ok(schemas[1].function.parameters.properties.expectedSha256);
  });
});

describe('Offline Denial Proofs: Handlers Are Never Invoked on Failure', () => {
  async function withFixture(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rct-tool-registry-test-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'sample.txt'), 'hello world\n');
      const workspace = new ScopedWorkspace(root, {
        readPaths: ['src/sample.txt'],
        writePaths: ['src/sample.txt']
      }, {
        maxReadBytes: 100,
        maxWriteBytes: 100
      });
      return await fn(root, workspace);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('DENIAL: Handler is never invoked when capability is not granted to task', () => withFixture(async (root, workspace) => {
    let handlerInvoked = false;
    const registry = new ToolRegistry();
    registry.register({
      name: 'restricted_tool',
      description: 'Restricted capability tool',
      effect: EFFECTS.WRITE,
      capability: 'special:privileged_write',
      schema: { type: 'object', properties: {} },
      async execute() {
        handlerInvoked = true;
        return { ok: true };
      }
    });

    // Workspace with no write capability
    const readOnlyWorkspace = new ScopedWorkspace(root, {
      readPaths: ['src/sample.txt'],
      writePaths: []
    });

    await assert.rejects(
      registry.execute({ name: 'restricted_tool', args: {} }, { workspace: readOnlyWorkspace }),
      /task does not have write capability/
    );
    assert.equal(handlerInvoked, false, 'Handler must NOT be invoked when capability is missing');
  }));

  it('DENIAL: Handler is never invoked when path scope fails', () => withFixture(async (root, workspace) => {
    let readHandlerInvoked = false;
    const originalReadSlice = workspace.readSlice.bind(workspace);
    workspace.readSlice = async (...args) => {
      readHandlerInvoked = true;
      return originalReadSlice(...args);
    };

    const registry = createDefaultRegistry();

    // 1. Path outside scope
    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: 'src/secret.txt' } }, { workspace }),
      /Path outside assignment scope/
    );
    assert.equal(readHandlerInvoked, false, 'readSlice handler must NOT be invoked for out-of-scope path');

    // 2. Traversal path
    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: '../escape.txt' } }, { workspace }),
      /Invalid relative path/
    );
    assert.equal(readHandlerInvoked, false, 'readSlice handler must NOT be invoked for traversal path');

    // 3. Propose patch on write-prohibited path
    let writeHandlerInvoked = false;
    const originalProposePatch = workspace.proposePatch.bind(workspace);
    workspace.proposePatch = async (...args) => {
      writeHandlerInvoked = true;
      return originalProposePatch(...args);
    };

    const readOnlyWs = new ScopedWorkspace(root, {
      readPaths: ['src/sample.txt'],
      writePaths: []
    });

    await assert.rejects(
      registry.execute({ name: 'propose_patch', args: { path: 'src/sample.txt', expectedSha256: 'a'.repeat(64), content: 'x' } }, { workspace: readOnlyWs }),
      /write capability/
    );
    assert.equal(writeHandlerInvoked, false, 'proposePatch handler must NOT be invoked on read-only workspace');
  }));

  it('DENIAL: Handler is never invoked when per-call budget or input validation fails', () => withFixture(async (root, workspace) => {
    let readHandlerInvoked = false;
    workspace.readSlice = async () => {
      readHandlerInvoked = true;
    };

    const registry = createDefaultRegistry();

    // Negative start
    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: 'src/sample.txt', start: -5 } }, { workspace }),
      /Invalid slice/
    );
    assert.equal(readHandlerInvoked, false, 'Handler must NOT be invoked for negative start');

    // Invalid length
    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: 'src/sample.txt', length: 0 } }, { workspace }),
      /Invalid slice/
    );
    assert.equal(readHandlerInvoked, false, 'Handler must NOT be invoked for zero length');

    // Invalid search term
    let searchHandlerInvoked = false;
    workspace.search = async () => { searchHandlerInvoked = true; };
    await assert.rejects(
      registry.execute({ name: 'search', args: { term: 'a' } }, { workspace }),
      /Invalid search term/
    );
    assert.equal(searchHandlerInvoked, false, 'Handler must NOT be invoked for 1-char search term');

    // Patch exceeding maximum pilot size limit (65536 bytes)
    let patchHandlerInvoked = false;
    workspace.proposePatch = async () => { patchHandlerInvoked = true; };
    const oversizedContent = 'x'.repeat(70000);
    await assert.rejects(
      registry.execute({ name: 'propose_patch', args: { path: 'src/sample.txt', expectedSha256: '0'.repeat(64), content: oversizedContent } }, { workspace }),
      /File exceeds pilot size limit/
    );
    assert.equal(patchHandlerInvoked, false, 'Handler must NOT be invoked for oversized patch content');
  }));

  it('DENIAL: Handler is never invoked when cumulative budget is exhausted', () => withFixture(async (root, workspace) => {
    let readHandlerInvoked = false;
    workspace.readSlice = async () => { readHandlerInvoked = true; };

    const registry = createDefaultRegistry();

    // Exhaust read budget manually
    workspace.readBytes = 100; // maxReadBytes is 100

    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: 'src/sample.txt', start: 0, length: 10 } }, { workspace }),
      /Read budget exhausted/
    );
    assert.equal(readHandlerInvoked, false, 'Handler must NOT be invoked when read budget is exhausted');

    // Exhaust write budget
    let writeHandlerInvoked = false;
    workspace.proposePatch = async () => { writeHandlerInvoked = true; };
    workspace.writeBytes = 90; // maxWriteBytes is 100; patch of 20 bytes exceeds

    await assert.rejects(
      registry.execute({ name: 'propose_patch', args: { path: 'src/sample.txt', expectedSha256: 'a'.repeat(64), content: 'x'.repeat(20) } }, { workspace }),
      /Write budget exhausted/
    );
    assert.equal(writeHandlerInvoked, false, 'Handler must NOT be invoked when write budget is exhausted');
  }));

  it('DENIAL: Preflight budget boundary check enforces prospective read bytes before handler invocation', () => withFixture(async (root, workspace) => {
    let readHandlerInvoked = false;
    workspace.readSlice = async () => {
      readHandlerInvoked = true;
      return { content: 'he', bytes: 2, totalBytes: 12, start: 0, length: 2 };
    };

    const registry = createDefaultRegistry();
    // workspace maxReadBytes is 100. Set used bytes to 99:
    workspace.readBytes = 99;

    // A 2-byte read on 12-byte file has prospective bytes = 2. 99 + 2 = 101 > 100.
    await assert.rejects(
      registry.execute({ name: 'read_slice', args: { path: 'src/sample.txt', start: 0, length: 2 } }, { workspace }),
      /Read budget exhausted/
    );
    assert.equal(readHandlerInvoked, false, 'readSlice stub handler must NOT be invoked when prospective read exceeds budget');
  }));

  it('DENIAL: Handler is never invoked when injected authority denies invocation', () => withFixture(async (root, workspace) => {
    let handlerInvoked = false;
    workspace.listPaths = async () => { handlerInvoked = true; return []; };

    // Injected authority that blocks all actions
    const rejectingAuthority = new AuthorityPort(() => ({
      allowed: false,
      reason: 'Policy gate: explicit security denial'
    }));

    const registry = createDefaultRegistry({ authority: rejectingAuthority });

    await assert.rejects(
      registry.execute({ name: 'list_paths', args: {} }, { workspace }),
      /Policy gate: explicit security denial/
    );
    assert.equal(handlerInvoked, false, 'Handler must NOT be invoked when authority denies invocation');
  }));

  it('DENIAL: Extension ports fail closed by default with unconfigured authority', () => withFixture(async (root, workspace) => {
    let checkHandlerInvoked = false;
    let gitHandlerInvoked = false;

    const registry = createDefaultRegistry(); // Default authority has fail-closed default for non-baseline effects

    // 1. check_command fails closed
    await assert.rejects(
      registry.execute({ name: 'check_command', args: { profile: 'test' } }, { workspace }),
      /Unauthorized effect 'execute'.*fail-closed default/
    );
    assert.equal(checkHandlerInvoked, false, 'check_command must NOT run with default authority');

    // 2. git_readonly fails closed
    await assert.rejects(
      registry.execute({ name: 'git_readonly', args: { subcommand: 'status' } }, { workspace }),
      /Unauthorized effect 'execute_read'.*fail-closed default/
    );
    assert.equal(gitHandlerInvoked, false, 'git_readonly must NOT run with default authority');
  }));
});

describe('Extension Ports: Fixed Check Commands and Read-Only Git', () => {
  it('check_command rejects arbitrary worker args, switches, node loading/eval flags, and traversal', () => {
    // Unsupported profiles
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'arbitrary_shell' }),
      /Unsupported check profile/
    );

    // Node loading / eval switches and worker flags
    const forbiddenSwitches = [
      ['--import', '../../outside.mjs'],
      ['-r', 'malicious.js'],
      ['-e', 'process.exit(1)'],
      ['--eval', '1'],
      ['--require', 'dep'],
      ['--loader', 'custom']
    ];
    for (const [flag, argVal] of forbiddenSwitches) {
      assert.throws(
        () => checkCommandTool.validateArgs({ profile: 'test', args: [flag, argVal] }),
        /Worker-specified switches and options are forbidden/,
        `Should reject flag: ${flag}`
      );
    }

    // Traversal paths rejected by cleanRelative
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'test', args: ['../../outside.mjs'] }),
      /Invalid relative path/
    );

    // Shell metacharacters and injections rejected
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'test', args: ['arg1; rm -rf /'] }),
      /Unsafe argument rejected/
    );
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'test', args: ['$(cat /etc/passwd)'] }),
      /Unsafe argument rejected/
    );
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'test', args: ['> output.txt'] }),
      /Unsafe argument rejected/
    );

    // Excessive args
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'test', args: Array.from({ length: 11 }, (_, i) => `file_${i}.js`) }),
      /max 10 entries allowed/
    );
  });

  it('check_command removes fake-success profiles (build, typecheck) and exposes only immutable supervisor profiles', () => {
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'build' }),
      /Check profile 'build' is unavailable: fake-success profiles removed/
    );
    assert.throws(
      () => checkCommandTool.validateArgs({ profile: 'typecheck' }),
      /Check profile 'typecheck' is unavailable: fake-success profiles removed/
    );

    assert.deepEqual(Object.keys(CHECK_COMMAND_PROFILES), ['test', 'lint']);
    assert.ok(Object.isFrozen(CHECK_COMMAND_PROFILES));
    assert.ok(Object.isFrozen(CHECK_COMMAND_PROFILES.test));
    assert.ok(Object.isFrozen(CHECK_COMMAND_PROFILES.lint));
  });

  it('check_command enforces checkScope on target paths', () => {
    const ws = { allowed: new Set(['src/sample.js']) };

    // Single path out of scope
    assert.throws(
      () => checkCommandTool.checkScope({ profile: 'test', path: 'src/secret.js' }, { workspace: ws }),
      /Path outside assignment scope: 'src\/secret\.js'/
    );

    // Args list contains path out of scope
    assert.throws(
      () => checkCommandTool.checkScope({ profile: 'test', args: ['src/secret.js'] }, { workspace: ws }),
      /Path outside assignment scope: 'src\/secret\.js'/
    );

    // Allowed path passes scope check
    assert.doesNotThrow(
      () => checkCommandTool.checkScope({ profile: 'test', path: 'src/sample.js' }, { workspace: ws })
    );
  });

  it('check_command DENIAL PROOF: denied requests never spawn a subprocess', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: '', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });
    const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 0, maxReadBytes: 10000 };

    // 1. Worker tries loading switch --import: rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'test', args: ['--import', '../../outside.mjs'] } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /Worker-specified switches and options are forbidden/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on forbidden switch');

    // 2. Worker tries out-of-scope path: rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'test', path: 'src/secret.js' } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /Path outside assignment scope/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on out-of-scope path');

    // 3. Worker tries fake profile 'build': rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'build' } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /fake-success profiles removed/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on fake profile');
  });

  it('git_readonly rejects non-status subcommands and worker-specified options', () => {
    // Non-status subcommands are rejected
    for (const sub of ['diff', 'commit', 'push', 'checkout', 'reset', 'log']) {
      assert.throws(
        () => gitReadonlyTool.validateArgs({ subcommand: sub }),
        /only scoped 'status' is permitted/,
        `Should reject non-status subcommand: ${sub}`
      );
    }

    // Worker flags starting with '-' are rejected
    for (const flag of ['--exec-path=/tmp', '--output=/tmp/leak', '-c', '--no-index', '-p']) {
      assert.throws(
        () => gitReadonlyTool.validateArgs({ subcommand: 'status', args: [flag] }),
        /Worker-specified git options and flags are forbidden/,
        `Should reject flag: ${flag}`
      );
    }

    // Traversal in path
    assert.throws(
      () => gitReadonlyTool.validateArgs({ subcommand: 'status', path: '../escape.txt' }),
      /Invalid relative path/
    );
  });

  it('git_readonly enforces checkScope on target paths', () => {
    const ws = { allowed: new Set(['src/sample.txt']) };

    // Path out of scope
    assert.throws(
      () => gitReadonlyTool.checkScope({ subcommand: 'status', path: 'src/secret.txt' }, { workspace: ws }),
      /Path outside assignment scope: 'src\/secret\.txt'/
    );

    // Args list contains path out of scope
    assert.throws(
      () => gitReadonlyTool.checkScope({ subcommand: 'status', args: ['src/secret.txt'] }, { workspace: ws }),
      /Path outside assignment scope: 'src\/secret\.txt'/
    );

    // Allowed path passes scope check
    assert.doesNotThrow(
      () => gitReadonlyTool.checkScope({ subcommand: 'status', path: 'src/sample.txt' }, { workspace: ws })
    );
  });

  it('git_readonly DENIAL PROOF: denied requests never spawn a subprocess', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: '', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });
    const ws = { allowed: new Set(['src/sample.txt']), root: process.cwd(), readBytes: 0, maxReadBytes: 10000 };

    // 1. Worker tries diff: rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'git_readonly', args: { subcommand: 'diff' } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /only scoped 'status' is permitted/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on non-status subcommand');

    // 2. Worker tries flag --no-index: rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'git_readonly', args: { subcommand: 'status', args: ['--no-index'] } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /Worker-specified git options and flags are forbidden/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on worker flag');

    // 3. Worker queries out-of-scope path: rejected before execute
    await assert.rejects(
      registry.execute(
        { name: 'git_readonly', args: { subcommand: 'status', path: 'src/secret.txt' } },
        { workspace: ws, execFile: spyExecFile }
      ),
      /Path outside assignment scope/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned on out-of-scope path');
  });

  it('executes check_command and git_readonly with neutralized effects and bounded outputs when explicitly authorized', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: 'scoped-output\n', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(({ effect }) => ({
      allowed: true,
      reason: `Authorized effect ${effect}`
    }));

    const registry = createDefaultRegistry({ authority: permissiveAuthority });
    const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 0, maxReadBytes: 10000 };

    // Authorized check_command with immutable lint profile
    const checkRes = await registry.execute(
      { name: 'check_command', args: { profile: 'lint', path: 'src/sample.js' } },
      { workspace: ws, execFile: spyExecFile }
    );
    assert.equal(checkRes.ok, true);
    assert.equal(checkRes.exitCode, 0);
    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0].file, process.execPath);
    assert.deepEqual(execCalls[0].args, ['--check', '--', 'src/sample.js']);

    // Authorized git_readonly status with neutralized process effects
    const gitRes = await registry.execute(
      { name: 'git_readonly', args: { subcommand: 'status', path: 'src/sample.js' } },
      { workspace: ws, execFile: spyExecFile }
    );
    assert.equal(gitRes.ok, true);
    assert.equal(gitRes.subcommand, 'status');
    assert.equal(execCalls.length, 2);
    assert.equal(execCalls[1].file, 'git');

    // Verify process effect neutralization flags are fixed and present
    const gitArgs = execCalls[1].args;
    assert.ok(gitArgs.includes('core.fsmonitor=false'), 'Neutralized core.fsmonitor');
    assert.ok(gitArgs.includes('fsmonitor.allowRemote=false'), 'Neutralized fsmonitor.allowRemote');
    assert.ok(gitArgs.includes('submodule.recurse=false'), 'Neutralized submodule.recurse');
    assert.ok(gitArgs.includes('status.submoduleSummary=false'), 'Neutralized status.submoduleSummary');
    assert.ok(gitArgs.includes('core.hooksPath='), 'Neutralized core.hooksPath');
    assert.ok(gitArgs.includes('core.pager=cat'), 'Neutralized core.pager');
    assert.ok(gitArgs.includes('diff.external='), 'Neutralized diff.external');
    assert.ok(gitArgs.includes('diff.textconv=false'), 'Neutralized diff.textconv');
    assert.ok(gitArgs.includes('credential.helper='), 'Neutralized credential.helper');
    assert.ok(gitArgs.includes('--porcelain=v1'), 'Enforced porcelain=v1');
    assert.ok(gitArgs.includes('--ignore-submodules=all'), 'Enforced --ignore-submodules=all');
    assert.ok(gitArgs.includes('--'), 'Enforced argument delimiter --');
    assert.ok(gitArgs.includes('src/sample.js'), 'Scoped to target path');
    assert.equal(execCalls[1].opts.env.GIT_CONFIG_NOSYSTEM, '1', 'Disabled system git config');
    assert.equal(execCalls[1].opts.env.GIT_OPTIONAL_LOCKS, '0', 'Disabled git optional locks');
    assert.equal(execCalls[1].opts.env.GIT_TERMINAL_PROMPT, '0', 'Disabled git terminal prompt');
  });

  it('check_command DENIAL PROOF: missing workspace or omitted targets without scope fail closed before spawn', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: '', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });

    // 1. Missing workspace: fails closed before spawn
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'test' } },
        { execFile: spyExecFile }
      ),
      /Execution failed closed: workspace scope is missing or empty/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned when workspace is missing');

    // 2. Empty allowed scope: fails closed before spawn
    const emptyWs = { allowed: new Set([]), root: process.cwd() };
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'test' } },
        { workspace: emptyWs, execFile: spyExecFile }
      ),
      /Execution failed closed: workspace scope is missing or empty/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned when scope is empty');

    // 3. Omitted target when no test files exist in scope: fails closed before spawn
    // (Proves unconfined node --test discovery is NEVER spawned)
    const noTestWs = { allowed: new Set(['src/sample.js']), root: process.cwd() };
    await assert.rejects(
      registry.execute(
        { name: 'check_command', args: { profile: 'test' } },
        { workspace: noTestWs, execFile: spyExecFile }
      ),
      /No supervisor-approved test targets found in assignment scope/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned for unconfined test discovery');

    // 4. Omitted target with valid test files in scope: derives exact nonempty scope
    const testWs = { allowed: new Set(['test/sample.test.js']), root: process.cwd(), readBytes: 0, maxReadBytes: 10000 };
    const res = await registry.execute(
      { name: 'check_command', args: { profile: 'test' } },
      { workspace: testWs, execFile: spyExecFile }
    );
    assert.equal(res.ok, true);
    assert.equal(execCalls.length, 1);
    assert.deepEqual(execCalls[0].args, ['--test', '--', 'test/sample.test.js'], 'Exact test target derived from scope');
  });

  it('git_readonly DENIAL PROOF: missing workspace or empty scope fail closed before spawn', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: '', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });

    // 1. Missing workspace: fails closed before spawn
    await assert.rejects(
      registry.execute(
        { name: 'git_readonly', args: { subcommand: 'status' } },
        { execFile: spyExecFile }
      ),
      /Execution failed closed: workspace scope is missing or empty/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned when workspace is missing');

    // 2. Empty allowed scope: fails closed before spawn
    const emptyWs = { allowed: new Set([]), root: process.cwd() };
    await assert.rejects(
      registry.execute(
        { name: 'git_readonly', args: { subcommand: 'status' } },
        { workspace: emptyWs, execFile: spyExecFile }
      ),
      /Execution failed closed: workspace scope is missing or empty/
    );
    assert.equal(execCalls.length, 0, 'No subprocess spawned when scope is empty');

    // 3. Omitted target with valid scope: derives exact nonempty targets, never inspects entire repository
    const ws = { allowed: new Set(['src/sample.txt']), root: process.cwd(), readBytes: 0, maxReadBytes: 10000 };
    const res = await registry.execute(
      { name: 'git_readonly', args: { subcommand: 'status' } },
      { workspace: ws, execFile: spyExecFile }
    );
    assert.equal(res.ok, true);
    assert.equal(execCalls.length, 1);
    assert.ok(execCalls[0].args.includes('--'), 'Enforced delimiter');
    assert.ok(execCalls[0].args.includes('src/sample.txt'), 'Exact scoped target derived');
  });

  it('enforces read budget and unified output accounting on failed, timeout, and overflow result paths', async () => {
    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });

    // 1. Process fails with exitCode 1 and 200 bytes of output when remaining budget is 10 bytes
    {
      const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 90, maxReadBytes: 100 };
      const failSpy = (file, args, opts, cb) => {
        const err = new Error('Command failed: non-zero exit');
        err.code = 1;
        err.stdout = 'x'.repeat(100);
        err.stderr = 'y'.repeat(100);
        cb(err);
      };

      const res = await registry.execute(
        { name: 'check_command', args: { profile: 'lint', path: 'src/sample.js' } },
        { workspace: ws, execFile: failSpy }
      );
      assert.equal(res.ok, false);
      assert.equal(res.exitCode, 1);
      const outputBytes = Buffer.byteLength(res.stdout, 'utf8') + Buffer.byteLength(res.stderr, 'utf8');
      assert.equal(outputBytes, 10, 'Failure output must be strictly bounded to remaining budget (10 bytes, not 200 bytes)');
      assert.equal(ws.readBytes, 100, 'Workspace readBytes must be accurately charged to budget ceiling');
    }

    // 2. Process times out (ETIMEDOUT) with 200 bytes of error text when remaining budget is 10 bytes
    {
      const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 90, maxReadBytes: 100 };
      const timeoutSpy = (file, args, opts, cb) => {
        const err = new Error('ETIMEDOUT: process timed out');
        err.code = 'ETIMEDOUT';
        err.stdout = 'a'.repeat(100);
        err.stderr = 'b'.repeat(100);
        cb(err);
      };

      const res = await registry.execute(
        { name: 'check_command', args: { profile: 'lint', path: 'src/sample.js' } },
        { workspace: ws, execFile: timeoutSpy }
      );
      assert.equal(res.ok, false);
      const outputBytes = Buffer.byteLength(res.stdout, 'utf8') + Buffer.byteLength(res.stderr, 'utf8');
      assert.equal(outputBytes, 10, 'Timeout output must obey remaining budget of 10 bytes');
      assert.equal(ws.readBytes, 100, 'Workspace readBytes must be accurately charged');
    }

    // 3. Process buffer overflows (maxBuffer exceeded) with 200 bytes when remaining budget is 10 bytes
    {
      const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 90, maxReadBytes: 100 };
      const overflowSpy = (file, args, opts, cb) => {
        const err = new Error('ERR_CHILD_PROCESS_STDIO_MAXBUFFER: maxBuffer exceeded');
        err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        err.stdout = 'c'.repeat(200);
        cb(err);
      };

      const res = await registry.execute(
        { name: 'check_command', args: { profile: 'lint', path: 'src/sample.js' } },
        { workspace: ws, execFile: overflowSpy }
      );
      assert.equal(res.ok, false);
      const outputBytes = Buffer.byteLength(res.stdout, 'utf8') + Buffer.byteLength(res.stderr, 'utf8');
      assert.equal(outputBytes, 10, 'Buffer overflow output must obey remaining budget of 10 bytes');
      assert.equal(ws.readBytes, 100, 'Workspace readBytes must be accurately charged');
    }

    // 4. git_readonly failure with 200 bytes when remaining budget is 10 bytes
    {
      const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 90, maxReadBytes: 100 };
      const gitFailSpy = (file, args, opts, cb) => {
        const err = new Error('fatal: git failure');
        err.code = 128;
        err.stderr = 'g'.repeat(200);
        cb(err);
      };

      const res = await registry.execute(
        { name: 'git_readonly', args: { subcommand: 'status', path: 'src/sample.js' } },
        { workspace: ws, execFile: gitFailSpy }
      );
      assert.equal(res.ok, false);
      assert.equal(res.exitCode, 128);
      const outputBytes = Buffer.byteLength(res.stdout, 'utf8') + Buffer.byteLength(res.stderr, 'utf8');
      assert.equal(outputBytes, 10, 'git_readonly failure output must obey remaining budget of 10 bytes');
      assert.equal(ws.readBytes, 100, 'Workspace readBytes must be accurately charged');
    }

    // 5. Read budget fully exhausted (readBytes >= maxReadBytes) throws 'Read budget exhausted'
    {
      const ws = { allowed: new Set(['src/sample.js']), root: process.cwd(), readBytes: 100, maxReadBytes: 100 };
      const dummySpy = (f, a, o, cb) => cb(null, { stdout: '', stderr: '' });

      await assert.rejects(
        registry.execute(
          { name: 'check_command', args: { profile: 'lint', path: 'src/sample.js' } },
          { workspace: ws, execFile: dummySpy }
        ),
        /Read budget exhausted/
      );
      await assert.rejects(
        registry.execute(
          { name: 'git_readonly', args: { subcommand: 'status', path: 'src/sample.js' } },
          { workspace: ws, execFile: dummySpy }
        ),
        /Read budget exhausted/
      );
    }
  });

  it('boundAndAccountOutput clips valid UTF-8 and clamps remainder >= 0 without negative slicing or byte expansion', () => {
    // 1. Budget 1: stdout is multi-byte 'é' (2 bytes), stderr is 'abcdef' (6 bytes).
    // Naive buffer slicing would emit replacement char \uFFFD (3 bytes), leaving remainder = 1 - 3 = -2,
    // which in Buffer.subarray(0, -2) slices from the buffer tail, returning 7 bytes on a 1-byte budget.
    // clipUtf8 must clip 'é' to empty string '', clamp remainder to 1, and clip stderr to 'a' (1 byte total).
    {
      const ws = { readBytes: 0, maxReadBytes: 1 };
      const res = boundAndAccountOutput('é', 'abcdef', { workspace: ws });
      assert.equal(res.stdout, '');
      assert.equal(res.stderr, 'a');
      assert.equal(res.bytes, 1);
      assert.equal(Buffer.byteLength(res.stdout + res.stderr, 'utf8'), 1);
      assert.equal(ws.readBytes, 1);
    }

    // 2. Budget 3: stdout is 'é' (2 bytes), stderr is 'abcdef' (6 bytes).
    // stdout fits (2 bytes). Remainder is 3 - 2 = 1. stderr takes 1 byte ('a'). Total = 3 bytes.
    {
      const ws = { readBytes: 0, maxReadBytes: 3 };
      const res = boundAndAccountOutput('é', 'abcdef', { workspace: ws });
      assert.equal(res.stdout, 'é');
      assert.equal(res.stderr, 'a');
      assert.equal(res.bytes, 3);
      assert.equal(Buffer.byteLength(res.stdout + res.stderr, 'utf8'), 3);
      assert.equal(ws.readBytes, 3);
    }

    // 3. Multi-byte surrogate/emoji '🚀' (4 bytes) with budget 3.
    // Cannot split 4-byte emoji, so stdout must be empty '', remainder is 3, stderr takes 3 bytes ('abc').
    {
      const ws = { readBytes: 0, maxReadBytes: 3 };
      const res = boundAndAccountOutput('🚀', 'abcdef', { workspace: ws });
      assert.equal(res.stdout, '');
      assert.equal(res.stderr, 'abc');
      assert.equal(res.bytes, 3);
      assert.equal(Buffer.byteLength(res.stdout + res.stderr, 'utf8'), 3);
      assert.equal(ws.readBytes, 3);
    }

    // 4. Standalone clipUtf8 contract: never emits replacement characters or invalid sequences
    assert.equal(clipUtf8('é', 1), '');
    assert.equal(clipUtf8('é', 2), 'é');
    assert.equal(clipUtf8('🚀', 3), '');
    assert.equal(clipUtf8('🚀', 4), '🚀');
    assert.equal(clipUtf8('hello', 3), 'hel');
    assert.equal(clipUtf8('', 10), '');
    assert.equal(clipUtf8('abc', 0), '');
    assert.equal(clipUtf8('abc', -1), '');

    // 5. Cumulative budget exhaustion across calls clamps properly
    {
      const ws = { readBytes: 99, maxReadBytes: 100 };
      const res1 = boundAndAccountOutput('é', 'abcdef', { workspace: ws });
      assert.equal(res1.bytes, 1);
      assert.equal(ws.readBytes, 100);
      assert.throws(() => {
        boundAndAccountOutput('a', 'b', { workspace: ws });
      }, /Read budget exhausted/);
    }
  });

  it('check_command and git_readonly prefix derived targets starting with hyphen and emit safe delimiter in argv', async () => {
    const execCalls = [];
    const spyExecFile = (file, args, opts, cb) => {
      execCalls.push({ file, args, opts });
      cb(null, { stdout: 'ok', stderr: '' });
    };

    const permissiveAuthority = new AuthorityPort(() => ({ allowed: true }));
    const registry = createDefaultRegistry({ authority: permissiveAuthority });

    // Workspace containing a test file that begins with a hyphen (option-injection attack vector)
    const attackWs = {
      allowed: new Set(['-rload.test.js', 'normal.test.js']),
      root: process.cwd(),
      readBytes: 0,
      maxReadBytes: 10000
    };

    // 1. check_command with omitted targets derives test paths with safe ./ prefix and -- delimiter
    const checkRes = await registry.execute(
      { name: 'check_command', args: { profile: 'test' } },
      { workspace: attackWs, execFile: spyExecFile }
    );
    assert.equal(checkRes.ok, true);
    assert.equal(execCalls.length, 1);
    const checkArgs = execCalls[0].args;
    assert.equal(checkArgs[0], '--test');
    assert.equal(checkArgs[1], '--', 'Must insert safe delimiter -- before targets');
    assert.ok(checkArgs.includes('./-rload.test.js'), 'Leading-hyphen target must be prefixed with ./');
    assert.ok(checkArgs.includes('normal.test.js'), 'Normal target remains clean');
    assert.ok(!checkArgs.includes('-rload.test.js'), 'Raw hyphen-leading target must not appear directly in argv');

    // 2. git_readonly with omitted targets derives status paths with safe ./ prefix and -- delimiter
    const gitRes = await registry.execute(
      { name: 'git_readonly', args: { subcommand: 'status' } },
      { workspace: attackWs, execFile: spyExecFile }
    );
    assert.equal(gitRes.ok, true);
    assert.equal(execCalls.length, 2);
    const gitArgs = execCalls[1].args;
    const delimiterIdx = gitArgs.lastIndexOf('--');
    assert.ok(delimiterIdx !== -1, 'Must have delimiter --');
    const targetSlice = gitArgs.slice(delimiterIdx + 1);
    assert.ok(targetSlice.includes('./-rload.test.js'), 'Leading-hyphen target must be prefixed with ./ in git argv');
    assert.ok(targetSlice.includes('normal.test.js'), 'Normal target preserved');
    assert.ok(!targetSlice.includes('-rload.test.js'), 'Raw hyphen-leading target must not appear');
  });
});

describe('Integration: runAssignment with Capability Registry and Injected Authority', () => {
  async function withFixture(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rct-integration-registry-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
      return await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('injected authority denial halts assignment gracefully without tool execution', () => withFixture(async (root) => {
    const denyingAuthority = new AuthorityPort(() => ({
      allowed: false,
      reason: 'Authority blocked read operation'
    }));

    const provider = new FakeProvider([
      { name: 'read_slice', args: { path: 'src/greeting.txt' } }
    ]);

    const result = await runAssignment({
      objective: 'Test authority denial',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      budget: { maxTurns: 1 },
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, {
      isolated: true,
      authority: denyingAuthority
    });

    assert.equal(result.state, 'failed');
    assert.equal(result.events[0].ok, false);
    assert.ok(result.events[0].error.includes('Authority blocked read operation'));
    assert.equal(result.diffOutcome, 'empty');
  }));

  it('runs complete lifecycle through capability-based tool registry', () => withFixture(async (root) => {
    const provider = new FakeProvider([
      { name: 'list_paths', args: {} },
      { name: 'read_slice', args: { path: 'src/greeting.txt' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
      { name: 'submit_receipt', args: { summary: 'Patched successfully' } }
    ]);

    const result = await runAssignment({
      objective: 'Update greeting',
      acceptance: 'Greeting equals hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'review_ready');
    assert.equal(result.diffOutcome, 'applied');
    assert.deepEqual(result.changedPaths, ['src/greeting.txt']);
    assert.equal(result.events.length, 4);
    assert.ok(result.events.every(e => e.ok));
  }));
});
