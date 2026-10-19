/**
 * @file index.js
 * Main entry point for @zetro/computer-agent.
 *
 * Exposes:
 * - runComputerAgent: Generic prompt-driven Computer Agent runner.
 * - Application Catalog and Safe Launcher: APPLICATION_CATALOG, resolveApplication, createApplicationRegistryPort.
 * - Structured Planner: COMPUTER_AGENT_TOOLS, parseDeterministicIntent, createPlannerPort.
 * - Guarded Action Executor: createGuardedExecutor, validateTargetIdentity.
 * - Independent Outcome Verifiers: createVerifierPort, verifyEditorText, verifyBrowserSearch, verifyWindowsSearch, verifyWhatsAppNavigation.
 * - Authoritative Overlay Bridge: AuthoritativeOverlayBridge, OverlayState.
 * - Durable Recovery Manager: DurableRecoveryManager.
 * - Types and Error Codes: AgentStatus, AgentErrorCode, ComputerAgentError, DEFAULT_AGENT_BUDGETS.
 */

export {
  runComputerAgent
} from './agent-loop.js';

export {
  APPLICATION_CATALOG,
  TESTED_CAPABILITY_MATRIX,
  resolveApplication,
  createApplicationRegistryPort
} from './app-registry.js';

export {
  COMPUTER_AGENT_TOOLS,
  validateToolProposal,
  parseDeterministicIntent,
  createPlannerPort
} from './planner.js';

export {
  createGuardedExecutor,
  validateTargetIdentity
} from './guarded-actions.js';

export {
  createVerifierPort,
  verifyEditorText,
  verifyBrowserSearch,
  verifyWindowsSearch,
  verifyWhatsAppNavigation,
  verifyFileExplorerFolder
} from './verifiers.js';

export {
  AuthoritativeOverlayBridge,
  OverlayState
} from './overlay-bridge.js';

export {
  DurableRecoveryManager
} from './recovery.js';

export {
  AGENT_SCHEMA_VERSION,
  ACTION_SCHEMA_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  AgentStatus,
  SupportedActionTypes,
  AgentErrorCode,
  DEFAULT_AGENT_BUDGETS,
  ComputerAgentError
} from './types.js';

export {
  createExecutionJournal
} from './universal/execution-journal.js';

export {
  createModelRouter,
  ModelRouterError
} from './universal/model-router.js';

export {
  runUniversalComputerAgent,
  UniversalAgentLoopError
} from './universal/universal-loop.js';

export { createDesktopOverlay } from './desktop-overlay.js';
export { createReactiveComputingSkill } from './reactive-skill.js';
export { runExplorerFolderTask } from './explorer-native-host.js';
