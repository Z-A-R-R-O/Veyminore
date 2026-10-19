/**
 * Provider Doctor
 *
 * Diagnostic health and configuration check for ZETRO model providers.
 * Outputs ONLY non-secret configuration and boolean key presence indicators.
 * Strictly verifies model catalog eligibility before reporting policy enforcement.
 *
 * Owned by AGR-5.
 */

import { createRequire } from 'node:module';
import { loadProviderConfig } from './loader.js';

const require = createRequire(import.meta.url);

export const MIN_NODE_VERSION = '22.5.0';

/**
 * Parses semver string into major, minor, patch numbers.
 *
 * @param {string} versionStr
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseSemver(versionStr) {
  if (!versionStr || typeof versionStr !== 'string') return null;
  const clean = versionStr.replace(/^[v^>=~]/, '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10));
  if (parts.length < 3 || parts.some(n => Number.isNaN(n) || n < 0)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Checks if currentVersion meets required minimum version.
 *
 * @param {string} currentVersion
 * @param {string} [minVersion]
 * @returns {boolean}
 */
export function isNodeVersionSupported(currentVersion, minVersion = MIN_NODE_VERSION) {
  const cur = parseSemver(currentVersion);
  const min = parseSemver(minVersion);
  if (!cur || !min) return false;
  if (cur.major > min.major) return true;
  if (cur.major < min.major) return false;
  if (cur.minor > min.minor) return true;
  if (cur.minor < min.minor) return false;
  return cur.patch >= min.patch;
}

/**
 * Detects whether node:sqlite DatabaseSync capability is genuinely available.
 * Supports injected boolean or probe function for deterministic testing.
 *
 * @param {boolean | (() => boolean)} [probe]
 * @returns {boolean}
 */
export function isDatabaseSyncAvailable(probe) {
  if (typeof probe === 'function') {
    try {
      return Boolean(probe());
    } catch {
      return false;
    }
  }
  if (typeof probe === 'boolean') {
    return probe;
  }
  try {
    const sqlite = require('node:sqlite');
    return typeof sqlite?.DatabaseSync === 'function';
  } catch {
    return false;
  }
}

/**
 * Checks host Node runtime compatibility against required node:sqlite DatabaseSync version
 * and verifies genuine node:sqlite DatabaseSync capability.
 *
 * @param {string | { version?: string, minVersion?: string, sqliteAvailable?: boolean | (() => boolean) }} [versionOrOptions]
 * @param {string | { minVersion?: string, sqliteAvailable?: boolean | (() => boolean) }} [minVersionOrOptions]
 * @param {{ sqliteAvailable?: boolean | (() => boolean) }} [options]
 * @returns {{ name: string, status: 'PASS' | 'FAIL', message: string, sqliteAvailable: boolean, version: string, minVersion: string }}
 */
export function checkNodeRuntime(versionOrOptions = process.versions.node, minVersionOrOptions = MIN_NODE_VERSION, options = {}) {
  let version = process.versions.node;
  let min = MIN_NODE_VERSION;
  let sqliteProbe;

  if (typeof versionOrOptions === 'object' && versionOrOptions !== null) {
    version = versionOrOptions.version || process.versions.node;
    min = versionOrOptions.minVersion || MIN_NODE_VERSION;
    sqliteProbe = versionOrOptions.sqliteAvailable;
  } else {
    version = typeof versionOrOptions === 'string' ? versionOrOptions : process.versions.node;
    if (typeof minVersionOrOptions === 'object' && minVersionOrOptions !== null) {
      min = minVersionOrOptions.minVersion || MIN_NODE_VERSION;
      sqliteProbe = minVersionOrOptions.sqliteAvailable;
    } else {
      min = typeof minVersionOrOptions === 'string' ? minVersionOrOptions : MIN_NODE_VERSION;
      sqliteProbe = options?.sqliteAvailable;
    }
  }

  const supported = isNodeVersionSupported(version, min);
  const sqliteAvailable = isDatabaseSyncAvailable(sqliteProbe);

  if (!supported) {
    return {
      name: 'Node Runtime',
      status: 'FAIL',
      version,
      minVersion: min,
      sqliteAvailable,
      message: `Node.js runtime 'v${version}' is unsupported: requires Node.js >= ${min} for built-in node:sqlite DatabaseSync transactional store`
    };
  }

  if (!sqliteAvailable) {
    return {
      name: 'Node Runtime',
      status: 'FAIL',
      version,
      minVersion: min,
      sqliteAvailable: false,
      message: `Node.js runtime 'v${version}' satisfies >= ${min}, but node:sqlite DatabaseSync is unavailable (possibly disabled via --no-experimental-sqlite flag or requires --experimental-sqlite on Node 22.5.0–22.11.0)`
    };
  }

  return {
    name: 'Node Runtime',
    status: 'PASS',
    version,
    minVersion: min,
    sqliteAvailable: true,
    message: `Node.js runtime 'v${version}' satisfies required >= ${min} (built-in node:sqlite DatabaseSync verified)`
  };
}

