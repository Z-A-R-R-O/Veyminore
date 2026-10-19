import path from 'node:path';
import { cleanRelative } from './workspace.js';

// Effects
export const EFFECTS = {
  READ: 'read',
  WRITE: 'write',
  VERIFY: 'verify',
  SUBMIT: 'submit',
  EXECUTE: 'execute',
  EXECUTE_READ: 'execute_read'
};

// Capabilities
export const CAPABILITIES = {
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  VERIFY_CHECK: 'verify:check',
  ATTEMPT_SUBMIT: 'attempt:submit',
  CHECK_EXECUTE: 'check:execute',
  GIT_READ: 'git:read'
};

// Supervisor-approved check command profiles (immutable)
// Fake-success profiles (build/typecheck) REMOVED.
export const CHECK_COMMAND_PROFILES = Object.freeze({
  test: Object.freeze({
    executable: process.execPath,
    fixedArgs: Object.freeze(['--test']),
    description: 'Run Node test runner on scoped test files'
  }),
  lint: Object.freeze({
    executable: process.execPath,
    fixedArgs: Object.freeze(['--check']),
    description: 'Run Node syntax validation on scoped files'
  })
});

// Injected Authority Port with Fail-Closed Default
export class AuthorityPort {
  constructor(evaluator = null, options = {}) {
    this.evaluator = evaluator;
    this.workspaceAdmission = options.workspaceAdmission || null;
  }

  async evaluate(request) {
    const { tool, effect, capability, args, assignment, workspace } = request;
    const admission = request.workspaceAdmission || this.workspaceAdmission || null;
    const sourceBaselineRoot = request.sourceBaselineRoot || admission?.sourceBaselineRoot || null;

    if (this.evaluator) {
      const enrichedRequest = {
        ...request,
        ...(admission ? { workspaceAdmission: admission } : {}),
        ...(sourceBaselineRoot ? { sourceBaselineRoot } : {})
      };
      if (typeof this.evaluator === 'function') {
        const res = await this.evaluator(enrichedRequest);
        return typeof res === 'boolean' ? { allowed: res } : res;
      }
      if (typeof this.evaluator.evaluate === 'function') {
        const res = await this.evaluator.evaluate(enrichedRequest);
        return typeof res === 'boolean' ? { allowed: res } : res;
      }
      if (typeof this.evaluator.evaluateSync === 'function') {
        const res = this.evaluator.evaluateSync(enrichedRequest);
        return typeof res === 'boolean' ? { allowed: res } : res;
      }
    }

    // Default policy:
    // If workspace admission is present, enforce identity and scope bounds
    if (admission) {
      if (workspace?.root) {
        if (path.resolve(workspace.root) === path.resolve(admission.sourceBaselineRoot)) {
          return { allowed: false, reason: 'source_baseline_mutation_denied' };
        }
        if (path.resolve(workspace.root) !== path.resolve(admission.canonicalRoot)) {
          return { allowed: false, reason: 'workspace_root_mismatch' };
        }
      }
      if (effect === EFFECTS.WRITE) {
        const targetPath = args?.path || args?.file;
        if (targetPath && !admission.scope.writePaths.includes(targetPath)) {
          return { allowed: false, reason: 'path_outside_write_scope' };
        }
      }
      if (effect === EFFECTS.READ) {
        const targetPath = args?.path || args?.file;
        if (targetPath && !admission.scope.readPaths.includes(targetPath) && !admission.scope.writePaths.includes(targetPath)) {
          return { allowed: false, reason: 'path_outside_read_scope' };
        }
      }
      if (effect === EFFECTS.EXECUTE || effect === EFFECTS.EXECUTE_READ) {
        if (admission.scope.commands) {
          const cmd = tool === 'git_readonly' ? 'git' : args?.profile;
          const isAllowed = admission.scope.commands.some(c => {
            if (typeof c === 'string') return c === cmd;
            if (Array.isArray(c)) return c[0] === cmd || c.includes(cmd);
            return false;
          });
          if (!isAllowed) {
            return { allowed: false, reason: 'command_not_permitted' };
          }
        }
      }
    }

    // Existing six baseline tools are permitted by task contract
    const BASELINE_EFFECTS = new Set([EFFECTS.READ, EFFECTS.WRITE, EFFECTS.VERIFY, EFFECTS.SUBMIT]);
    const BASELINE_TOOLS = new Set([
      'list_paths',
      'search',
      'read_slice',
      'propose_patch',
      'run_check',
      'submit_receipt'
    ]);

    if (BASELINE_TOOLS.has(tool) && BASELINE_EFFECTS.has(effect)) {
      return { allowed: true, reason: 'Baseline tool permitted by task contract' };
    }

    // Fail-closed default for any new or unknown effects (e.g. execute, execute_read)
    return {
      allowed: false,
      reason: `Unauthorized effect '${effect}' for tool '${tool}': fail-closed default requires explicit authority evaluation`
    };
  }
}

