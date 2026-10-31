#!/usr/bin/env node

/**
 * ZETRO Deterministic Test Runner & Coverage Harness
 *
 * Runs bounded deterministic test suites across all maintained packages in the
 * ZETRO product repository. Enforces finite subprocess timeouts and parses
 * test counts (pass, fail, skip, todo).
 *
 * Owned by AGR-5.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.resolve(__dirname, '..');

const MIN_NODE_VERSION = '22.5.0';

/**
 * Parses semver string into major, minor, patch numbers.
 * Returns null if invalid or partial.
 */
function parseSemver(versionStr) {
    if (!versionStr || typeof versionStr !== 'string') return null;
    const clean = versionStr.replace(/^[v^>=~]/, '').trim();
    const parts = clean.split('.').map(n => parseInt(n, 10));
    if (parts.length < 3 || parts.some(n => Number.isNaN(n) || n < 0)) return null;
    return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Checks if currentVersion satisfies >= minVersion.
 */
function isNodeVersionSupported(currentVersion, minVersion = MIN_NODE_VERSION) {
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
 * Fails closed if the module is missing or disabled via --no-experimental-sqlite.
 */
function isDatabaseSyncAvailable(probe) {
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
 * Validates the active Node.js runtime against required minimum version
 * and verifies actual node:sqlite DatabaseSync capability.
 * Fails closed before any suites execute if node:sqlite DatabaseSync is unsupported
 * or disabled by runtime flag.
 */
function checkRuntimePreflight(options = {}) {
    const version = options.injectedVersion || process.versions.node;
    const min = options.minVersion || MIN_NODE_VERSION;
    const sqliteProbe = options.injectedSqliteAvailable !== undefined ? options.injectedSqliteAvailable : options.sqliteAvailable;

    const supported = isNodeVersionSupported(version, min);
    const sqliteAvailable = isDatabaseSyncAvailable(sqliteProbe);

    if (!supported) {
        return {
            ok: false,
            currentVersion: version,
            minVersion: min,
            sqliteAvailable: false,
            reason: 'unsupported_version',
            message: `Unsupported Node.js runtime 'v${version}'. Node.js >= ${min} is strictly required for built-in node:sqlite DatabaseSync transactional store.`
        };
    }

    if (!sqliteAvailable) {
        return {
            ok: false,
            currentVersion: version,
            minVersion: min,
            sqliteAvailable: false,
            reason: 'sqlite_unavailable',
            message: `Node.js runtime 'v${version}' satisfies >= ${min}, but node:sqlite DatabaseSync is unavailable (possibly disabled via --no-experimental-sqlite flag or requires --experimental-sqlite on Node 22.5.0–22.11.0).`
        };
    }

    return {
        ok: true,
        currentVersion: version,
        minVersion: min,
        sqliteAvailable: true,
        message: `Node.js runtime 'v${version}' satisfies minimum >= ${min} with verified node:sqlite DatabaseSync capability`
    };
}

const SUITES = [
    {
        id: 'antigravity-adapter',
        packageName: '@veyminore/zetro-antigravity',
        directory: 'packages/antigravity-adapter',
        commands: [
            { cmd: process.execPath, args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], label: 'build' },
            { cmd: process.execPath, args: ['--test', 'dist/**/*.test.js'], label: 'test' }
        ],
        timeoutMs: 30000
    },
    {
        id: 'agent-tools',
        packageName: '@veyminore/agent-tools',
        directory: 'apps/agent-tools',
        commands: [
            { cmd: process.execPath, args: ['test/test.js'], label: 'unit' },
            { cmd: process.execPath, args: ['test/smoke.test.js'], label: 'smoke-offline' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'context-budget',
        packageName: '@zetro/context-budget',
        directory: 'packages/context-budget',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'orchestration-core',
        packageName: '@zetro/orchestration-core',
        directory: 'packages/orchestration-core',
        commands: [
            { cmd: process.execPath, args: ['--test', 'packages/orchestration-core/test/*.test.js'], cwd: '.', label: 'test' }
        ],
        timeoutMs: 25000
    },
    {
        id: 'policy',
        packageName: '@zetro/policy',
        directory: 'packages/policy',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'protocol',
        packageName: '@zetro/protocol',
        directory: 'packages/protocol',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'rct-runtime',
        packageName: '@zetro/rct-runtime',
        directory: 'packages/rct-runtime',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 45000
    },
    {
        id: 'workspace-runner',
        packageName: '@zetro/workspace-runner',
        directory: 'packages/workspace-runner',
        commands: [
            { cmd: process.execPath, args: ['test/verifier.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'bridge-events',
        packageName: '@zetro/antigravity-bridge-events',
        directory: 'packages/antigravity-bridge/events',
        commands: [
            { cmd: process.execPath, args: ['test/journal.test.js'], label: 'journal' },
            { cmd: process.execPath, args: ['test/integration.test.js'], label: 'integration' },
            { cmd: process.execPath, args: ['test/coordinator.test.js'], label: 'coordinator' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'bridge-mcp',
        packageName: '@zetro/antigravity-bridge-mcp',
        directory: 'packages/antigravity-bridge/mcp',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 25000
    },
    {
        id: 'bridge-sidecar',
        packageName: '@veyminore/antigravity-bridge-sidecar',
        directory: 'packages/antigravity-bridge/sidecar',
        commands: [
            { cmd: process.execPath, args: ['test/test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'bridge-hook',
        packageName: 'antigravity-bridge-hook',
        directory: 'packages/antigravity-bridge/hook',
        commands: [
            { cmd: process.execPath, args: ['stop.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'model-providers',
        packageName: '@zetro/model-providers',
        directory: 'packages/model-providers',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 25000
    },
    {
        id: 'provider-config',
        packageName: '@zetro/provider-config',
        directory: 'packages/provider-config',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 20000
    },
    {
        id: 'offline-isolation',
        packageName: 'zetro-offline-sentinel',
        directory: '.',
        commands: [
            { cmd: process.execPath, args: ['scripts/zetro-offline-sentinel.js'], label: 'offline-sentinel' }
        ],
        timeoutMs: 25000
    },
    {
        id: 'offline-smoke',
        packageName: 'zetro-offline-smoke',
        directory: '.',
        commands: [
            { cmd: process.execPath, args: ['scripts/zetro-offline-smoke.js'], label: 'offline-smoke' }
        ],
        timeoutMs: 30000
    },
    {
        id: 'control-center',
        packageName: '@zetro/control-center',
        directory: 'apps/control-center',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.mjs'], label: 'test' }
        ],
        timeoutMs: 25000
    },
    {
        id: 'computer-agent',
        packageName: '@zetro/computer-agent',
        directory: 'packages/computer-agent',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 120000
    },
    {
        id: 'computer-windows-provider',
        packageName: '@zetro/computer-windows-provider',
        directory: 'packages/computer-windows-provider',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 30000
    },
    {
        id: 'model-gateway',
        packageName: '@zetro/model-gateway',
        directory: 'packages/model-gateway',
        commands: [
            { cmd: process.execPath, args: ['--test', 'test/*.test.js'], label: 'test' }
        ],
        timeoutMs: 25000
    }
];

function parseCounts(output) {
    const counts = { pass: 0, fail: 0, skipped: 0, todo: 0 };
    
    // Look for node:test output patterns like:
    // ℹ pass 12
    // ℹ fail 0
    // ℹ skipped 1
    // ℹ todo 0
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const skipMatch = output.match(/ℹ skipped (\d+)/);
    const todoMatch = output.match(/ℹ todo (\d+)/);

    if (passMatch) counts.pass += parseInt(passMatch[1], 10);
    if (failMatch) counts.fail += parseInt(failMatch[1], 10);
    if (skipMatch) counts.skipped += parseInt(skipMatch[1], 10);
    if (todoMatch) counts.todo += parseInt(todoMatch[1], 10);

    // If node:test summary line was not found, check custom checkmarks or assertions
    if (!passMatch && !failMatch) {
        const checkmarks = (output.match(/[✓✔]/g) || []).length;
        if (checkmarks > 0) {
            counts.pass = checkmarks;
        } else if (output.includes('passed') || output.includes('All tests passed')) {
            counts.pass = 1;
        }
    }

    return counts;
}

function runSingleCommand(cmdObj, cwd, timeoutMs) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const env = {
            ...process.env,
            NODE_ENV: 'test'
        };

        // Deterministic harness UNCONDITIONALLY disables live smoke regardless of parent environment:
        delete env.ZETRO_LIVE_SMOKE;
        // Inject loopback sentinels to guarantee no live process scanning or live socket connections
        env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:59999';
        env.ANTIGRAVITY_CSRF_TOKEN = 'deterministic-offline-sentinel';
        env.ZETRO_ANTIGRAVITY_EXECUTABLE = 'non-existent-language-server.exe';

        const proc = spawn(cmdObj.cmd, cmdObj.args, {
            cwd: path.resolve(ROOT_DIR, cmdObj.cwd !== undefined ? cmdObj.cwd : cwd),
            env,
            shell: false
        });

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGKILL');
        }, timeoutMs);

        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

        proc.on('close', (code, signal) => {
            clearTimeout(timer);
            const durationMs = Date.now() - startTime;
            resolve({
                code: timedOut ? -1 : (code !== null ? code : 1),
                signal,
                timedOut,
                durationMs,
                stdout,
                stderr
            });
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            const durationMs = Date.now() - startTime;
            resolve({
                code: 1,
                error: err.message,
                timedOut: false,
                durationMs,
                stdout,
                stderr: stderr + '\n' + err.message
            });
        });
    });
}

async function runSuite(suite) {
    const suiteStartTime = Date.now();
    let suitePass = true;
    let combinedStdout = '';
    let combinedStderr = '';
    const counts = { pass: 0, fail: 0, skipped: 0, todo: 0 };
    let firstFailedCommand = null;

    for (const cmdObj of suite.commands) {
        const res = await runSingleCommand(cmdObj, suite.directory, suite.timeoutMs);
        combinedStdout += res.stdout + '\n';
        combinedStderr += res.stderr + '\n';

        const stepCounts = parseCounts(res.stdout + '\n' + res.stderr);
        counts.pass += stepCounts.pass;
        counts.fail += stepCounts.fail;
        counts.skipped += stepCounts.skipped;
        counts.todo += stepCounts.todo;

        if (res.code !== 0 || res.timedOut) {
            suitePass = false;
            firstFailedCommand = {
                label: cmdObj.label,
                code: res.code,
                timedOut: res.timedOut,
                stderr: res.stderr
            };
            if (stepCounts.fail === 0 && !res.timedOut) {
                counts.fail += 1;
            }
            break;
        }
    }

    const durationMs = Date.now() - suiteStartTime;

    return {
        id: suite.id,
        packageName: suite.packageName,
        directory: suite.directory,
        passed: suitePass,
        counts,
        durationMs,
        firstFailedCommand,
        stdout: combinedStdout,
        stderr: combinedStderr
    };
}

/**
 * Scans workspace package manifests dynamically to guarantee that every
 * maintained workspace package is registered in SUITES.
 * Prevents silent omissions of packages (e.g. packages/policy).
 */
// Milestone packages currently being drafted in parallel branches/milestones not yet admitted to release qualification
const IN_FLIGHT_PACKAGES = new Set([
    '@zetro/computer-conformance',
    '@zetro/computer-contract',
    '@zetro/computer-observer',
    '@zetro/computer-runtime',
    '@zetro/opencode-adapter'
]);

function discoverWorkspacePackages(rootDir = ROOT_DIR) {
    const patterns = ['apps', 'packages', 'packages/antigravity-bridge'];
    const discovered = [];

    for (const relPattern of patterns) {
        const fullDir = path.resolve(rootDir, relPattern);
        if (!fs.existsSync(fullDir)) continue;

        const entries = fs.readdirSync(fullDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Ignore nested bridge sub-workspace parent if traversed in separate pattern
            if (relPattern === 'packages' && entry.name === 'antigravity-bridge') continue;

            const pkgDir = path.join(fullDir, entry.name);
            const pkgJsonPath = path.join(pkgDir, 'package.json');
            if (fs.existsSync(pkgJsonPath)) {
                try {
                    const manifest = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                    if (IN_FLIGHT_PACKAGES.has(manifest.name)) {
                        continue;
                    }
                    const relativeDir = path.relative(rootDir, pkgDir).split(path.sep).join('/');
                    discovered.push({
                        name: manifest.name,
                        directory: relativeDir,
                        hasTestScript: Boolean(manifest.scripts && manifest.scripts.test)
                    });
                } catch {
                    // Ignore malformed files or let validator report
                }
            }
        }
    }
    return discovered;
}

function validateWorkspacePackageInventory(rootDir = ROOT_DIR, suites = SUITES) {
    const discovered = discoverWorkspacePackages(rootDir);
    const missing = [];

    for (const pkg of discovered) {
        const match = suites.find(s => {
            const suiteDir = s.directory.split(path.sep).join('/');
            return suiteDir === pkg.directory || s.packageName === pkg.name;
        });

        if (!match) {
            missing.push(pkg);
        }
    }

    if (missing.length > 0) {
        return {
            ok: false,
            discoveredCount: discovered.length,
            missing,
            message: `Workspace package inventory mismatch: ${missing.length} package(s) missing from test SUITES: ${missing.map(m => `${m.name} (${m.directory})`).join(', ')}`
        };
    }

    return {
        ok: true,
        discoveredCount: discovered.length,
        missing: [],
        message: `All ${discovered.length} workspace packages verified registered in test SUITES`
    };
}

async function main() {
    const preflight = checkRuntimePreflight();
    if (!preflight.ok) {
        console.error(`\n========================================================================`);
        console.error(` RUNTIME PREFLIGHT FAILURE`);
        console.error(`========================================================================`);
        console.error(`  ${preflight.message}`);
        console.error(`  Transactional state in @zetro/orchestration-core relies on built-in`);
        console.error(`  node:sqlite DatabaseSync, introduced in Node.js v${MIN_NODE_VERSION}.`);
        console.error(`  Aborting deterministic check execution before running any suites.`);
        console.error(`========================================================================\n`);
        process.exit(1);
    }

    const inventoryCheck = validateWorkspacePackageInventory(ROOT_DIR, SUITES);
    if (!inventoryCheck.ok) {
        console.error(`\n========================================================================`);
        console.error(` INVENTORY VALIDATION FAILURE`);
        console.error(`========================================================================`);
        console.error(`  ${inventoryCheck.message}`);
        console.error(`  Every workspace package with package.json must be registered in SUITES`);
        console.error(`  to guarantee complete offline test coverage.`);
        console.error(`========================================================================\n`);
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const jsonOutput = args.includes('--json');
    const suiteFilterArg = args.find(a => a.startsWith('--suite='));
    const suiteFilter = suiteFilterArg ? suiteFilterArg.split('=')[1] : null;

    const targetSuites = suiteFilter
        ? SUITES.filter(s => s.id === suiteFilter || s.packageName === suiteFilter)
        : SUITES;

    if (targetSuites.length === 0) {
        console.error(`Error: No suite matches filter '${suiteFilter}'`);
        process.exit(1);
    }

    console.log(`========================================================================`);
    console.log(` ZETRO Deterministic Suite Runner (Total suites: ${targetSuites.length})`);
    console.log(` Runtime: Node.js v${process.versions.node} (>= ${MIN_NODE_VERSION} preflight OK)`);
    console.log(`========================================================================\n`);

    const results = [];
    let allPassed = true;
    const totalCounts = { pass: 0, fail: 0, skipped: 0, todo: 0 };
    const overallStartTime = Date.now();

    for (const suite of targetSuites) {
        process.stdout.write(`• Running [${suite.id}] ${suite.packageName}... `);
        const result = await runSuite(suite);
        results.push(result);

        totalCounts.pass += result.counts.pass;
        totalCounts.fail += result.counts.fail;
        totalCounts.skipped += result.counts.skipped;
        totalCounts.todo += result.counts.todo;

        if (result.passed) {
            console.log(`PASS (${result.durationMs}ms) [pass: ${result.counts.pass}, skip: ${result.counts.skipped}, todo: ${result.counts.todo}]`);
        } else {
            allPassed = false;
            const reason = result.firstFailedCommand?.timedOut ? 'TIMEOUT' : `exit code ${result.firstFailedCommand?.code}`;
            console.log(`FAIL (${result.durationMs}ms) - ${reason}`);
            if (result.firstFailedCommand?.stderr) {
                const lines = result.firstFailedCommand.stderr.trim().split('\n').slice(-10);
                console.log(`  Error excerpt:\n    ${lines.join('\n    ')}`);
            }
        }
    }

    const totalDurationMs = Date.now() - overallStartTime;

    console.log(`\n========================================================================`);
    console.log(` SUMMARY OF DETERMINISTIC SUITES`);
    console.log(`========================================================================`);
    console.log(`Total Suites:     ${results.length}`);
    console.log(`Suites Passed:    ${results.filter(r => r.passed).length}`);
    console.log(`Suites Failed:    ${results.filter(r => !r.passed).length}`);
    console.log(`Total Tests Pass: ${totalCounts.pass}`);
    console.log(`Total Tests Fail: ${totalCounts.fail}`);
    console.log(`Total Skipped:    ${totalCounts.skipped}`);
    console.log(`Total Todo:       ${totalCounts.todo}`);
    console.log(`Total Duration:   ${totalDurationMs}ms`);
    console.log(`========================================================================\n`);

    if (jsonOutput) {
        fs.writeFileSync(path.join(ROOT_DIR, 'zetro-check-results.json'), JSON.stringify({
            timestamp: new Date().toISOString(),
            allPassed,
            totalCounts,
            totalDurationMs,
            suites: results.map(r => ({
                id: r.id,
                packageName: r.packageName,
                directory: r.directory,
                passed: r.passed,
                durationMs: r.durationMs,
                counts: r.counts,
                failure: r.firstFailedCommand
            }))
        }, null, 2), 'utf8');
    }

    process.exit(allPassed ? 0 : 1);
}

module.exports = {
    checkRuntimePreflight,
    isNodeVersionSupported,
    isDatabaseSyncAvailable,
    discoverWorkspacePackages,
    validateWorkspacePackageInventory,
    parseSemver,
    MIN_NODE_VERSION,
    SUITES,
    parseCounts,
    runSuite,
    main
};

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error in zetro-check:', err);
        process.exit(1);
    });
}
