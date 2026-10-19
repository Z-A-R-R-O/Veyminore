#!/usr/bin/env node
/**
 * @file cli.js
 * Dependency-free CLI for the Computer conformance package (OCR-W3).
 * Runs the existing offline actual-package integration + negative suite, prints a
 * bounded JSON report, and exits nonzero on any scenario failure.
 * `--native-live` fails closed: blocked, never self-certified. No network, shell
 * runner, desktop operations, or secrets.
 */

import { pathToFileURL } from 'node:url';
import { runOfflineIntegration, runNegativeSuite, INTEGRATION_LABEL } from './actual-integration.js';

export const REPORT_SCHEMA_VERSION = 'zetro.computer-conformance.report.alpha.v1';
export const REPORT_MAX_BYTES = 16384;

/** Actual accepted packages consumed by the integration (src entrypoints). */
export const ACTUAL_PACKAGES = Object.freeze([
  { name: 'computer-contract', role: 'OCR-1', entry: 'packages/computer-contract/src/index.js' },
  { name: 'computer-runtime', role: 'OCR-2', entry: 'packages/computer-runtime/src/index.js' },
  { name: 'computer-observer', role: 'OCR-3', entry: 'packages/computer-observer/src/index.js' }
]);

export const EXIT = Object.freeze({ PASS: 0, SCENARIO_FAILURE: 1, NATIVE_LIVE_BLOCKED: 2 });

const PASS_OUTCOMES = Object.freeze(['pass', 'rejected', 'never_verified']);

/** Fail-closed scenario summary -> exit code. Unknown outcomes count as failures. */
export function summarizeScenarios(scenarios) {
  const failures = scenarios.filter(s => !PASS_OUTCOMES.includes(s.outcome));
  return { failures: failures.length, failureNames: failures.map(f => f.name) };
}

export async function buildReport({ nativeLive = false } = {}) {
  if (nativeLive) {
    const scenarios = [
      { name: 'native-live', outcome: 'blocked', code: null }
    ];
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: 'native-live',
      nativeVerified: false,
      blocked: true,
      reason: 'fail-closed: native-live requires independently attested packages and a real Windows environment; this CLI never self-certifies it',
      packages: ACTUAL_PACKAGES,
      scenarios,
      failures: scenarios.length,
      failureNames: scenarios.map(s => s.name),
      exitCode: EXIT.NATIVE_LIVE_BLOCKED
    };
  }

  const integration = await runOfflineIntegration();
  const suite = await runNegativeSuite();

  const scenarios = [
    {
      name: 'offline-integration-happy-path',
      outcome: 'pass',
      verificationStatus: integration.verificationStatus,
      checksPassed: integration.checksPassed,
      checksFailed: integration.checksFailed,
      finalSessionState: integration.finalSessionState,
      postRevokeObserveCode: integration.postRevokeObserveCode,
      stopAfterRevokeCode: integration.stopAfterRevoke?.code ?? null,
      observerCaptures: integration.observerCaptures
    },
    ...suite.negatives.map(n => ({
      name: n.name,
      outcome: n.neverVerified === true ? 'never_verified' : (n.rejected === true ? 'rejected' : 'unknown'),
      code: n.code ?? n.status ?? null,
      ...(n.observerCaptures !== undefined ? { observerCaptures: n.observerCaptures } : {}),
      ...(n.observerCaptureAttempts !== undefined ? { observerCaptureAttempts: n.observerCaptureAttempts } : {}),
      ...(n.boundedElapsedMs !== undefined ? { boundedElapsedMs: n.boundedElapsedMs } : {})
    }))
  ];

  const { failures, failureNames } = summarizeScenarios(scenarios);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    mode: INTEGRATION_LABEL,
    nativeVerified: false,
    blocked: false,
    packages: ACTUAL_PACKAGES,
    scenarios,
    failures,
    failureNames,
    exitCode: failures > 0 ? EXIT.SCENARIO_FAILURE : EXIT.PASS
  };
}

/** Bounded serialization: compact report only; refuses to emit oversized output.
 * Bound is enforced on UTF-8 byte length, not string length (multibyte-safe). */
export function serializeReport(report) {
  const json = JSON.stringify(report, null, 2);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > REPORT_MAX_BYTES) {
    throw new Error(`report exceeds bounded size: ${bytes} bytes > ${REPORT_MAX_BYTES} bytes`);
  }
  return json;
}

export async function main(argv = []) {
  const nativeLive = argv.includes('--native-live');
  const report = await buildReport({ nativeLive });
  process.stdout.write(`${serializeReport(report)}\n`);
  process.exitCode = report.exitCode;
  return report;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main(process.argv.slice(2)).catch(err => {
    process.stderr.write(`${JSON.stringify({ schemaVersion: REPORT_SCHEMA_VERSION, error: String(err && err.message ? err.message : err) })}\n`);
    process.exitCode = EXIT.SCENARIO_FAILURE;
  });
}
