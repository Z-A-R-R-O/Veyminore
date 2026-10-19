import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getDoctorReport,
  formatDoctorReport,
  runDoctorCli,
  MIN_NODE_VERSION,
  isNodeVersionSupported,
  isDatabaseSyncAvailable,
  checkNodeRuntime
} from '../src/doctor.js';
import { loadProviderConfig } from '../src/loader.js';
import { createCatalogSnapshotPort } from '../src/catalog-validator.js';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  checkRuntimePreflight,
  validateWorkspacePackageInventory,
  isDatabaseSyncAvailable: isDatabaseSyncAvailableScript,
  SUITES
} = require('../../../scripts/zetro-check.js');

const SYNTHETIC_CATALOG = Object.freeze({
  groq: {
    'openai/gpt-oss-120b': {
      isFree: true,
      pricing: { inputCostPerM: 0, outputCostPerM: 0 },
      pricingProof: 'Groq official free tier (30 RPM, 1000 RPD, 8000 TPM, 200k TPD)'
    },
    'openai/gpt-4o': {
      isFree: false,
      pricing: { inputCostPerM: 5, outputCostPerM: 15 },
      pricingProof: null
    }
  }
});

const syntheticPort = createCatalogSnapshotPort(SYNTHETIC_CATALOG);

test('getDoctorReport distinct diagnostic dimensions', async (t) => {
  await t.test('evaluates fake default config with all distinct dimensions including Node Runtime', () => {
    const config = loadProviderConfig({ env: {} });
    const report = getDoctorReport(config);

    assert.strictEqual(report.provider, 'fake');
    assert.strictEqual(report.model, 'fake-model');
    assert.strictEqual(report.concurrency, 1);
    assert.strictEqual(report.freeOnly, true);
    assert.strictEqual(report.ready, true);
    assert.strictEqual(report.mode, 'offline-safe');

    assert.ok(Array.isArray(report.diagnostics));

    // Verify distinct dimensions exist as independent checks:
    const checkNames = report.diagnostics.map(d => d.name);
    assert.ok(checkNames.includes('Requested Policy'), 'Must have distinct Requested Policy check');
    assert.ok(checkNames.includes('API Key Presence'), 'Must have distinct Provider Auth / API Key check');
    assert.ok(checkNames.includes('Live Execution'), 'Must have distinct Live Capability check');
    assert.ok(checkNames.includes('Model Eligibility'), 'Must have distinct Model Eligibility check');
    assert.ok(checkNames.includes('Price Evidence'), 'Must have distinct Price Evidence check');
    assert.ok(checkNames.includes('Node Runtime'), 'Must have distinct Node Runtime check');

    // In fake default on Node >= 22.5.0, all checks are pass or info
    const failChecks = report.diagnostics.filter(d => d.status === 'FAIL');
    assert.strictEqual(failChecks.length, 0);
  });

  await t.test('distinguishes requested policy from model eligibility and price evidence', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-4o',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      },
      catalogPort: syntheticPort
    });
    const report = getDoctorReport(config);

    const policyCheck = report.diagnostics.find(d => d.name === 'Requested Policy');
    assert.strictEqual(policyCheck.status, 'PASS', 'Requested Policy should report what policy was requested');

    const eligibilityCheck = report.diagnostics.find(d => d.name === 'Model Eligibility');
    assert.strictEqual(eligibilityCheck.status, 'FAIL', 'Model Eligibility must fail for in-eligible model');

    const priceCheck = report.diagnostics.find(d => d.name === 'Price Evidence');
    assert.strictEqual(priceCheck.status, 'FAIL', 'Price Evidence must fail when pricing proof is absent');

    assert.strictEqual(report.ready, false);
  });

  await t.test('P2 regression: Price Evidence fails when model is unverified even if proof string is present', () => {
    const unverifiedConfig = {
      getPublicConfig: () => ({
        provider: 'groq',
        model: 'unverified-model',
        concurrency: 1,
        freeOnly: true,
        maxCostUsd: 0,
        liveAllowed: false,
        sourceSharingApproved: false,
        providerApproved: true,
        keysPresent: { groq: true, opencode: false, openrouter: false },
        invalidFlags: [],
        modelVerification: {
          verified: false,
          eligible: false,
          isFree: false,
          pricingProof: 'Claimed free tier by untrusted source',
          reason: 'Model failed verification check'
        },
        status: {
          ready: false,
          mode: 'unready',
          reasons: ['Model failed verification check']
        }
      })
    };

    const report = getDoctorReport(unverifiedConfig);
    const priceCheck = report.diagnostics.find(d => d.name === 'Price Evidence');
    assert.strictEqual(priceCheck.status, 'FAIL', 'Price Evidence MUST FAIL when verified is false, even if proof string exists');
    assert.match(priceCheck.message, /Absent or unverified pricing proof/);
  });

  await t.test('Price Evidence passes only when verified === true and proof string is valid', () => {
    const verifiedConfig = {
      getPublicConfig: () => ({
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        concurrency: 1,
        freeOnly: true,
        maxCostUsd: 0,
        liveAllowed: false,
        sourceSharingApproved: false,
        providerApproved: true,
        keysPresent: { groq: true, opencode: false, openrouter: false },
        invalidFlags: [],
        modelVerification: {
          verified: true,
          eligible: true,
          isFree: true,
          pricingProof: 'Groq official free tier rate limits table',
          reason: 'Verified in catalog snapshot'
        },
        status: {
          ready: true,
          mode: 'offline-safe',
          reasons: []
        }
      })
    };

    const report = getDoctorReport(verifiedConfig);
    const priceCheck = report.diagnostics.find(d => d.name === 'Price Evidence');
    assert.strictEqual(priceCheck.status, 'PASS');
    assert.strictEqual(priceCheck.message, 'Pricing proof verified: Groq official free tier rate limits table');
  });

  await t.test('reports configuration integrity failure on invalid flags', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_FREE_ONLY: 'typo'
      }
    });
    const report = getDoctorReport(config);

    const integrityCheck = report.diagnostics.find(d => d.name === 'Configuration Integrity');
    assert.strictEqual(integrityCheck.status, 'FAIL');
    assert.match(integrityCheck.message, /Invalid configuration values detected/);
    assert.strictEqual(report.ready, false);
  });
});