// Baseline Tool 1: list_paths
export const listPathsTool = {
  name: 'list_paths',
  description: 'List only the files permitted by this assignment.',
  effect: EFFECTS.READ,
  capability: CAPABILITIES.FILE_READ,
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  validateArgs(args) {
    if (args && typeof args !== 'object') throw new Error('Invalid tool call arguments');
  },
  checkScope() {},
  checkBudget() {},
  async execute(args, context) {
    return await context.workspace.listPaths();
  },
  formatResult(res) {
    return Array.isArray(res) ? res : [];
  }
};

// Baseline Tool 2: search
export const searchTool = {
  name: 'search',
  description: 'Find a literal term in allowed files; returns bounded offsets.',
  effect: EFFECTS.READ,
  capability: CAPABILITIES.FILE_READ,
  schema: {
    type: 'object',
    properties: {
      term: { type: 'string', description: 'Literal term to search for.' }
    },
    required: ['term'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool call');
    if (typeof args.term !== 'string' || args.term.length < 2 || args.term.length > 100) {
      throw new Error('Invalid search term');
    }
  },
  checkScope() {},
  checkBudget(args, context) {
    if (context.workspace && context.workspace.searchBytes >= context.workspace.maxReadBytes) {
      throw new Error('Search budget exhausted');
    }
  },
  async execute(args, context) {
    return await context.workspace.search(args.term);
  },
  formatResult(res) {
    return Array.isArray(res) ? res.slice(0, 20) : [];
  }
};

// Baseline Tool 3: read_slice
export const readSliceTool = {
  name: 'read_slice',
  description: 'Read a bounded byte slice from an allowed file (at most 4096 bytes per call).',
  effect: EFFECTS.READ,
  capability: CAPABILITIES.FILE_READ,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to an allowed file.' },
      start: { type: 'integer', minimum: 0, description: 'Starting byte offset (default 0).' },
      length: { type: 'integer', minimum: 1, maximum: 4096, description: 'Number of bytes to read (default 2048, maximum 4096).' }
    },
    required: ['path'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool call');
    if (typeof args.path !== 'string') throw new Error('Invalid relative path');
    cleanRelative(args.path);

    let start = args.start;
    if (start === undefined || start === null || start === '') {
      start = 0;
    } else if (typeof start === 'string' && /^\s*-?\d+\s*$/.test(start)) {
      start = Number(start.trim());
    }

    let length = args.length;
    if (length === undefined || length === null || length === '') {
      length = 2048;
    } else if (typeof length === 'string' && /^\s*-?\d+\s*$/.test(length)) {
      length = Number(length.trim());
    }

    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1) {
      throw new Error('Invalid slice');
    }
  },
  checkScope(args, context) {
    if (context.workspace) {
      const clean = cleanRelative(args.path);
      if (!context.workspace.allowed.has(clean)) {
        throw new Error('Path outside assignment scope');
      }
    }
  },
  async checkBudget(args, context) {
    if (context.workspace) {
      let length = 2048;
      if (args.length !== undefined && args.length !== null && args.length !== '') {
        const parsed = typeof args.length === 'string' ? Number(args.length.trim()) : args.length;
        if (Number.isSafeInteger(parsed) && parsed >= 1) {
          length = Math.min(parsed, 4096);
        }
      }

      if (context.workspace.readBytes >= context.workspace.maxReadBytes) {
        throw new Error('Read budget exhausted');
      }

      // Enforce actual/reserved budget boundary before handler invocation
      let prospectiveBytes = length;
      if (context.workspace.root && typeof args.path === 'string') {
        try {
          const clean = cleanRelative(args.path);
          if (context.workspace.allowed && context.workspace.allowed.has(clean)) {
            const resolved = await context.workspace.resolveFile(clean);
            const { stat } = await import('node:fs/promises');
            const st = await stat(resolved);
            const start = Math.max(0, Number(args.start) || 0);
            prospectiveBytes = Math.max(0, Math.min(st.size - start, length));
          }
        } catch (e) {
          if (e.message === 'Read budget exhausted') throw e;
        }
      }

      if (context.workspace.readBytes + prospectiveBytes > context.workspace.maxReadBytes) {
        throw new Error('Read budget exhausted');
      }
    }
  },
  async execute(args, context) {
    return await context.workspace.readSlice(args.path, args.start, args.length);
  },
  formatResult(res) {
    return res;
  }
};

