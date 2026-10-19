/**
 * @file authority.js
 * Pure, deny-by-default authority evaluator for ZETRO Protocol.
 * Enforces principal/session scope, expiry, revocation, fail-closed path/command scopes,
 * exact-request approval digest semantics, and replay protection.
 * Injected clock support for deterministic testing.
 */

import { validateGrant } from './validators/grant.js';
import { validateActionRequest } from './validators/action-request.js';
import { isPathInScope } from './path.js';
import { ActionType } from './constants.js';

/**
 * Evaluates whether an ActionRequest is authorized by a Grant.
 * Deny-by-default: any mismatch, expiration, revocation, missing session,
 * unconstrained scope, or invalid structure fails closed.
 *
 * @param {any} rawGrant - The Grant authorization object
 * @param {any} rawRequest - The ActionRequest to evaluate
 * @param {object} [options]
 * @param {number} [options.currentTime] - Injected timestamp in epoch ms (defaults to Date.now())
 * @param {boolean} [options.verifyDigest] - Strictly verify requestDigest matches actionType and parameters
 * @param {Set<string>|string[]} [options.consumedRequestIds] - Replay cache of consumed request IDs
 * @returns {{ granted: boolean, reason?: string, details?: object }}
 */
export function evaluateGrant(rawGrant, rawRequest, options = {}) {
  const clock = options.currentTime ?? Date.now();

  let grant;
  try {
    grant = validateGrant(rawGrant, { throwOnError: true });
  } catch (err) {
    return {
      granted: false,
      reason: 'invalid_grant',
      details: { error: err.message, errors: err.errors }
    };
  }

  let request;
  try {
    request = validateActionRequest(rawRequest, {
      throwOnError: true,
      verifyDigest: options.verifyDigest ?? true
    });
  } catch (err) {
    return {
      granted: false,
      reason: 'invalid_request',
      details: { error: err.message, errors: err.errors }
    };
  }

  // 1. Replay / consumption check
  if (options.consumedRequestIds) {
    const isConsumed = options.consumedRequestIds instanceof Set
      ? options.consumedRequestIds.has(request.requestId)
      : Array.isArray(options.consumedRequestIds) && options.consumedRequestIds.includes(request.requestId);
    if (isConsumed) {
      return {
        granted: false,
        reason: 'request_already_consumed',
        details: { requestId: request.requestId }
      };
    }
  }

  if (options.consumedExactDigests) {
    const isDigestConsumed = options.consumedExactDigests instanceof Set
      ? options.consumedExactDigests.has(request.requestDigest)
      : Array.isArray(options.consumedExactDigests) && options.consumedExactDigests.includes(request.requestDigest);
    if (isDigestConsumed) {
      return {
        granted: false,
        reason: 'request_already_consumed',
        details: { requestDigest: request.requestDigest }
      };
    }
  }

  // 2. Revocation check
  if (grant.revoked) {
    return {
      granted: false,
      reason: 'grant_revoked',
      details: {
        revokedAt: grant.revokedAt,
        revocationReason: grant.revocationReason
      }
    };
  }

  // 3. Expiry checks (fail-closed at exact boundary: clock >= expiresAt)
  if (clock >= grant.expiresAt) {
    return {
      granted: false,
      reason: 'grant_expired',
      details: {
        expiresAt: grant.expiresAt,
        currentTime: clock,
        exceededByMs: clock - grant.expiresAt
      }
    };
  }

  if (clock < grant.issuedAt) {
    return {
      granted: false,
      reason: 'grant_not_yet_valid',
      details: {
        issuedAt: grant.issuedAt,
        currentTime: clock
      }
    };
  }

  // 4. Principal matching
  if (grant.principalId !== request.principalId) {
    return {
      granted: false,
      reason: 'principal_mismatch',
      details: {
        expected: grant.principalId,
        received: request.principalId
      }
    };
  }

  // 5. Session matching: grant is strictly session-scoped; request MUST supply matching sessionId
  if (!request.sessionId || grant.sessionId !== request.sessionId) {
    return {
      granted: false,
      reason: 'session_mismatch',
      details: {
        expected: grant.sessionId,
        received: request.sessionId ?? null
      }
    };
  }

  // 6. Action type scope
  if (!grant.scope.actionTypes.includes(request.actionType)) {
    return {
      granted: false,
      reason: 'action_type_not_permitted',
      details: {
        actionType: request.actionType,
        permittedTypes: grant.scope.actionTypes
      }
    };
  }

  // 7. Exact request digest approval semantics
  if (grant.scope.exactRequestDigest) {
    if (grant.scope.exactRequestDigest !== request.requestDigest) {
      return {
        granted: false,
        reason: 'exact_request_digest_mismatch',
        details: {
          expectedDigest: grant.scope.exactRequestDigest,
          actualDigest: request.requestDigest
        }
      };
    }
  }

  // 8. Fail-closed path scope checks for file actions
  const isFileAction = [
    ActionType.FILE_READ,
    ActionType.FILE_WRITE,
    ActionType.FILE_CREATE,
    ActionType.FILE_DELETE
  ].includes(request.actionType);

  if (isFileAction) {
    if (grant.scope.sourceBaselineRoot && request.parameters.workspaceRoot === grant.scope.sourceBaselineRoot) {
      return {
        granted: false,
        reason: 'source_baseline_mutation_denied',
        details: {
          actionType: request.actionType,
          sourceBaselineRoot: grant.scope.sourceBaselineRoot,
          message: 'Direct action against source baseline repository is denied; isolated snapshot root required'
        }
      };
    }

    if (grant.scope.workspaceRoot !== undefined && grant.scope.workspaceRoot !== null) {
      if (!request.parameters.workspaceRoot) {
        return {
          granted: false,
          reason: 'missing_workspace_root',
          details: {
            actionType: request.actionType,
            expectedWorkspaceRoot: grant.scope.workspaceRoot,
            message: 'File action requires explicit workspaceRoot in parameters matching grant scope'
          }
        };
      }
      if (request.parameters.workspaceRoot !== grant.scope.workspaceRoot) {
        return {
          granted: false,
          reason: 'workspace_root_mismatch',
          details: {
            actionType: request.actionType,
            expected: grant.scope.workspaceRoot,
            actual: request.parameters.workspaceRoot,
            message: 'Actual workspace root does not match admitted grant workspace root'
          }
        };
      }
    }

    if (!grant.scope.allowedPaths || grant.scope.allowedPaths.length === 0) {
      return {
        granted: false,
        reason: 'no_paths_in_grant_scope',
        details: {
          actionType: request.actionType,
          targetPath: request.parameters.path,
          message: 'File actions require explicit non-empty allowedPaths in grant scope'
        }
      };
    }

    const targetPath = request.parameters.path;
    if (!isPathInScope(targetPath, grant.scope.allowedPaths)) {
      return {
        granted: false,
        reason: 'path_outside_grant_scope',
        details: {
          targetPath,
          allowedPaths: grant.scope.allowedPaths
        }
      };
    }
  }

  // 9. Fail-closed command and path scope checks for shell execution
  if (request.actionType === ActionType.SHELL_EXEC) {
    // A. Working directory scope check (omission cannot bypass scope)
    if (!grant.scope.allowedPaths || grant.scope.allowedPaths.length === 0) {
      return {
        granted: false,
        reason: 'no_cwds_in_grant_scope',
        details: {
          message: 'Shell execution requires explicit non-empty allowedPaths (authorized cwds) in grant scope'
        }
      };
    }

    if (!request.parameters.cwd) {
      return {
        granted: false,
        reason: 'missing_shell_cwd',
        details: {
          message: 'Shell execution requires explicit cwd parameter when grant defines allowedPaths'
        }
      };
    }

    if (grant.scope.sourceBaselineRoot && (request.parameters.cwd === grant.scope.sourceBaselineRoot || request.parameters.workspaceRoot === grant.scope.sourceBaselineRoot)) {
      return {
        granted: false,
        reason: 'source_baseline_execution_denied',
        details: {
          cwd: request.parameters.cwd,
          sourceBaselineRoot: grant.scope.sourceBaselineRoot,
          message: 'Shell execution directly within source baseline repository is denied'
        }
      };
    }

    // Working directory must match authorized cwd.
    // Disallow directory prefix / descendant cwd matching (unless exactCwd is explicitly false).
    const isCwdAllowed = grant.scope.exactCwd === false
      ? isPathInScope(request.parameters.cwd, grant.scope.allowedPaths)
      : grant.scope.allowedPaths.includes(request.parameters.cwd);

    if (!isCwdAllowed) {
      return {
        granted: false,
        reason: 'cwd_outside_grant_scope',
        details: {
          cwd: request.parameters.cwd,
          allowedPaths: grant.scope.allowedPaths
        }
      };
    }

    if (grant.scope.workspaceRoot !== undefined && grant.scope.workspaceRoot !== null) {
      if (request.parameters.workspaceRoot && request.parameters.workspaceRoot !== grant.scope.workspaceRoot) {
        return {
          granted: false,
          reason: 'workspace_root_mismatch',
          details: {
            actionType: request.actionType,
            expected: grant.scope.workspaceRoot,
            actual: request.parameters.workspaceRoot,
            message: 'Actual workspace root does not match admitted grant workspace root'
          }
        };
      }
    }

    // B. Command scope check
    // If exactRequestDigest is set, the exact command and arguments are cryptographically verified.
    // Otherwise, require explicit allowedCommands in grant scope.
    if (!grant.scope.exactRequestDigest) {
      if (!grant.scope.allowedCommands || grant.scope.allowedCommands.length === 0) {
        return {
          granted: false,
          reason: 'unscoped_shell_command',
          details: {
            message: 'Shell execution without exactRequestDigest requires non-empty allowedCommands in grant scope'
          }
        };
      }

      const reqCmd = request.parameters.command;
      const isAllowed = grant.scope.allowedCommands.some(allowed => {
        if (typeof allowed === 'string') {
          if (grant.scope.exactArgs) {
            return reqCmd.length === 1 && reqCmd[0] === allowed;
          }
          return reqCmd[0] === allowed;
        }
        if (Array.isArray(allowed)) {
          if (grant.scope.exactArgs) {
            if (reqCmd.length !== allowed.length) return false;
            return allowed.every((arg, idx) => reqCmd[idx] === arg);
          }
          if (reqCmd.length < allowed.length) return false;
          return allowed.every((arg, idx) => reqCmd[idx] === arg);
        }
        return false;
      });

      if (!isAllowed) {
        return {
          granted: false,
          reason: 'command_not_permitted',
          details: {
            command: reqCmd,
            allowedCommands: grant.scope.allowedCommands
          }
        };
      }
    }
  }

  // 10. Fail-closed target/display scope checks for screen capture
  if (request.actionType === ActionType.SCREEN_CAPTURE) {
    if (grant.scope.allowedDisplays && grant.scope.allowedDisplays.length > 0) {
      const requestedDisplay = request.parameters?.displayId;
      const isDisplayAllowed = grant.scope.allowedDisplays.some(
        d => d === requestedDisplay || String(d) === String(requestedDisplay)
      );
      if (!isDisplayAllowed) {
        return {
          granted: false,
          reason: 'target_outside_grant_scope',
          details: {
            requestedDisplay,
            allowedDisplays: grant.scope.allowedDisplays
          }
        };
      }
    }
  }

  // All checks passed
  return {
    granted: true,
    grantId: grant.grantId,
    requestId: request.requestId,
    principalId: grant.principalId,
    sessionId: grant.sessionId,
    actionType: request.actionType
  };
}

/** Alias to evaluateGrant for authority evaluation consistency */
export const evaluateAuthority = evaluateGrant;
