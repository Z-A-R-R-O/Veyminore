/**
 * @zetro/provider-config
 *
 * Dependency-free, secret-safe provider configuration loader and doctor CLI.
 * Enforces zero-cost defaults, strict booleans, fake default, explicit multi-gate
 * approvals, model catalog pricing proofs, and 1-worker initial concurrency.
 *
 * Owned by AGR-5.
 */

export {
  parseStrictBoolean,
  parseStrictBooleanFlag,
  isStrictTrue,
  isStrictFalse
} from './boolean.js';

export {
  parseStrictInteger,
  parseStrictCost
} from './numeric.js';

export {
  validateModelEligibility,
  createCatalogSnapshotPort
} from './catalog-validator.js';

export { parseDotEnv, parseDotEnvFile } from './parser.js';

export {
  loadProviderConfig,
  KNOWN_PROVIDERS,
  DEFAULT_MODELS
} from './loader.js';

export {
  getDoctorReport,
  formatDoctorReport,
  runDoctorCli,
  MIN_NODE_VERSION,
  isNodeVersionSupported,
  isDatabaseSyncAvailable,
  checkNodeRuntime
} from './doctor.js';