/**
 * Generates a structured doctor diagnostic report.
 *
 * @param {import('./loader.js').ZetroProviderConfig | object} [configOrOptions]
 * @returns {object} Structured non-secret diagnostic report
 */
export function getDoctorReport(configOrOptions) {
  const config = (configOrOptions && typeof configOrOptions.getPublicConfig === 'function')
    ? configOrOptions
    : loadProviderConfig(configOrOptions || {});

  const pub = config.getPublicConfig();
  const diagnostics = [];

  // 1. Invalid Flags Check
  if (pub.invalidFlags && pub.invalidFlags.length > 0) {
    diagnostics.push({
      name: 'Configuration Integrity',
      status: 'FAIL',
      message: `Invalid configuration values detected: ${pub.invalidFlags.join('; ')}`
    });
  } else {
    diagnostics.push({
      name: 'Configuration Integrity',
      status: 'PASS',
      message: 'All configuration flags successfully validated with strict types'
    });
  }

  // 2. Provider Check
  if (pub.provider === 'fake') {
    diagnostics.push({
      name: 'Provider Selection',
      status: 'PASS',
      message: "Using simulated/fake provider (offline-safe, zero cost, default)"
    });
  } else if (['groq', 'opencode', 'openrouter'].includes(pub.provider)) {
    diagnostics.push({
      name: 'Provider Selection',
      status: 'INFO',
      message: `Configured remote provider '${pub.provider}'`
    });
  } else {
    diagnostics.push({
      name: 'Provider Selection',
      status: 'FAIL',
      message: `Unrecognized provider '${pub.provider}'. Supported: fake, groq, opencode, openrouter`
    });
  }

  // 3. Requested Policy (distinct from model eligibility and price evidence)
  if (pub.freeOnly) {
    diagnostics.push({
      name: 'Requested Policy',
      status: 'PASS',
      message: 'Zero-cost free-only policy requested ($0.00 max cost)'
    });
  } else {
    diagnostics.push({
      name: 'Requested Policy',
      status: pub.maxCostUsd > 0 ? 'INFO' : 'FAIL',
      message: pub.maxCostUsd > 0
        ? `Paid policy requested with finite budget: $${pub.maxCostUsd.toFixed(2)} max cost`
        : 'Paid policy requested but budget ceiling is $0.00 (paid mode cannot execute without budget > $0.00)'
    });
  }

  // 4. Model Availability & Eligibility (distinct from policy request)
  const mv = pub.modelVerification;
  if (mv.eligible) {
    diagnostics.push({
      name: 'Model Eligibility',
      status: 'PASS',
      message: `Model '${pub.model}' is eligible for execution under active policy`
    });
  } else {
    diagnostics.push({
      name: 'Model Eligibility',
      status: 'FAIL',
      message: `Model '${pub.model}' is ineligible: ${mv.reason}`
    });
  }

  // 5. Price Evidence (distinct from model eligibility and policy request)
  if (mv.verified === true && typeof mv.pricingProof === 'string' && mv.pricingProof.trim().length > 0) {
    diagnostics.push({
      name: 'Price Evidence',
      status: 'PASS',
      message: `Pricing proof verified: ${mv.pricingProof.trim()}`
    });
  } else {
    diagnostics.push({
      name: 'Price Evidence',
      status: 'FAIL',
      message: `Absent or unverified pricing proof for model '${pub.model}'; cannot certify zero or valid consumption`
    });
  }

  // 5. Concurrency Limit Check
  if (pub.concurrency >= 1 && pub.concurrency <= 5) {
    diagnostics.push({
      name: 'Concurrency Limit',
      status: pub.concurrency === 1 ? 'PASS' : 'INFO',
      message: `${pub.concurrency} worker(s) concurrency within bounded limit [1, 5]`
    });
  } else {
    diagnostics.push({
      name: 'Concurrency Limit',
      status: 'FAIL',
      message: `Concurrency ${pub.concurrency} out of bounds [1, 5]`
    });
  }

  // 6. API Key Presence (Boolean Only)
  const keyItems = Object.entries(pub.keysPresent)
    .map(([p, present]) => `${p}: ${present ? 'PRESENT' : 'NOT SET'}`)
    .join(', ');

  if (pub.provider === 'fake') {
    diagnostics.push({
      name: 'API Key Presence',
      status: 'INFO',
      message: `External keys not required for fake provider (${keyItems})`
    });
  } else {
    const keySet = pub.keysPresent[pub.provider];
    diagnostics.push({
      name: 'API Key Presence',
      status: keySet ? 'PASS' : 'FAIL',
      message: keySet
        ? `API key present for active provider '${pub.provider}'`
        : `Missing API key for active provider '${pub.provider}'`
    });
  }

  // 7. Provider Approval Check (Handling approved-provider list)
  if (pub.provider === 'fake' || pub.providerApproved) {
    diagnostics.push({
      name: 'Provider Approval',
      status: 'PASS',
      message: pub.provider === 'fake'
        ? "Fake provider pre-approved by design"
        : `Provider '${pub.provider}' explicitly approved in ZETRO_APPROVED_PROVIDERS`
    });
  } else {
    diagnostics.push({
      name: 'Provider Approval',
      status: 'FAIL',
      message: `Provider '${pub.provider}' not approved or approved-provider mismatch (requires ZETRO_APPROVED_PROVIDERS)`
    });
  }

  // 8. Live Execution Approval Check
  if (pub.liveAllowed) {
    diagnostics.push({
      name: 'Live Execution',
      status: 'INFO',
      message: 'Live model inference explicitly enabled (ZETRO_LIVE_INFERENCE_ENABLED=1)'
    });
  } else {
    diagnostics.push({
      name: 'Live Execution',
      status: pub.provider === 'fake' ? 'PASS' : 'FAIL',
      message: pub.provider === 'fake'
        ? 'Live model inference disabled (safe offline mode)'
        : 'Live model inference disabled (requires ZETRO_LIVE_INFERENCE_ENABLED=1)'
    });
  }

  // 9. Remote Source Code Sharing Approval Check
  if (pub.sourceSharingApproved) {
    diagnostics.push({
      name: 'Remote Source Sharing',
      status: 'INFO',
      message: 'Remote source transmission explicitly approved (ZETRO_ALLOW_REMOTE_SOURCE=1)'
    });
  } else {
    diagnostics.push({
      name: 'Remote Source Sharing',
      status: pub.provider === 'fake' ? 'PASS' : 'FAIL',
      message: pub.provider === 'fake'
        ? 'Source transmission not required for offline fake provider'
        : 'Remote source code sharing not approved (requires ZETRO_ALLOW_REMOTE_SOURCE=1)'
    });
  }

  // 10. Node Runtime Compatibility (built-in node:sqlite DatabaseSync requirement >= 22.5.0)
  const nodeVersion = (configOrOptions && configOrOptions.injectedNodeVersion) || process.versions.node;
  const sqliteProbe = (configOrOptions && configOrOptions.injectedSqliteAvailable !== undefined)
    ? configOrOptions.injectedSqliteAvailable
    : undefined;
  const runtimeCheck = checkNodeRuntime(nodeVersion, MIN_NODE_VERSION, { sqliteAvailable: sqliteProbe });
  diagnostics.push(runtimeCheck);

  // 11. Overall Readiness (aggregates provider configuration readiness and host runtime readiness)
  const runtimeFailed = runtimeCheck.status === 'FAIL';
  const isOverallReady = pub.status.ready && !runtimeFailed;
  const overallMode = isOverallReady ? pub.status.mode : 'unready';
  const overallReasons = [...pub.status.reasons];
  if (runtimeFailed) {
    overallReasons.push(runtimeCheck.message);
  }

  diagnostics.push({
    name: 'Overall Readiness',
    status: isOverallReady ? 'PASS' : 'FAIL',
    message: isOverallReady
      ? `Ready in mode '${pub.status.mode}'`
      : `Not ready: ${overallReasons.join('; ')}`
  });

  return {
    timestamp: new Date().toISOString(),
    nodeVersion,
    provider: pub.provider,
    model: pub.model,
    concurrency: pub.concurrency,
    freeOnly: pub.freeOnly,
    maxCostUsd: pub.maxCostUsd,
    liveAllowed: pub.liveAllowed,
    sourceSharingApproved: pub.sourceSharingApproved,
    providerApproved: pub.providerApproved,
    approvedProvidersList: pub.approvedProvidersList,
    keysPresent: { ...pub.keysPresent },
    invalidFlags: [...(pub.invalidFlags || [])],
    modelVerification: { ...pub.modelVerification },
    ready: isOverallReady,
    mode: overallMode,
    reasons: overallReasons,
    diagnostics
  };
}