// Baseline Tool 4: propose_patch
export const proposePatchTool = {
  name: 'propose_patch',
  description: 'Replace one allowed file in the isolated snapshot only when its SHA-256 preimage matches.',
  effect: EFFECTS.WRITE,
  capability: CAPABILITIES.FILE_WRITE,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to an allowed file.' },
      expectedSha256: { type: 'string', description: 'SHA-256 of the file content before patching.' },
      content: { type: 'string', description: 'Complete replacement content for the file.' }
    },
    required: ['path', 'expectedSha256', 'content'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool call');
    if (typeof args.path !== 'string') throw new Error('Invalid relative path');
    cleanRelative(args.path);
    if (typeof args.content !== 'string' || typeof args.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSha256)) {
      throw new Error('Invalid patch');
    }
    const bytes = Buffer.byteLength(args.content, 'utf8');
    if (bytes > 65536) {
      throw new Error('File exceeds pilot size limit');
    }
  },
  checkScope(args, context) {
    if (context.workspace) {
      const clean = cleanRelative(args.path);
      if (!context.workspace.allowed.has(clean)) {
        throw new Error('Path outside assignment scope');
      }
      if (!context.workspace.writePaths.has(clean)) {
        throw new Error('Path not in write scope');
      }
    }
  },
  checkBudget(args, context) {
    if (context.workspace && typeof args.content === 'string') {
      const bytes = Buffer.byteLength(args.content, 'utf8');
      if (context.workspace.writeBytes + bytes > context.workspace.maxWriteBytes) {
        throw new Error('Write budget exhausted');
      }
    }
  },
  async execute(args, context) {
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    const patch = await context.workspace.proposePatch(args.path, args.expectedSha256, args.content, context.signal);
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (patch.applied) {
      if (context.onPatchApplied) context.onPatchApplied(patch);
    } else {
      if (context.onNoopPatch) context.onNoopPatch();
    }
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    const checks = await context.verify(context.workspace, context.assignment.checks);
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    const result = { ...patch, checks };
    if (context.options?.autoFinalizeOnChecks === true && (await context.hasValidEffectivePatch()) && context.assignment.checks.every(x => x.type === 'equals') && checks.every(x => x.passed)) {
      if (context.onAutoFinalize) context.onAutoFinalize();
    }
    if (context.getRepeatedNoops && context.getRepeatedNoops() >= 2 && checks.some(x => !x.passed)) {
      if (context.onRepeatedNoops) context.onRepeatedNoops();
    }
    return result;
  },
  formatResult(res) {
    return res;
  }
};

