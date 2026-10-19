/**
 * @file ports/rct-port.js
 * Injected Authority Port adapter for RCT runtime and tool handlers.
 * Maps RCT tool calls (read_slice, propose_patch, run_check, etc.) to
 * versioned Protocol ActionRequests and evaluates them against PolicyService.
 *
 * Implements the evaluator interface expected by RCT's AuthorityPort:
 *   evaluator.evaluate(request) -> { allowed: boolean, reason?: string, details?: object }
 */

import {
  createActionRequest,
  ActionType,
  SCHEMA_VERSIONS,
  validateRelativePath,
  validateDirectoryPath,
  validateWorkspaceAdmission
} from '../../../protocol/src/index.js';
import {
  CHECK_COMMAND_PROFILES,
  resolveCheckTargets
} from '../../../rct-runtime/src/tool-registry.js';

export class RctPolicyPort {
  /**
   * @param {import('../policy-service.js').PolicyService} policyService
   * @param {object} [options]
   * @param {boolean} [options.consumeOnEvaluation=false] - If true, atomically consumes one-use approvals
   * @param {object} [options.checkProfiles] - Optional override or extension for check command profiles
   * @param {object} [options.workspaceAdmission] - Optional immutable WorkspaceAdmission contract
   */
  constructor(policyService, options = {}) {
    if (!policyService) {
      throw new Error('RctPolicyPort requires a PolicyService instance');
    }
    this.policyService = policyService;
    this.consumeOnEvaluation = options.consumeOnEvaluation ?? false;
    this.checkProfiles = options.checkProfiles || CHECK_COMMAND_PROFILES;
    this.admittedWorkspaceRoot = options.admittedWorkspaceRoot || options.workspaceRoot || null;
    this.admittedSourceBaselineRoot = options.admittedSourceBaselineRoot || options.sourceBaselineRoot || null;
    this.admittedWorkspace = options.workspaceAdmission || options.admittedWorkspace || null;
    if (this.admittedWorkspace) {
      this.admittedWorkspace = validateWorkspaceAdmission(this.admittedWorkspace);
      this.admittedWorkspaceRoot = this.admittedWorkspace.canonicalRoot;
      this.admittedSourceBaselineRoot = this.admittedWorkspace.sourceBaselineRoot;
    }
    this.lastActionRequest = null;
  }

  /**
   * Maps an RCT tool request to a Protocol ActionRequest and evaluates authority.
   * Compatible with RCT AuthorityPort evaluator contract.
   *
   * @param {object} rctRequest
   * @param {string} rctRequest.tool - Tool name (e.g. 'read_slice', 'propose_patch', 'run_check')
   * @param {string} rctRequest.effect - Effect type ('read', 'write', 'execute', etc.)
   * @param {string} [rctRequest.capability] - Capability ('file:read', 'file:write', 'check:execute', etc.)
   * @param {object} [rctRequest.args] - Tool arguments
   * @param {object} [rctRequest.assignment] - RCT assignment context
   * @param {object} [rctRequest.workspace] - RCT workspace context
   * @returns {Promise<{ allowed: boolean, reason?: string, grantId?: string, details?: object }>}
   */
  async evaluate(rctRequest) {
    return this.evaluateSync(rctRequest);
  }

