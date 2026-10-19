#!/usr/bin/env node

/**
 * ZETRO Opt-In Live Smoke Runner
 *
 * Dedicated, isolated script for running live smoke tests against real
 * Antigravity processes. Strictly separated from deterministic offline checks.
 *
 * Owned by AGR-5.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('Running ZETRO opt-in live smoke checks (requires live Antigravity)...');

const env = {
    ...process.env,
    ZETRO_LIVE_SMOKE: '1'
};

// 1. Agent Tools live smoke check
console.log('• Checking apps/agent-tools live smoke...');
const resTools = spawnSync(process.execPath, ['test/smoke.test.js'], {
    cwd: path.resolve(ROOT_DIR, 'apps/agent-tools'),
    env,
    encoding: 'utf8',
    timeout: 15000
});
console.log(resTools.stdout || resTools.stderr);

// 2. Adapter live smoke check
console.log('• Checking packages/antigravity-adapter live smoke...');
const resAdapter = spawnSync(process.execPath, ['--test', 'dist/**/*.test.js'], {
    cwd: path.resolve(ROOT_DIR, 'packages/antigravity-adapter'),
    env,
    encoding: 'utf8',
    timeout: 20000
});
console.log(resAdapter.stdout || resAdapter.stderr);

const success = resTools.status === 0 && resAdapter.status === 0;
console.log(`Live smoke completed with status: ${success ? 'SUCCESS' : 'FAILED'}`);
process.exit(success ? 0 : 1);