// Baseline Tool 5: run_check
export const runCheckTool = {
  name: 'run_check',
  description: 'Run the fixed independent acceptance checks on the isolated snapshot.',
  effect: EFFECTS.VERIFY,
  capability: CAPABILITIES.VERIFY_CHECK,
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  validateArgs(args) {
    if (args && typeof args !== 'object') throw new Error('Invalid tool call arguments');
  },
  checkScope() {},
  checkBudget() {},
  async execute(args, context) {
    const checks = await context.verify(context.workspace, context.assignment.checks);
    return { checks };
  },
  formatResult(res) {
    return res;
  }
};

// Baseline Tool 6: submit_receipt
export const submitReceiptTool = {
  name: 'submit_receipt',
  description: 'Finish the attempt with a concise work summary. Independent checks determine the result.',
  effect: EFFECTS.SUBMIT,
  capability: CAPABILITIES.ATTEMPT_SUBMIT,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Concise summary of the work done.' }
    },
    required: ['summary'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool call');
  },
  checkScope() {},
  checkBudget() {},
  async execute(args, context) {
    const checks = await context.verify(context.workspace, context.assignment.checks);
    const validPatch = await context.hasValidEffectivePatch();
    const allChecksPassed = checks.every(x => x.passed);
    const result = { submitted: validPatch && allChecksPassed, checks };
    if (result.submitted) {
      if (context.onSubmitSuccess) context.onSubmitSuccess(args.summary);
    } else if (allChecksPassed && !validPatch) {
      if (context.onSubmitEmptyDiff) context.onSubmitEmptyDiff(args.summary);
    }
    return result;
  },
  formatResult(res) {
    return res;
  }
};

// Safely clip string to valid UTF-8 byte limit without replacement character expansion
export function clipUtf8(str, maxBytes) {
  if (!str || maxBytes <= 0) return '';
  let result = '';
  let currentBytes = 0;
  for (const ch of String(str)) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > maxBytes) break;
    result += ch;
    currentBytes += chBytes;
  }
  return result;
}

// Accounting & output bounding helper for process executions (unified across success, failure, timeout, and overflow)
export function boundAndAccountOutput(rawStdout, rawStderr, context) {
  const maxPerCall = 8192;
  let remainingBudget = maxPerCall;

  if (context.workspace) {
    const maxRead = context.workspace.maxReadBytes ?? 8192;
    const currentRead = context.workspace.readBytes ?? 0;
    remainingBudget = Math.max(0, maxRead - currentRead);

    if (remainingBudget <= 0) {
      throw new Error('Read budget exhausted');
    }
    remainingBudget = Math.min(remainingBudget, maxPerCall);
  }

  const finalStdout = clipUtf8(rawStdout, remainingBudget);
  const remainingForStderr = Math.max(0, remainingBudget - Buffer.byteLength(finalStdout, 'utf8'));
  const finalStderr = clipUtf8(rawStderr, remainingForStderr);

  const actualBytes = Buffer.byteLength(finalStdout, 'utf8') + Buffer.byteLength(finalStderr, 'utf8');
  if (context.workspace) {
    context.workspace.readBytes = (context.workspace.readBytes || 0) + actualBytes;
  }

  return {
    stdout: finalStdout,
    stderr: finalStderr,
    bytes: actualBytes
  };
}