  /**
   * Synchronous evaluation of an RCT tool request.
   *
   * @param {object} rctRequest
   * @returns {{ allowed: boolean, reason?: string, grantId?: string, details?: object }}
   */
  evaluateSync(rctRequest) {
    if (!rctRequest || typeof rctRequest !== 'object') {
      return { allowed: false, reason: 'invalid_rct_request' };
    }

    const { tool, effect, capability, args = {} } = rctRequest;
    const assignment = rctRequest.assignment || rctRequest.context?.assignment || {};
    const workspace = rctRequest.workspace || rctRequest.context?.workspace || {};

    const taskId = assignment.id || assignment.taskId || 'rct-task';
    const attemptId = assignment.attemptId ?? 1;
    const principalId = assignment.agent || assignment.agentId || 'RCT-1';
    const sessionId = assignment.sessionId || assignment.id || assignment.taskId || 'rct-session';

    // Extract and canonicalize actual workspace root
    const rawActualRoot = workspace?.root;
    let canonicalActualRoot = null;
    if (rawActualRoot) {
      const relRes = validateRelativePath(rawActualRoot);
      canonicalActualRoot = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawActualRoot).ok ? validateDirectoryPath(rawActualRoot).canonical : rawActualRoot);
    }

    // Extract and canonicalize admitted workspace root & source baseline root
    const rawAdmittedRoot = this.admittedWorkspace?.canonicalRoot ||
      this.admittedWorkspaceRoot ||
      assignment.scope?.root ||
      assignment.workspace?.root ||
      assignment.isolatedRoot;
    let canonicalAdmittedRoot = null;
    if (rawAdmittedRoot) {
      const relRes = validateRelativePath(rawAdmittedRoot);
      canonicalAdmittedRoot = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawAdmittedRoot).ok ? validateDirectoryPath(rawAdmittedRoot).canonical : rawAdmittedRoot);
    }

    const rawSourceBaseline = rctRequest.sourceBaselineRoot ||
      rctRequest.workspaceAdmission?.sourceBaselineRoot ||
      assignment.workspaceAdmission?.sourceBaselineRoot ||
      this.admittedWorkspace?.sourceBaselineRoot ||
      this.admittedSourceBaselineRoot ||
      assignment.scope?.sourceBaselineRoot;
    let canonicalSourceBaseline = null;
    if (rawSourceBaseline) {
      const relRes = validateRelativePath(rawSourceBaseline);
      canonicalSourceBaseline = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawSourceBaseline).ok ? validateDirectoryPath(rawSourceBaseline).canonical : rawSourceBaseline);
    }

    // Fail-closed check: if admitted workspace root is defined, verify actual workspace root identity before handler
    const isFileTool = Boolean(
      tool === 'read_slice' ||
      tool === 'propose_patch' ||
      tool === 'delete_file' ||
      tool === 'remove_path' ||
      tool === 'list_paths' ||
      tool === 'search' ||
      tool === 'git_readonly' ||
      tool === 'submit_receipt' ||
      effect === 'read' ||
      effect === 'write' ||
      effect === 'create' ||
      effect === 'delete' ||
      effect === 'submit' ||
      capability === 'file:read' ||
      capability === 'file:write' ||
      capability === 'file:create' ||
      capability === 'file:delete' ||
      capability === 'attempt:submit'
    );

    if (isFileTool) {
      // 1. Enforce admitted workspace root match
      if (canonicalAdmittedRoot) {
        if (!canonicalActualRoot) {
          return {
            allowed: false,
            reason: 'missing_workspace_root',
            details: { expected: canonicalAdmittedRoot }
          };
        }
        if (canonicalActualRoot !== canonicalAdmittedRoot) {
          return {
            allowed: false,
            reason: 'workspace_root_mismatch',
            details: { expected: canonicalAdmittedRoot, actual: canonicalActualRoot }
          };
        }
      }

      // 2. Prevent action directly targeting source baseline
      if (canonicalSourceBaseline && canonicalActualRoot === canonicalSourceBaseline) {
        return {
          allowed: false,
          reason: 'source_baseline_mutation_denied',
          details: { expectedRoot: canonicalAdmittedRoot, sourceBaselineRoot: canonicalSourceBaseline }
        };
      }
    }

    // Map tool/effect/capability to Protocol ActionType and parameters
    let actionType;
    let parameters = {};
    let targetErr = null;

    if (tool === 'read_slice' || effect === 'read' || capability === 'file:read') {
      actionType = ActionType.FILE_READ;
      const targetPath = args.path || args.file;
      if (!targetPath) {
        // If tool is list_paths or search without explicit path, target declared read scope
        if (tool === 'list_paths' || tool === 'search') {
          const defaultRead = assignment.scope?.readPaths?.[0] ||
            (assignment.paths ? Object.keys(assignment.paths).find(p => assignment.paths[p]?.read !== false) : null);
          if (!defaultRead) {
            return { allowed: false, reason: 'no_read_scope_declared' };
          }
          parameters = {
            path: defaultRead,
            ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
          };
        } else {
          return { allowed: false, reason: 'missing_path_for_file_read' };
        }
      } else {
        parameters = {
          path: targetPath,
          ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
        };
      }
    } else if (effect === 'create' || capability === 'file:create') {
      actionType = ActionType.FILE_CREATE;
      const targetPath = args.path || args.file;
      if (!targetPath) {
        return { allowed: false, reason: 'missing_path_for_file_create' };
      }
      parameters = {
        path: targetPath,
        content: args.content ?? args.patch ?? '',
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else if (effect === 'delete' || capability === 'file:delete' || tool === 'delete_file' || tool === 'remove_path') {
      actionType = ActionType.FILE_DELETE;
      const targetPath = args.path || args.file;
      if (!targetPath) {
        return { allowed: false, reason: 'missing_path_for_file_delete' };
      }
      parameters = {
        path: targetPath,
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else if (tool === 'propose_patch' || effect === 'write' || capability === 'file:write') {
      const targetPath = args.path || args.file;
      if (!targetPath) {
        return { allowed: false, reason: 'missing_path_for_file_write' };
      }
      const isCreate = Boolean(
        assignment.scope?.createPaths &&
        assignment.scope.createPaths.includes(targetPath) &&
        (!assignment.scope?.writePaths || !assignment.scope.writePaths.includes(targetPath))
      );
      actionType = isCreate ? ActionType.FILE_CREATE : ActionType.FILE_WRITE;
      parameters = {
        path: targetPath,
        patch: args.content ?? args.patch ?? '',
        content: args.content ?? args.patch ?? '',
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else if (effect === 'execute' || effect === 'execute_read' || capability === 'check:execute' || tool === 'check_command') {
      actionType = ActionType.SHELL_EXEC;
      let executable = null;
      let cmdArgs = null;
      let command = null;

      if (args.profile) {
        const profileKey = args.profile;
        const profile = this.checkProfiles?.[profileKey];
        if (!profile) {
          return { allowed: false, reason: `unsupported_check_profile: '${profileKey}'` };
        }

        // Pre-resolve targets exactly as checkCommandTool.execute resolves them
        let safeTargets = [];
        try {
          const targetPaths = resolveCheckTargets(args, { workspace, assignment });
          safeTargets = targetPaths.map(p => (p.startsWith('-') ? `./${p}` : p));
        } catch (err) {
          targetErr = err;
        }

        cmdArgs = [...profile.fixedArgs, '--', ...safeTargets];
        executable = rctRequest.execution?.executable || profile.executable || process.execPath;
        command = [executable, ...cmdArgs];
      } else if (Array.isArray(args.command)) {
        command = args.command;
        executable = command[0];
        cmdArgs = command.slice(1);
      } else if (typeof args.command === 'string') {
        command = args.command.trim().split(/\s+/);
        executable = command[0];
        cmdArgs = command.slice(1);
      } else if (tool === 'check_command') {
        return { allowed: false, reason: 'missing_check_profile' };
      } else {
        command = ['npm', 'test'];
        executable = 'npm';
        cmdArgs = ['test'];
      }

      // Resolve the actual working directory:
      // Real ToolRegistry lines 564/648 executes: context.workspace?.root ?? process.cwd()
      // For check_command, actual subprocess runs in workspace.root unconditionally (ignoring any args.cwd).
      // We bind actual workspace.root unconditionally so authorized canonical cwd strictly equals actual executor cwd.
      const rawCwd = rctRequest.execution?.cwd || (tool === 'check_command'
        ? (this.admittedWorkspace?.canonicalRoot || this.admittedWorkspaceRoot || workspace?.root || assignment.scope?.root || assignment.workspace?.root || assignment.isolatedRoot || process.cwd())
        : args.cwd);

      let resolvedCwd = null;
      if (rawCwd) {
        const cwdRel = validateRelativePath(rawCwd);
        if (cwdRel.ok) {
          resolvedCwd = cwdRel.canonical;
        } else {
          const cwdDir = validateDirectoryPath(rawCwd);
          resolvedCwd = cwdDir.ok ? cwdDir.canonical : rawCwd;
        }
      }

      if (canonicalSourceBaseline && (resolvedCwd === canonicalSourceBaseline || canonicalActualRoot === canonicalSourceBaseline)) {
        return {
          allowed: false,
          reason: 'source_baseline_execution_denied',
          details: { cwd: resolvedCwd, sourceBaselineRoot: canonicalSourceBaseline }
        };
      }

      parameters = {
        ...(executable ? { executable } : {}),
        ...(cmdArgs ? { args: cmdArgs } : {}),
        command,
        ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else if (tool === 'run_check' || effect === 'verify' || capability === 'verify:check') {
      // run_check can be an explicit command or verification of declared checks
      if (args.command || args.profile) {
        actionType = ActionType.SHELL_EXEC;
        const command = Array.isArray(args.command)
          ? args.command
          : (typeof args.command === 'string' ? args.command.trim().split(/\s+/) : [args.profile]);
        const executable = command[0];
        const cmdArgs = command.slice(1);
        const rawCwd = args.cwd;
        let resolvedCwd = null;
        if (rawCwd) {
          const cwdRel = validateRelativePath(rawCwd);
          resolvedCwd = cwdRel.ok ? cwdRel.canonical : (validateDirectoryPath(rawCwd).ok ? validateDirectoryPath(rawCwd).canonical : rawCwd);
        }

        if (canonicalSourceBaseline && (resolvedCwd === canonicalSourceBaseline || canonicalActualRoot === canonicalSourceBaseline)) {
          return {
            allowed: false,
            reason: 'source_baseline_execution_denied',
            details: { cwd: resolvedCwd, sourceBaselineRoot: canonicalSourceBaseline }
          };
        }

        parameters = {
          ...(executable ? { executable } : {}),
          ...(cmdArgs ? { args: cmdArgs } : {}),
          command,
          ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
          ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
        };
      } else {
        // Inspect checks in assignment
        const checks = Array.isArray(assignment.checks) ? assignment.checks : [];
        const commandCheck = checks.find(c => c.type === 'command' || c.profile);
        if (commandCheck) {
          actionType = ActionType.SHELL_EXEC;
          let cmd = null;
          let executable = null;
          let cmdArgs = null;
          if (commandCheck.profile && this.checkProfiles?.[commandCheck.profile]) {
            const profile = this.checkProfiles[commandCheck.profile];
            const targets = [];
            if (commandCheck.path) targets.push(commandCheck.path);
            if (Array.isArray(commandCheck.args)) targets.push(...commandCheck.args);
            if (targets.length === 0 && Array.isArray(assignment.scope?.readPaths)) {
              if (commandCheck.profile === 'test') {
                targets.push(...assignment.scope.readPaths.filter(p => /(?:^|\/)(?:test\/|.*\.test\.[cm]?js$)/.test(p)));
              } else if (commandCheck.profile === 'lint') {
                targets.push(...assignment.scope.readPaths.filter(p => /\.[cm]?js$/.test(p)));
              }
            }
            const safeTargets = targets.map(p => (p.startsWith('-') ? `./${p}` : p));
            cmdArgs = [...profile.fixedArgs, '--', ...safeTargets];
            executable = profile.executable;
            cmd = [executable, ...cmdArgs];
          } else {
            cmd = commandCheck.command
              ? (Array.isArray(commandCheck.command) ? commandCheck.command : commandCheck.command.trim().split(/\s+/))
              : [commandCheck.profile];
            executable = cmd[0];
            cmdArgs = cmd.slice(1);
          }
          const rawCwd = commandCheck.cwd || args.cwd || this.admittedWorkspace?.canonicalRoot || this.admittedWorkspaceRoot || workspace?.root || assignment.scope?.root || assignment.cwd;
          let resolvedCwd = null;
          if (rawCwd) {
            const cwdRel = validateRelativePath(rawCwd);
            resolvedCwd = cwdRel.ok ? cwdRel.canonical : (validateDirectoryPath(rawCwd).ok ? validateDirectoryPath(rawCwd).canonical : rawCwd);
          }

          if (canonicalSourceBaseline && (resolvedCwd === canonicalSourceBaseline || canonicalActualRoot === canonicalSourceBaseline)) {
            return {
              allowed: false,
              reason: 'source_baseline_execution_denied',
              details: { cwd: resolvedCwd, sourceBaselineRoot: canonicalSourceBaseline }
            };
          }

          parameters = {
            ...(executable ? { executable } : {}),
            ...(cmdArgs ? { args: cmdArgs } : {}),
            command: cmd,
            ...(resolvedCwd ? { cwd: resolvedCwd } : {}),
            ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
          };
        } else {
          // Read-only check (equals, contains, or file existence)
          const readTarget = checks.find(c => c.path)?.path || assignment.scope?.readPaths?.[0];
          if (!readTarget) {
            return { allowed: false, reason: 'no_verifiable_scope' };
          }
          actionType = ActionType.FILE_READ;
          parameters = {
            path: readTarget,
            ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
          };
        }
      }
    } else if (tool === 'git_readonly') {
      actionType = ActionType.FILE_READ;
      const targetPath = args.path || assignment.scope?.readPaths?.[0];
      if (!targetPath) {
        return { allowed: false, reason: 'missing_path_for_git_readonly' };
      }
      parameters = {
        path: targetPath,
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else if (tool === 'submit_receipt' || effect === 'submit' || capability === 'attempt:submit') {
      // Final submission uses read authority over assigned scope
      const targetPath = assignment.scope?.readPaths?.[0] || assignment.scope?.writePaths?.[0];
      if (!targetPath) {
        return { allowed: false, reason: 'no_scoped_paths_for_receipt_submission' };
      }
      actionType = ActionType.FILE_READ;
      parameters = {
        path: targetPath,
        ...(canonicalActualRoot ? { workspaceRoot: canonicalActualRoot } : {})
      };
    } else {
      // Unmapped / unknown effect -> fail closed
      return {
        allowed: false,
        reason: `unmapped_rct_effect: '${effect}' for tool '${tool}'`
      };
    }

    let actionRequest;
    try {
      actionRequest = createActionRequest({
        taskId,
        attemptId,
        principalId,
        sessionId,
        actionType,
        parameters
      });
      this.lastActionRequest = actionRequest;
    } catch (err) {
      return {
        allowed: false,
        reason: `action_request_creation_failed: ${err.message}`
      };
    }

    const res = this.consumeOnEvaluation
      ? this.policyService.authorizeAndConsume(actionRequest)
      : this.policyService.evaluate(actionRequest);

    if (!res.granted) {
      return {
        allowed: false,
        reason: res.reason,
        grantId: res.grantId,
        details: {
          ...res.details,
          actionRequest
        }
      };
    }

    if (targetErr) {
      return {
        allowed: false,
        reason: targetErr.message,
        details: {
          actionRequest
        }
      };
    }

    return {
      allowed: true,
      reason: res.reason,
      grantId: res.grantId,
      details: {
        ...res.details,
        actionRequest
      }
    };
  }

  /**
   * Generates and registers separate capability-scoped Grants for an Assignment
   * from its exactly declared read/write/create/command scopes.
   *
   * Binds full declared argv and explicit authorized cwd; rejects changed or appended args/cwd.
   * A read-only assignment never authorizes FILE_WRITE, FILE_DELETE, SHELL_EXEC,
   * and never invents unassigned paths like 'src'.
   *
   * @param {object} assignment - Protocol or RCT assignment
   * @param {object} [options]
   * @param {number} [options.ttlMs=300000] - Grant validity in ms (default 5 minutes)
   * @param {string} [options.issuerId='policy_coordinator']
   * @param {string[]|string[][]} [options.allowedCommands] - Explicit commands to permit for execution
   * @param {string|string[]} [options.cwd] - Explicit authorized cwd
   * @param {string[]} [options.allowedCwds] - Explicit authorized cwds
   * @returns {object[]} Array of registered Grant objects
   */
  createAssignmentGrants(assignment, options = {}) {
    const clock = this.policyService.getCurrentTime();
    const ttlMs = options.ttlMs ?? 300000;
    const issuerId = options.issuerId || 'policy_coordinator';
    const principalId = assignment.agent || assignment.agentId || 'RCT-1';
    const sessionId = assignment.sessionId || assignment.id || assignment.taskId || 'rct-session';
    const taskId = assignment.id || assignment.taskId || 'rct-task';
    const attemptId = assignment.attemptId ?? 1;

    // Support options.workspaceAdmission or assignment.workspaceAdmission
    if (options.workspaceAdmission || assignment.workspaceAdmission) {
      this.admittedWorkspace = validateWorkspaceAdmission(options.workspaceAdmission || assignment.workspaceAdmission);
      this.admittedWorkspaceRoot = this.admittedWorkspace.canonicalRoot;
      this.admittedSourceBaselineRoot = this.admittedWorkspace.sourceBaselineRoot;
    }

    // Extract and canonicalize admitted workspace root & source baseline root
    const rawAdmittedRoot = this.admittedWorkspace?.canonicalRoot ||
      this.admittedWorkspaceRoot ||
      assignment.scope?.root ||
      options.workspaceRoot ||
      options.workspace?.root ||
      assignment.workspace?.root ||
      assignment.isolatedRoot;

    let canonicalAdmittedRoot = null;
    if (rawAdmittedRoot) {
      const relRes = validateRelativePath(rawAdmittedRoot);
      canonicalAdmittedRoot = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawAdmittedRoot).ok ? validateDirectoryPath(rawAdmittedRoot).canonical : rawAdmittedRoot);
    }
    if (!this.admittedWorkspaceRoot && canonicalAdmittedRoot) {
      this.admittedWorkspaceRoot = canonicalAdmittedRoot;
    }

    const rawSourceBaseline = options.sourceBaselineRoot ||
      options.workspaceAdmission?.sourceBaselineRoot ||
      assignment.workspaceAdmission?.sourceBaselineRoot ||
      this.admittedWorkspace?.sourceBaselineRoot ||
      this.admittedSourceBaselineRoot ||
      assignment.scope?.sourceBaselineRoot;

    let canonicalSourceBaseline = null;
    if (rawSourceBaseline) {
      const relRes = validateRelativePath(rawSourceBaseline);
      canonicalSourceBaseline = relRes.ok ? relRes.canonical : (validateDirectoryPath(rawSourceBaseline).ok ? validateDirectoryPath(rawSourceBaseline).canonical : rawSourceBaseline);
    }
    if (!this.admittedSourceBaselineRoot && canonicalSourceBaseline) {
      this.admittedSourceBaselineRoot = canonicalSourceBaseline;
    }

    // 1. Extract exactly declared readPaths
    let readPaths = [];
    if (Array.isArray(this.admittedWorkspace?.scope?.readPaths)) {
      readPaths = [...new Set(this.admittedWorkspace.scope.readPaths)];
    } else if (Array.isArray(assignment.scope?.readPaths)) {
      readPaths = [...new Set(assignment.scope.readPaths)];
    } else if (assignment.paths && typeof assignment.paths === 'object') {
      readPaths = Object.keys(assignment.paths).filter(p => assignment.paths[p]?.read !== false);
    } else if (Array.isArray(assignment.allowedPaths)) {
      readPaths = [...new Set(assignment.allowedPaths)];
    }

    // 2. Extract exactly declared writePaths
    let writePaths = [];
    if (Array.isArray(this.admittedWorkspace?.scope?.writePaths)) {
      writePaths = [...new Set(this.admittedWorkspace.scope.writePaths)];
    } else if (Array.isArray(assignment.scope?.writePaths)) {
      writePaths = [...new Set(assignment.scope.writePaths)];
    } else if (assignment.paths && typeof assignment.paths === 'object') {
      writePaths = Object.keys(assignment.paths).filter(p => assignment.paths[p]?.write === true);
    }

    // 3. Extract exactly declared createPaths
    let createPaths = [];
    if (Array.isArray(this.admittedWorkspace?.scope?.createPaths)) {
      createPaths = [...new Set(this.admittedWorkspace.scope.createPaths)];
    } else if (Array.isArray(assignment.scope?.createPaths)) {
      createPaths = [...new Set(assignment.scope.createPaths)];
    }

    // 4. Extract explicit authorized command+argv+cwd tuples
    // Eliminates command/directory crossproduct and requires explicit authorized cwd before shell grant.
    const defaultExplicitCwd = (typeof options.cwd === 'string' && options.cwd.trim().length > 0)
      ? options.cwd.trim()
      : (typeof assignment.cwd === 'string' && assignment.cwd.trim().length > 0)
        ? assignment.cwd.trim()
        : null;

    const commandTuples = [];

    // A. Extract from assignment.checks
    if (Array.isArray(assignment.checks)) {
      for (const check of assignment.checks) {
        if (!check || typeof check !== 'object') continue;
        let cmdArgv = null;
        if (Array.isArray(check.command) && check.command.length > 0) {
          cmdArgv = check.command.map(String);
        } else if (typeof check.command === 'string' && check.command.trim().length > 0) {
          cmdArgv = check.command.trim().split(/\s+/);
        } else if (typeof check.profile === 'string' && check.profile.trim().length > 0) {
          const profileKey = check.profile.trim();
          const profile = this.checkProfiles?.[profileKey];
          if (profile) {
            const targets = [];
            if (check.path) targets.push(check.path);
            if (Array.isArray(check.args)) targets.push(...check.args);
            if (targets.length === 0 && Array.isArray(assignment.scope?.readPaths)) {
              if (profileKey === 'test') {
                targets.push(...assignment.scope.readPaths.filter(p => /(?:^|\/)(?:test\/|.*\.test\.[cm]?js$)/.test(p)));
              } else if (profileKey === 'lint') {
                targets.push(...assignment.scope.readPaths.filter(p => /\.[cm]?js$/.test(p)));
              }
            }
            const safeTargets = targets.map(p => (p.startsWith('-') ? `./${p}` : p));
            cmdArgv = [profile.executable, ...profile.fixedArgs, '--', ...safeTargets];
          } else {
            cmdArgv = [profileKey];
          }
        }

        if (cmdArgv && cmdArgv.length > 0) {
          const isProfileCheck = Boolean(typeof check.profile === 'string' && check.profile.trim().length > 0);
          const workspaceRoot = canonicalAdmittedRoot ||
            assignment.scope?.root ||
            options.workspaceRoot ||
            options.workspace?.root ||
            assignment.workspace?.root ||
            assignment.isolatedRoot ||
            (typeof options.cwd === 'string' ? options.cwd : null);
          const explicitCwd = isProfileCheck
            ? (workspaceRoot || defaultExplicitCwd || '.')
            : ((typeof check.cwd === 'string' && check.cwd.trim().length > 0)
              ? check.cwd.trim()
              : (workspaceRoot || defaultExplicitCwd));
          // Require explicit authorized cwd before shell grant
          if (explicitCwd) {
            commandTuples.push({ commandArgv: cmdArgv, rawCwd: explicitCwd });
          }
        }
      }
    }

    // B. Extract from options.allowedCommands
    if (Array.isArray(options.allowedCommands) && options.allowedCommands.length > 0) {
      for (const cmd of options.allowedCommands) {
        let cmdArgv = null;
        if (Array.isArray(cmd) && cmd.length > 0) {
          cmdArgv = cmd.map(String);
        } else if (typeof cmd === 'string' && cmd.trim().length > 0) {
          cmdArgv = cmd.trim().split(/\s+/);
        }
        if (cmdArgv && cmdArgv.length > 0 && defaultExplicitCwd) {
          commandTuples.push({ commandArgv: cmdArgv, rawCwd: defaultExplicitCwd });
        }
      }
    }

    // C. Extract from admittedWorkspace.scope.commands or assignment.scope.commands or allowedCommands
    const scopeCommands = this.admittedWorkspace?.scope?.commands || assignment.scope?.commands || assignment.scope?.allowedCommands;
    if (Array.isArray(scopeCommands) && scopeCommands.length > 0) {
      for (const cmd of scopeCommands) {
        let cmdArgv = null;
        if (Array.isArray(cmd) && cmd.length > 0) {
          cmdArgv = cmd.map(String);
        } else if (typeof cmd === 'string' && cmd.trim().length > 0) {
          cmdArgv = cmd.trim().split(/\s+/);
        }
        const effectiveCwd = defaultExplicitCwd || canonicalAdmittedRoot;
        if (cmdArgv && cmdArgv.length > 0 && effectiveCwd) {
          commandTuples.push({ commandArgv: cmdArgv, rawCwd: effectiveCwd });
        }
      }
    }

    // Deduplicate and canonicalize valid (commandArgv, canonicalCwd) tuples
    const distinctTuples = [];
    const seenTupleKeys = new Set();

    for (const tuple of commandTuples) {
      const relRes = validateRelativePath(tuple.rawCwd);
      const dirRes = relRes.ok ? relRes : validateDirectoryPath(tuple.rawCwd);
      if (!dirRes.ok) {
        // Invalid path (e.g. traversal) fails closed
        continue;
      }
      const canonicalCwd = dirRes.canonical;
      if (canonicalSourceBaseline && canonicalCwd === canonicalSourceBaseline) {
        // Cwd targeting source baseline repository is denied
        continue;
      }
      const key = `${JSON.stringify(tuple.commandArgv)}:::${canonicalCwd}`;
      if (!seenTupleKeys.has(key)) {
        seenTupleKeys.add(key);
        distinctTuples.push({ commandArgv: tuple.commandArgv, canonicalCwd });
      }
    }

    const issuedGrants = [];

    // Issue Read Grant (strictly scoped to readPaths)
    if (readPaths.length > 0) {
      const grantId = `grant-rct-read-${taskId}-${attemptId}`;
      const existing = this.policyService.getGrant(grantId);
      if (existing && !existing.revoked && existing.expiresAt > clock) {
        issuedGrants.push(existing);
      } else {
        if (existing) {
          try { this.policyService.revokeGrant(grantId, 'reissuing_assignment_grant'); } catch { }
        }
        const readGrant = this.policyService.issueGrant({
          schemaVersion: SCHEMA_VERSIONS.GRANT,
          grantId,
          principalId,
          sessionId,
          scope: {
            actionTypes: [ActionType.FILE_READ],
            allowedPaths: readPaths,
            ...(canonicalAdmittedRoot ? { workspaceRoot: canonicalAdmittedRoot } : {}),
            ...(canonicalSourceBaseline ? { sourceBaselineRoot: canonicalSourceBaseline } : {})
          },
          issuedAt: clock,
          expiresAt: clock + ttlMs,
          revoked: false,
          issuerId
        });
        issuedGrants.push(readGrant);
      }
    }

    // Issue Write Grant (strictly scoped to writePaths)
    if (writePaths.length > 0) {
      const grantId = `grant-rct-write-${taskId}-${attemptId}`;
      const existing = this.policyService.getGrant(grantId);
      if (existing && !existing.revoked && existing.expiresAt > clock) {
        issuedGrants.push(existing);
      } else {
        if (existing) {
          try { this.policyService.revokeGrant(grantId, 'reissuing_assignment_grant'); } catch { }
        }
        const writeGrant = this.policyService.issueGrant({
          schemaVersion: SCHEMA_VERSIONS.GRANT,
          grantId,
          principalId,
          sessionId,
          scope: {
            actionTypes: [ActionType.FILE_WRITE],
            allowedPaths: writePaths,
            ...(canonicalAdmittedRoot ? { workspaceRoot: canonicalAdmittedRoot } : {}),
            ...(canonicalSourceBaseline ? { sourceBaselineRoot: canonicalSourceBaseline } : {})
          },
          issuedAt: clock,
          expiresAt: clock + ttlMs,
          revoked: false,
          issuerId
        });
        issuedGrants.push(writeGrant);
      }
    }

    // Issue Create Grant (strictly scoped to createPaths)
    if (createPaths.length > 0) {
      const grantId = `grant-rct-create-${taskId}-${attemptId}`;
      const existing = this.policyService.getGrant(grantId);
      if (existing && !existing.revoked && existing.expiresAt > clock) {
        issuedGrants.push(existing);
      } else {
        if (existing) {
          try { this.policyService.revokeGrant(grantId, 'reissuing_assignment_grant'); } catch { }
        }
        const createGrant = this.policyService.issueGrant({
          schemaVersion: SCHEMA_VERSIONS.GRANT,
          grantId,
          principalId,
          sessionId,
          scope: {
            actionTypes: [ActionType.FILE_CREATE],
            allowedPaths: createPaths,
            ...(canonicalAdmittedRoot ? { workspaceRoot: canonicalAdmittedRoot } : {}),
            ...(canonicalSourceBaseline ? { sourceBaselineRoot: canonicalSourceBaseline } : {})
          },
          issuedAt: clock,
          expiresAt: clock + ttlMs,
          revoked: false,
          issuerId
        });
        issuedGrants.push(createGrant);
      }
    }

    // Issue Command Grants: strictly 1 grant per exact (commandArgv, canonicalCwd) tuple!
    // Eliminates command/directory crossproduct and enforces exact cwd without directory-prefix matching.
    for (let i = 0; i < distinctTuples.length; i++) {
      const { commandArgv, canonicalCwd } = distinctTuples[i];
      const execGrant = this.policyService.issueGrant({
        schemaVersion: SCHEMA_VERSIONS.GRANT,
        grantId: `grant-rct-exec-${taskId}-${attemptId}-${i}`,
        principalId,
        sessionId,
        scope: {
          actionTypes: [ActionType.SHELL_EXEC],
          allowedCommands: [commandArgv],
          allowedPaths: [canonicalCwd],
          exactArgs: true,
          exactCwd: true,
          ...(canonicalAdmittedRoot ? { workspaceRoot: canonicalAdmittedRoot } : {}),
          ...(canonicalSourceBaseline ? { sourceBaselineRoot: canonicalSourceBaseline } : {})
        },
        issuedAt: clock,
        expiresAt: clock + ttlMs,
        revoked: false,
        issuerId
      });
      issuedGrants.push(execGrant);
    }

    return issuedGrants;
  }

  /**
   * Alias to createAssignmentGrants for backwards compatibility.
   * Returns array of issued grants.
   *
   * @param {object} assignment
   * @param {object} [options]
   * @returns {object[]}
   */
  createAssignmentGrant(assignment, options = {}) {
    return this.createAssignmentGrants(assignment, options);
  }
}