/**
 * Formats a doctor diagnostic report into human-readable text.
 *
 * @param {object} report - Report produced by getDoctorReport
 * @returns {string} Formatted text
 */
export function formatDoctorReport(report) {
  const lines = [];

  lines.push('========================================================================');
  lines.push(' ZETRO Provider Configuration Doctor');
  lines.push('========================================================================');
  lines.push(` Timestamp:              ${report.timestamp}`);
  lines.push(` Node Runtime:           v${report.nodeVersion || process.versions.node}`);
  lines.push(` Active Provider:        ${report.provider}`);
  lines.push(` Selected Model:         ${report.model}`);
  lines.push(` Initial Concurrency:    ${report.concurrency} worker(s)`);
  lines.push(` Free-Only Policy:       ${report.freeOnly} (Max Cost: $${report.maxCostUsd.toFixed(2)})`);
  lines.push(` Live Allowed:           ${report.liveAllowed}`);
  lines.push(` Source Sharing:         ${report.sourceSharingApproved}`);
  lines.push(` Provider Approved:      ${report.providerApproved}`);
  if (report.approvedProvidersList) {
    lines.push(` Approved List:          ${report.approvedProvidersList.join(', ')}`);
  }
  lines.push(` Model Verified:         ${report.modelVerification.verified} (${report.modelVerification.reason})`);
  lines.push(` Pricing Proof:          ${report.modelVerification.pricingProof || 'NONE'}`);
  lines.push('');
  lines.push(' API Key Presence (Boolean Only):');
  lines.push(`   • Groq:               ${report.keysPresent.groq}`);
  lines.push(`   • OpenCode:           ${report.keysPresent.opencode}`);
  lines.push(`   • OpenRouter:         ${report.keysPresent.openrouter}`);
  lines.push('');
  lines.push(' Diagnostic Checks:');

  for (const d of report.diagnostics) {
    const tag = `[${d.status}]`.padEnd(8, ' ');
    lines.push(`   ${tag} ${d.name}: ${d.message}`);
  }

  lines.push('');
  lines.push(` Overall Status: ${report.ready ? 'READY (' + report.mode + ')' : 'BLOCKED / UNREADY'}`);
  lines.push('========================================================================');

  return lines.join('\n');
}