// Derive or validate exact supervisor-approved check targets (nonempty scope required, fails closed without workspace)
export function resolveCheckTargets(args, context) {
  if (!context.workspace || !context.workspace.allowed || context.workspace.allowed.size === 0) {
    throw new Error('Execution failed closed: workspace scope is missing or empty');
  }
  const explicit = [];
  if (args.path) explicit.push(cleanRelative(args.path));
  if (Array.isArray(args.args)) {
    for (const a of args.args) explicit.push(cleanRelative(a));
  }
  if (explicit.length > 0) {
    for (const p of explicit) {
      if (!context.workspace.allowed.has(p)) {
        throw new Error(`Path outside assignment scope: '${p}'`);
      }
    }
    return explicit.map(p => (p.startsWith('-') ? `./${p}` : p));
  }

  // Explicit targets omitted: derive exact nonempty scope from supervisor-approved workspace.allowed
  const allowed = Array.from(context.workspace.allowed);
  if (args.profile === 'test') {
    const testTargets = allowed.filter(p => /(?:^|\/)(?:test\/|.*\.test\.[cm]?js$)/.test(p));
    if (testTargets.length === 0) {
      throw new Error('No supervisor-approved test targets found in assignment scope; explicit nonempty target required');
    }
    return testTargets.map(p => (p.startsWith('-') ? `./${p}` : p));
  }
  if (args.profile === 'lint') {
    const lintTargets = allowed.filter(p => /\.[cm]?js$/.test(p));
    if (lintTargets.length === 0) {
      throw new Error('No supervisor-approved lint targets found in assignment scope; explicit nonempty target required');
    }
    return lintTargets.map(p => (p.startsWith('-') ? `./${p}` : p));
  }
  if (allowed.length === 0) {
    throw new Error('Execution failed closed: no supervisor-approved targets in scope');
  }
  return allowed.map(p => (p.startsWith('-') ? `./${p}` : p));
}

// Derive or validate exact supervisor-approved git targets (nonempty scope required, fails closed without workspace)
export function resolveGitTargets(args, context) {
  if (!context.workspace || !context.workspace.allowed || context.workspace.allowed.size === 0) {
    throw new Error('Execution failed closed: workspace scope is missing or empty');
  }
  const explicit = [];
  if (args.path) explicit.push(cleanRelative(args.path));
  if (Array.isArray(args.args)) {
    for (const a of args.args) explicit.push(cleanRelative(a));
  }
  if (explicit.length > 0) {
    for (const p of explicit) {
      if (!context.workspace.allowed.has(p)) {
        throw new Error(`Path outside assignment scope: '${p}'`);
      }
    }
    return explicit.map(p => (p.startsWith('-') ? `./${p}` : p));
  }

  // Explicit targets omitted: derive exact nonempty scope from supervisor-approved workspace.allowed
  const allowed = Array.from(context.workspace.allowed);
  if (allowed.length === 0) {
    throw new Error('Execution failed closed: no supervisor-approved target paths in scope');
  }
  return allowed.map(p => (p.startsWith('-') ? `./${p}` : p));
}