test('Node runtime version compatibility and preflight checks (W3-AGR5-runtime-baseline)', async (t) => {
  await t.test('declares truthful minimum Node.js version >= 22.5.0 for node:sqlite DatabaseSync', () => {
    assert.strictEqual(MIN_NODE_VERSION, '22.5.0');
  });

  await t.test('isNodeVersionSupported correctly evaluates versions against >= 22.5.0', () => {
    // Unsupported versions (Node 20, 21, and 22 < 22.5.0 do not have built-in node:sqlite DatabaseSync)
    assert.strictEqual(isNodeVersionSupported('18.19.0'), false);
    assert.strictEqual(isNodeVersionSupported('20.0.0'), false);
    assert.strictEqual(isNodeVersionSupported('20.12.2'), false);
    assert.strictEqual(isNodeVersionSupported('21.7.3'), false);
    assert.strictEqual(isNodeVersionSupported('22.0.0'), false);
    assert.strictEqual(isNodeVersionSupported('22.4.9'), false);

    // Supported versions (Node >= 22.5.0)
    assert.strictEqual(isNodeVersionSupported('22.5.0'), true);
    assert.strictEqual(isNodeVersionSupported('22.5.1'), true);
    assert.strictEqual(isNodeVersionSupported('22.6.0'), true);
    assert.strictEqual(isNodeVersionSupported('24.0.0'), true);
    assert.strictEqual(isNodeVersionSupported('26.10.0'), true);

    // Invalid / malformed version strings fail closed
    assert.strictEqual(isNodeVersionSupported(''), false);
    assert.strictEqual(isNodeVersionSupported('invalid'), false);
    assert.strictEqual(isNodeVersionSupported(null), false);
  });

  await t.test('checkNodeRuntime returns PASS for supported versions and FAIL for unsupported versions', () => {
    const passResult = checkNodeRuntime('22.5.0');
    assert.strictEqual(passResult.name, 'Node Runtime');
    assert.strictEqual(passResult.status, 'PASS');
    assert.match(passResult.message, /satisfies required >= 22.5.0/);

    const failResult = checkNodeRuntime('20.0.0');
    assert.strictEqual(failResult.name, 'Node Runtime');
    assert.strictEqual(failResult.status, 'FAIL');
    assert.match(failResult.message, /requires Node.js >= 22.5.0 for built-in node:sqlite/);
  });

  await t.test('getDoctorReport reflects injected unsupported Node version and aggregates into unready status', () => {
    // Injected unsupported Node version (e.g. 20.0.0)
    const report = getDoctorReport({ env: {}, injectedNodeVersion: '20.0.0' });
    const runtimeCheck = report.diagnostics.find(d => d.name === 'Node Runtime');

    assert.ok(runtimeCheck, 'Must include Node Runtime check');
    assert.strictEqual(runtimeCheck.status, 'FAIL', 'Unsupported Node 20.0.0 must yield FAIL in Node Runtime check');
    assert.match(runtimeCheck.message, /requires Node.js >= 22.5.0/);

    // Overall readiness aggregates host runtime check failure
    assert.strictEqual(report.ready, false, 'Overall readiness must fail closed when Node runtime check fails');
    assert.strictEqual(report.mode, 'unready');
    assert.ok(report.reasons.some(r => r.includes('requires Node.js >= 22.5.0')));
  });

  await t.test('zetro-check preflight check correctly fails on injected unsupported versions', () => {
    const unsupportedPreflight = checkRuntimePreflight({ injectedVersion: '20.0.0' });
    assert.strictEqual(unsupportedPreflight.ok, false);
    assert.match(unsupportedPreflight.message, /Unsupported Node.js runtime 'v20.0.0'/);
    assert.match(unsupportedPreflight.message, /node:sqlite DatabaseSync/);

    const supportedPreflight = checkRuntimePreflight({ injectedVersion: '22.5.0' });
    assert.strictEqual(supportedPreflight.ok, true);
    assert.match(supportedPreflight.message, /satisfies minimum >= 22.5.0/);
  });
});

