export { Dispatcher } from './dispatcher.js';
export { Journal } from './journal.js';
export { TaskStore, SqliteTaskStore, isSqliteSupported } from './task-store.js';
export { TaskManager } from './task-manager.js';
export { RctAdapterPort } from './rct-adapter-port.js';
export { FakeRctAdapter } from './rct-conformance-fixture.js';
export { States, Bounds, TERMINAL_STATES, Intents, ReviewStates, TERMINAL_REVIEW_STATES } from './types.js';
export {
  RealRctAdapter,
  createIndependentRctVerifier,
  computeCompositeSourceHash,
  validateSourceBaseline
} from './real-rct-adapter.js';
export { ReviewPort } from './review-port.js';
export {
  WorkerStatusProjection,
  WorkerStates,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  sanitizeSummary
} from './worker-projection.js';
export {
  RctHost,
  DEFAULT_WORKER_ID,
  resolveDbPath,
  createSyntheticFixtureProvider
} from './rct-host.js';
export {
  ComputerSessionProjection,
  ComputerSessionStates,
  COMPUTER_SESSION_SCHEMA_VERSION,
  NATIVE_LIMITATION_NOTICE
} from './computer-projection.js';

// Canonical IFZ Unified Architecture Contracts & Primitives
export {
  SCHEMA_VERSIONS,
  EFFECT_CLASSES,
  ROUTE_STRATEGIES,
  CONTEXT_KINDS,
  PUBLIC_EVENT_TYPES,
  WORKER_AVAILABILITY_STATUSES,
  RECEIPT_STATUSES,
  MAX_PAYLOAD_DEPTH,
  MAX_IDENTITY_BYTES,
  MAX_TOTAL_BYTES,
  CONTROL_CHAR_REGEX,
  FORBIDDEN_PROPERTY_NAMES,
  IfzValidationError,
  IfzAuthorityGrowthError,
  IfzConflictError,
  isPlainObject,
  deepFreeze,
  deepClone,
  canonicalJson,
  computeSha256,
  validateIdentity,
  validateStrictBoolean,
  validatePositiveInt,
  validateEffectsArray,
  validateStringArray,
  validateWorkerManifest, // Canonical manifest validation
  createWorkerManifest,
  validateContextReference,
  createContextReference,
  validateRouteRequest,
  createRouteRequest,
  validateTaskEnvelope,
  createTaskEnvelope,
  validatePublicEvent,
  createPublicEvent,
  validateDeliveryReceipt,
  createDeliveryReceipt,
  assertNoAuthorityGrowth,
  sanitizeAndBoundPayload
} from './ifz/contracts.js';

// Authoritative In-Memory Worker Registry
export { WorkerRegistry } from './ifz/worker-registry.js';

// IFZ Route Guard Controls & Verification
export {
  ROUTING_MODES,
  CANONICAL_EXECUTION_STRATEGIES,
  STRATEGY_ALIASES,
  EXECUTION_STRATEGIES,
  DEFAULT_LIMITS,
  DEFAULT_MAX_STALENESS_MS,
  RouteValidationError,
  CapabilityMismatchError,
  AuthorityExpansionError,
  BudgetExceededError,
  CircularRouteError,
  DuplicateWorkerTaskError,
  WorkspaceMismatchError,
  WorkerUnavailableError,
  normalizeStrategy,
  validateInputSafety,
  checkWorkerFreshness,
  checkWorkerQualification,
  hasCapability,
  checkCapabilityCompatibility,
  checkAuthorityNarrowing,
  checkContextNarrowing,
  checkLimitsMonotonicity,
  checkBudgetLimits,
  detectCircularRoute,
  validateRoutePlan
} from './ifz/route-guard.js';

// IFZ Route Planner & Saved Workflow Templates
export {
  SAVED_WORKFLOW_TEMPLATES,
  computeRouteHash,
  planRoute,
  revalidateSavedWorkflow,
  createRoutePreview
} from './ifz/route-planner.js';

// Master Prompt System (Charter, Worker Knowledge, Project Context, Task Package)
export {
  DEFAULT_CHARTER_CONTENT,
  DEFAULT_CHARTER_PRINCIPLES,
  MasterPromptError,
  createCharter,
  createWorkerKnowledge,
  createProjectContext,
  createTaskPackage,
  createMasterPrompt
} from './ifz/master-prompt.js';

// Fresh-Worker Context Package & Worker Acknowledgment Protocol
export {
  DEFAULT_MAX_PACKAGE_BYTES,
  HARD_CEILING_PACKAGE_BYTES,
  MAX_NESTING_DEPTH,
  MAX_ENTRY_BOUNDS,
  ContextPackageError,
  ContextPackageBoundsError,
  ContextPackageSecurityError,
  assertStructuralSafety,
  sanitizeText,
  sanitizeData,
  buildFreshWorkerPackage,
  createWorkerAcknowledgment,
  verifyWorkerAcknowledgment,
  computeCompositeVersion
} from './ifz/context-package.js';

// Versioned Master Prompt Presets
export {
  PRESET_NAMES,
  PRESET_IDS,
  PresetError,
  InvalidPresetApplicationError,
  listPresets,
  getPreset,
  validatePreset,
  applyPreset
} from './ifz/presets.js';