/**
 * Runs the doctor CLI with arguments and I/O streams.
 *
 * @param {string[]} [argv=[]] - Command line arguments
 * @param {object} [io]
 * @param {NodeJS.WritableStream} [io.stdout]
 * @param {NodeJS.WritableStream} [io.stderr]
 * @param {Record<string, string>} [io.env]
 * @returns {{ exitCode: number, report: object, output: string }}
 */
export function runDoctorCli(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const env = io.env || process.env;

  const jsonMode = argv.includes('--json');
  const helpMode = argv.includes('--help') || argv.includes('-h');

  if (helpMode) {
    const helpText = [
      'Usage: zetro-provider-doctor [options]',
      '',
      'Options:',
      '  --json              Output structured diagnostic report as JSON',
      '  --env-file=<path>   Path to synthetic .env file to inspect',
      '  -h, --help          Show this help message',
      ''
    ].join('\n');
    stdout.write(helpText + '\n');
    return { exitCode: 0, report: null, output: helpText };
  }

  const envFileArg = argv.find(a => a.startsWith('--env-file='));
  const envFile = envFileArg ? envFileArg.slice(11) : undefined;

  const config = loadProviderConfig({ env, envFile });
  const report = getDoctorReport({
    ...config,
    getPublicConfig: () => config.getPublicConfig(),
    injectedNodeVersion: io.injectedNodeVersion,
    injectedSqliteAvailable: io.injectedSqliteAvailable
  });

  let outputText;
  if (jsonMode) {
    outputText = JSON.stringify(report, null, 2);
    stdout.write(outputText + '\n');
  } else {
    outputText = formatDoctorReport(report);
    stdout.write(outputText + '\n');
  }

  const exitCode = report.ready ? 0 : 1;
  return { exitCode, report, output: outputText };
}