test('Node runtime genuine DatabaseSync availability and workspace inventory integrity (W3R-AGR5-sqlite-policy-baseline)', async (t) => {
  await t.test('isDatabaseSyncAvailable detects genuine SQLite DatabaseSync or reflects injected probe', () => {
    // Current environment (Node >= 22.5.0) has DatabaseSync
    assert.strictEqual(isDatabaseSyncAvailable(), true);
    assert.strictEqual(isDatabaseSyncAvailableScript(), true);

    // Explicit boolean probe injection
    assert.strictEqual(isDatabaseSyncAvailable(true), true);
    assert.strictEqual(isDatabaseSyncAvailable(false), false);

    // Functional probe injection (e.g. simulating runtime without DatabaseSync)
    assert.strictEqual(isDatabaseSyncAvailable(() => true), true);
    assert.strictEqual(isDatabaseSyncAvailable(() => false), false);
    assert.strictEqual(isDatabaseSyncAvailable(() => { throw new Error('ERR_UNKNOWN_BUILTIN_MODULE'); }), false);
  });

  await t.test('checkNodeRuntime fails closed when runtime version satisfies >= 22.5.0 but SQLite is unavailable', () => {
    // Version is 22.5.0, but sqlite is disabled (simulating --no-experimental-sqlite)
    const result = checkNodeRuntime('22.5.0', MIN_NODE_VERSION, { sqliteAvailable: false });
    assert.strictEqual(result.status, 'FAIL');
    assert.strictEqual(result.sqliteAvailable, false);
    assert.match(result.message, /node:sqlite DatabaseSync is unavailable/);
    assert.match(result.message, /--no-experimental-sqlite/);
  });

  await t.test('getDoctorReport fails Node Runtime diagnostic and aggregates into unready status when sqlite is unavailable', () => {
    const report = getDoctorReport({ env: {}, injectedNodeVersion: '22.5.0', injectedSqliteAvailable: false });
    const runtimeCheck = report.diagnostics.find(d => d.name === 'Node Runtime');

    assert.ok(runtimeCheck);
    assert.strictEqual(runtimeCheck.status, 'FAIL');
    assert.strictEqual(runtimeCheck.sqliteAvailable, false);
    assert.match(runtimeCheck.message, /node:sqlite DatabaseSync is unavailable/);

    assert.strictEqual(report.ready, false, 'Report ready must be false when sqlite is unavailable');
    assert.strictEqual(report.mode, 'unready');
    assert.ok(report.reasons.some(r => r.includes('node:sqlite DatabaseSync is unavailable')));

    const overallDiag = report.diagnostics.find(d => d.name === 'Overall Readiness');
    assert.ok(overallDiag);
    assert.strictEqual(overallDiag.status, 'FAIL');
    assert.match(overallDiag.message, /node:sqlite DatabaseSync is unavailable/);
  });

  await t.test('zetro-check preflight fails closed when version is valid but sqlite is disabled', () => {
    const preflight = checkRuntimePreflight({ injectedVersion: '22.5.0', injectedSqliteAvailable: false });
    assert.strictEqual(preflight.ok, false);
    assert.strictEqual(preflight.reason, 'sqlite_unavailable');
    assert.strictEqual(preflight.sqliteAvailable, false);
    assert.match(preflight.message, /node:sqlite DatabaseSync is unavailable/);
    assert.match(preflight.message, /--no-experimental-sqlite/);
  });

  await t.test('SUITES includes packages/policy (@zetro/policy) and offline-smoke bringing suite total to active count', () => {
    assert.ok(SUITES.length >= 16);
    const policySuite = SUITES.find(s => s.id === 'policy');
    assert.ok(policySuite, 'policy suite must be present in SUITES');
    assert.strictEqual(policySuite.packageName, '@zetro/policy');
    assert.strictEqual(policySuite.directory, 'packages/policy');
    assert.deepStrictEqual(policySuite.commands, [
      { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
    ]);
    const smokeSuite = SUITES.find(s => s.id === 'offline-smoke');
    assert.ok(smokeSuite, 'offline-smoke suite must be present in SUITES');
    assert.strictEqual(smokeSuite.packageName, 'zetro-offline-smoke');
  });

  await t.test('validateWorkspacePackageInventory verifies all discovered workspace packages and prevents silent omissions', () => {
    const valid = validateWorkspacePackageInventory();
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(valid.missing.length, 0);
    assert.ok(valid.discoveredCount >= 13);
    assert.match(valid.message, /All \d+ workspace packages verified/);

    // Simulating omission of policy suite
    const filteredSuites = SUITES.filter(s => s.id !== 'policy');
    const invalid = validateWorkspacePackageInventory(undefined, filteredSuites);
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.missing.length, 1);
    assert.strictEqual(invalid.missing[0].name, '@zetro/policy');
    assert.strictEqual(invalid.missing[0].directory, 'packages/policy');
    assert.match(invalid.message, /Workspace package inventory mismatch: 1 package\(s\) missing/);
  });
});