// Extension Tool 1: check_command (Supervisor-Approved Fixed Profiles without arbitrary worker args)
export const checkCommandTool = {
  name: 'check_command',
  description: 'Run a supervisor-approved fixed check command profile on scoped files without arbitrary shell execution.',
  effect: EFFECTS.EXECUTE,
  capability: CAPABILITIES.CHECK_EXECUTE,
  schema: {
    type: 'object',
    properties: {
      profile: {
        type: 'string',
        enum: ['test', 'lint'],
        description: 'Supervisor-approved fixed check command profile'
      },
      path: {
        type: 'string',
        description: 'Optional scoped file path to test or check'
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional scoped target paths only (no flags, switches, or shell syntax)'
      }
    },
    required: ['profile'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid check_command arguments');
    if (args.profile === 'build' || args.profile === 'typecheck') {
      throw new Error(`Check profile '${args.profile}' is unavailable: fake-success profiles removed, requires coordinator-selected profile`);
    }
    if (!CHECK_COMMAND_PROFILES[args.profile]) {
      throw new Error(`Unsupported check profile: '${args.profile}'`);
    }
    // Reject worker-controlled options, Node loader/eval switches, or shell operators
    const checkArg = (arg) => {
      if (typeof arg !== 'string') throw new Error('Invalid check_command argument: must be string');
      if (arg.startsWith('-')) {
        throw new Error(`Worker-specified switches and options are forbidden: '${arg}'`);
      }
      if (/[;&|`$><*?"'\n\r]/.test(arg)) {
        throw new Error(`Unsafe argument rejected: contains shell metacharacters`);
      }
      cleanRelative(arg); // ensures valid relative path, no traversal or backslash
    };

    if (args.path !== undefined) checkArg(args.path);
    if (args.args !== undefined) {
      if (!Array.isArray(args.args) || args.args.length > 10) throw new Error('Invalid check_command args: max 10 entries allowed');
      for (const a of args.args) checkArg(a);
    }
  },
  checkScope(args, context) {
    if (context.workspaceAdmission?.scope?.commands) {
      const allowed = context.workspaceAdmission.scope.commands;
      const isAllowed = allowed.some(cmd => {
        if (typeof cmd === 'string') return cmd === args.profile;
        if (Array.isArray(cmd)) return cmd.includes(args.profile);
        return false;
      });
      if (!isAllowed) {
        throw new Error(`Command profile '${args.profile}' is not in admitted workspace commands`);
      }
    }
    resolveCheckTargets(args, context);
  },
  checkBudget(args, context) {
    if (context.workspace && context.workspace.readBytes >= context.workspace.maxReadBytes) {
      throw new Error('Read budget exhausted');
    }
  },
  async execute(args, context) {
    const profile = CHECK_COMMAND_PROFILES[args.profile];
    if (!profile) {
      return { profile: args.profile, ok: false, available: false, error: `Check profile '${args.profile}' is unavailable` };
    }
    const targetPaths = resolveCheckTargets(args, context);
    const safeTargets = targetPaths.map(p => (p.startsWith('-') ? `./${p}` : p));
    const cmdArgs = [...profile.fixedArgs, '--', ...safeTargets];
    const cwd = context.workspace?.root ?? process.cwd();

    // Carry remaining task deadline
    const elapsedMs = context.startTime ? (Date.now() - context.startTime) : 0;
    const maxWallMs = context.assignment?.budget?.maxWallMs ?? 30000;
    const remainingWallMs = Math.max(1, maxWallMs - elapsedMs);
    const timeout = Math.min(15000, remainingWallMs);

    const { promisify } = await import('node:util');
    const execFileFn = context.execFile || (await import('node:child_process')).execFile;
    const execFileAsync = promisify(execFileFn);
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    try {
      const { stdout, stderr } = await execFileAsync(profile.executable, cmdArgs, {
        cwd,
        timeout,
        signal: context.signal,
        maxBuffer: 16384,
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_ENV: 'test' }
      });

      const bounded = boundAndAccountOutput(stdout, stderr, context);
      return {
        profile: args.profile,
        ok: true,
        exitCode: 0,
        stdout: bounded.stdout,
        stderr: bounded.stderr
      };
    } catch (err) {
      if (err.message === 'Read budget exhausted') throw err;
      const rawStdout = err.stdout || '';
      const rawStderr = err.stderr || err.message || '';
      const bounded = boundAndAccountOutput(rawStdout, rawStderr, context);
      return {
        profile: args.profile,
        ok: false,
        exitCode: typeof err.code === 'number' ? err.code : 1,
        stdout: bounded.stdout,
        stderr: bounded.stderr
      };
    }
  },
  formatResult(res) {
    return res;
  }
};

// Extension Tool 2: git_readonly (Scoped status query with neutralized repository/config process effects)
export const gitReadonlyTool = {
  name: 'git_readonly',
  description: 'Run a scoped read-only git status query on allowed paths without arbitrary options or external commands.',
  effect: EFFECTS.EXECUTE_READ,
  capability: CAPABILITIES.GIT_READ,
  schema: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        enum: ['status'],
        description: 'Scoped status operation only'
      },
      path: {
        type: 'string',
        description: 'Optional scoped file path to query status for'
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional scoped target paths only (no flags or switches)'
      }
    },
    required: ['subcommand'],
    additionalProperties: false
  },
  validateArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid git_readonly arguments');
    if (args.subcommand !== 'status') {
      throw new Error(`Unsupported git subcommand '${args.subcommand}': only scoped 'status' is permitted`);
    }
    const checkArg = (arg) => {
      if (typeof arg !== 'string') throw new Error('Invalid git_readonly argument: must be string');
      if (arg.startsWith('-')) {
        throw new Error(`Worker-specified git options and flags are forbidden: '${arg}'`);
      }
      if (/[;&|`$><*?"'\n\r]/.test(arg)) {
        throw new Error(`Unsafe argument rejected: contains shell metacharacters`);
      }
      cleanRelative(arg);
    };
    if (args.path !== undefined) checkArg(args.path);
    if (args.args !== undefined) {
      if (!Array.isArray(args.args) || args.args.length > 10) throw new Error('Invalid git_readonly args: max 10 entries allowed');
      for (const a of args.args) checkArg(a);
    }
  },
  checkScope(args, context) {
    if (context.workspaceAdmission?.scope?.commands) {
      const allowed = context.workspaceAdmission.scope.commands;
      const isAllowed = allowed.some(cmd => {
        if (typeof cmd === 'string') return cmd === 'git';
        if (Array.isArray(cmd)) return cmd[0] === 'git' || cmd.includes('git');
        return false;
      });
      if (!isAllowed) {
        throw new Error("Command 'git' is not in admitted workspace commands");
      }
    }
    resolveGitTargets(args, context);
  },
  checkBudget(args, context) {
    if (context.workspace && context.workspace.readBytes >= context.workspace.maxReadBytes) {
      throw new Error('Read budget exhausted');
    }
  },
  async execute(args, context) {
    const targetPaths = resolveGitTargets(args, context);
    const cwd = context.workspace?.root ?? process.cwd();

    // Hardened command line neutralizing external diff, textconv, pager, fsmonitor, submodules, and hook/config-driven process effects
    const cmdArgs = [
      '-c', 'core.fsmonitor=false',
      '-c', 'fsmonitor.allowRemote=false',
      '-c', 'submodule.recurse=false',
      '-c', 'status.submoduleSummary=false',
      '-c', 'core.hooksPath=',
      '-c', 'core.pager=cat',
      '-c', 'diff.external=',
      '-c', 'diff.textconv=false',
      '-c', 'core.editor=false',
      '-c', 'sequence.editor=false',
      '-c', 'credential.helper=',
      'status',
      '--porcelain=v1',
      '--ignore-submodules=all',
      '--',
      ...targetPaths
    ];

    // Carry remaining task deadline
    const elapsedMs = context.startTime ? (Date.now() - context.startTime) : 0;
    const maxWallMs = context.assignment?.budget?.maxWallMs ?? 30000;
    const remainingWallMs = Math.max(1, maxWallMs - elapsedMs);
    const timeout = Math.min(10000, remainingWallMs);

    const { promisify } = await import('node:util');
    const execFileFn = context.execFile || (await import('node:child_process')).execFile;
    const execFileAsync = promisify(execFileFn);
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    try {
      const { stdout, stderr } = await execFileAsync('git', cmdArgs, {
        cwd,
        timeout,
        signal: context.signal,
        maxBuffer: 16384,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0'
        }
      });

      const bounded = boundAndAccountOutput(stdout, stderr, context);
      return {
        subcommand: 'status',
        ok: true,
        exitCode: 0,
        stdout: bounded.stdout,
        stderr: bounded.stderr
      };
    } catch (err) {
      if (err.message === 'Read budget exhausted') throw err;
      const rawStdout = err.stdout || '';
      const rawStderr = err.stderr || err.message || '';
      const bounded = boundAndAccountOutput(rawStdout, rawStderr, context);
      return {
        subcommand: 'status',
        ok: false,
        exitCode: typeof err.code === 'number' ? err.code : 1,
        stdout: bounded.stdout,
        stderr: bounded.stderr
      };
    }
  },
  formatResult(res) {
    return res;
  }
};

// Capability-Based Tool Registry
export class ToolRegistry {
  constructor(options = {}) {
    this.tools = new Map();
    this.authority = options.authority instanceof AuthorityPort
      ? options.authority
      : new AuthorityPort(options.authority);
  }

  register(tool) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
      throw new Error('Tool must have a valid name');
    }
    if (!tool.effect || typeof tool.execute !== 'function') {
      throw new Error(`Tool '${tool.name}' must specify an effect and an execute handler`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name) {
    return this.tools.has(name);
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  getPermittedToolNames(assignment = {}, options = {}) {
    const hasWriteScope = Boolean(
      (assignment?.scope?.writePaths && assignment.scope.writePaths.length > 0) ||
      (Array.isArray(assignment?.allowedPaths) && assignment.allowedPaths.length > 0 &&
       (!assignment.scope || (assignment.scope.writePaths && assignment.scope.writePaths.length > 0)))
    );

    if (Array.isArray(options.tools)) {
      return options.tools.filter(name => {
        if (!this.tools.has(name)) return false;
        // Intersect explicit options.tools with write capability: read-only tasks must not advertise propose_patch
        if (!hasWriteScope && name === 'propose_patch') return false;
        return true;
      });
    }

    const names = [];
    for (const name of ['list_paths', 'search', 'read_slice']) {
      if (this.tools.has(name)) names.push(name);
    }

    if (hasWriteScope && this.tools.has('propose_patch')) {
      names.push('propose_patch');
    }

    for (const name of ['run_check', 'submit_receipt']) {
      if (this.tools.has(name)) names.push(name);
    }

    if (options.enableExtensions) {
      for (const extName of ['check_command', 'git_readonly']) {
        if (this.tools.has(extName)) names.push(extName);
      }
    }
    return names;
  }

  getSchemas(toolNames = null) {
    const names = toolNames ?? Array.from(this.tools.keys());
    return names.map(name => {
      const tool = this.tools.get(name);
      if (!tool) throw new Error(`Unknown tool '${name}'`);
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.schema
        }
      };
    });
  }

  async execute(call, context = {}) {
    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.name !== 'string') {
      throw new Error('Invalid tool call');
    }
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Tool '${call.name}' is not registered`);
    }
    if (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
      throw new Error('Invalid tool call arguments');
    }

    // 1. Input schema validation
    if (typeof tool.validateArgs === 'function') {
      tool.validateArgs(call.args);
    }

    // 2. Capability / Task permission check
    if (tool.effect === EFFECTS.WRITE && context.workspace?.writePaths && context.workspace.writePaths.size === 0) {
      throw new Error('Operation not permitted: task does not have write capability');
    }

    const admission = context.workspaceAdmission || this.authority?.workspaceAdmission || null;
    const sourceBaselineRoot = context.sourceBaselineRoot || admission?.sourceBaselineRoot || null;
    if (admission && !context.workspaceAdmission) {
      context.workspaceAdmission = admission;
    }
    if (sourceBaselineRoot && !context.sourceBaselineRoot) {
      context.sourceBaselineRoot = sourceBaselineRoot;
    }

    // 3. Authority evaluation (fail-closed if authority denies)
    const authorityDecision = await this.authority.evaluate({
      tool: tool.name,
      effect: tool.effect,
      capability: tool.capability,
      args: call.args,
      assignment: context.assignment,
      workspace: context.workspace,
      workspaceAdmission: admission,
      sourceBaselineRoot
    });
    if (!authorityDecision || !authorityDecision.allowed) {
      throw new Error(authorityDecision?.reason || `Authority denied invocation of ${tool.name}`);
    }

    // 4. Scope check (fails before handler)
    if (typeof tool.checkScope === 'function') {
      tool.checkScope(call.args, context);
    }

    // 5. Pre-flight budget check (fails before handler)
    if (typeof tool.checkBudget === 'function') {
      await tool.checkBudget(call.args, context);
    }

    if (context.signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }

    // 6. Handler execution
    const rawResult = await tool.execute(call.args, context);

    // 7. Output bounding
    return typeof tool.formatResult === 'function' ? tool.formatResult(rawResult) : rawResult;
  }
}

// Factory helper to create default tool registry with all baseline and extension tools
export function createDefaultRegistry(options = {}) {
  const registry = new ToolRegistry(options);
  registry.register(listPathsTool);
  registry.register(searchTool);
  registry.register(readSliceTool);
  registry.register(proposePatchTool);
  registry.register(runCheckTool);
  registry.register(submitReceiptTool);
  registry.register(checkCommandTool);
  registry.register(gitReadonlyTool);
  return registry;
}