test('formatDoctorReport produces non-empty formatted text with distinct evidence lines', () => {
  const config = loadProviderConfig({ env: {} });
  const report = getDoctorReport(config);
  const text = formatDoctorReport(report);

  assert.ok(text.includes('ZETRO Provider Configuration Doctor'));
  assert.ok(text.includes('Node Runtime:'));
  assert.ok(text.includes('Active Provider:        fake'));
  assert.ok(text.includes('Initial Concurrency:    1 worker(s)'));
  assert.ok(text.includes('Pricing Proof:          In-memory deterministic offline simulation'));
  assert.ok(text.includes('Overall Status: READY'));
});

test('runDoctorCli execution and exit codes', async (t) => {
  await t.test('exits 0 for default safe fake provider', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli([], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: {}
    });

    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.report.ready, true);
    assert.ok(stdoutBuffer.includes('ZETRO Provider Configuration Doctor'));
    assert.ok(stdoutBuffer.includes('Node Runtime:'));
  });

  await t.test('exits 1 for unapproved remote provider', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli([], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: { ZETRO_PROVIDER: 'groq' }
    });

    assert.strictEqual(res.exitCode, 1);
    assert.strictEqual(res.report.ready, false);
  });

  await t.test('outputs structured JSON when --json flag is provided', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli(['--json'], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: {}
    });

    assert.strictEqual(res.exitCode, 0);
    const parsed = JSON.parse(stdoutBuffer);
    assert.strictEqual(parsed.provider, 'fake');
    assert.strictEqual(parsed.ready, true);
    assert.ok(parsed.modelVerification);
    assert.ok(parsed.nodeVersion);
  });

  await t.test('exits 1 and outputs BLOCKED / UNREADY in text mode when runtime check fails (injectedSqliteAvailable: false)', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli([], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: {},
      injectedSqliteAvailable: false
    });

    assert.strictEqual(res.exitCode, 1, 'CLI must exit 1 when runtime check fails');
    assert.strictEqual(res.report.ready, false);
    assert.strictEqual(res.report.mode, 'unready');
    assert.ok(stdoutBuffer.includes('[FAIL]   Node Runtime:'));
    assert.ok(stdoutBuffer.includes('[FAIL]   Overall Readiness:'));
    assert.ok(stdoutBuffer.includes('Overall Status: BLOCKED / UNREADY'));
  });

  await t.test('outputs structured JSON with ready: false and exits 1 when --json flag is provided and runtime fails', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli(['--json'], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: {},
      injectedSqliteAvailable: false
    });

    assert.strictEqual(res.exitCode, 1, 'CLI must exit 1 when runtime check fails in JSON mode');
    assert.strictEqual(res.report.ready, false);
    const parsed = JSON.parse(stdoutBuffer);
    assert.strictEqual(parsed.ready, false);
    assert.strictEqual(parsed.mode, 'unready');
    assert.ok(parsed.reasons.some(r => r.includes('node:sqlite DatabaseSync is unavailable')));

    const nodeRuntimeDiag = parsed.diagnostics.find(d => d.name === 'Node Runtime');
    assert.ok(nodeRuntimeDiag);
    assert.strictEqual(nodeRuntimeDiag.status, 'FAIL');

    const overallDiag = parsed.diagnostics.find(d => d.name === 'Overall Readiness');
    assert.ok(overallDiag);
    assert.strictEqual(overallDiag.status, 'FAIL');
  });

  await t.test('displays help and exits 0 on --help', () => {
    let stdoutBuffer = '';
    const res = runDoctorCli(['--help'], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } }
    });

    assert.strictEqual(res.exitCode, 0);
    assert.ok(stdoutBuffer.includes('Usage: zetro-provider-doctor'));
  });
});

test('Actual subprocess --no-experimental-sqlite regression with synthetic env (W3R2-AGR5-runtime-readiness)', async (t) => {
  const binDoctorPath = path.resolve(__dirname, '../bin/doctor.js');

  await t.test('subprocess with --no-experimental-sqlite exits 1 and prints BLOCKED in text mode', async () => {
    const { code, stdout, stderr } = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--no-experimental-sqlite', binDoctorPath], {
        env: { ...process.env, NODE_ENV: 'test', ZETRO_PROVIDER: 'fake' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('close', (c) => resolve({ code: c, stdout: out, stderr: err }));
    });

    assert.strictEqual(code, 1, `Subprocess must exit 1 when sqlite is disabled, got exit code ${code}`);
    assert.ok(stdout.includes('[FAIL]   Node Runtime:'), 'Must report FAIL on Node Runtime check');
    assert.ok(stdout.includes('node:sqlite DatabaseSync is unavailable'), 'Must explain that DatabaseSync is unavailable');
    assert.ok(stdout.includes('[FAIL]   Overall Readiness:'), 'Must report FAIL on Overall Readiness diagnostic');
    assert.ok(stdout.includes('Overall Status: BLOCKED / UNREADY'), 'Must report Overall Status: BLOCKED / UNREADY in text output');
  });

  await t.test('subprocess with --no-experimental-sqlite --json exits 1 and outputs matching JSON report', async () => {
    const { code, stdout, stderr } = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--no-experimental-sqlite', binDoctorPath, '--json'], {
        env: { ...process.env, NODE_ENV: 'test', ZETRO_PROVIDER: 'fake' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('close', (c) => resolve({ code: c, stdout: out, stderr: err }));
    });

    assert.strictEqual(code, 1, `Subprocess must exit 1 when sqlite is disabled in JSON mode, got exit code ${code}`);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.ready, false, 'JSON output ready must be false');
    assert.strictEqual(parsed.mode, 'unready', 'JSON output mode must be unready');
    assert.ok(parsed.reasons.some(r => r.includes('node:sqlite DatabaseSync is unavailable')), 'Reasons must include DatabaseSync unavailable message');

    const nodeRuntimeDiag = parsed.diagnostics.find(d => d.name === 'Node Runtime');
    assert.ok(nodeRuntimeDiag);
    assert.strictEqual(nodeRuntimeDiag.status, 'FAIL');
    assert.strictEqual(nodeRuntimeDiag.sqliteAvailable, false);

    const overallDiag = parsed.diagnostics.find(d => d.name === 'Overall Readiness');
    assert.ok(overallDiag);
    assert.strictEqual(overallDiag.status, 'FAIL');
    assert.match(overallDiag.message, /node:sqlite DatabaseSync is unavailable/);
  });
});
