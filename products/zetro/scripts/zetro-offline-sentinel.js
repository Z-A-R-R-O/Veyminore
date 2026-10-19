const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

test('Deterministic harness unconditionally disables live smoke across parent values 1, 0, false, unset', () => {
    const parentValues = [
        { label: 'unset', env: {} },
        { label: '0', env: { ZETRO_LIVE_SMOKE: '0' } },
        { label: 'false', env: { ZETRO_LIVE_SMOKE: 'false' } },
        { label: '1', env: { ZETRO_LIVE_SMOKE: '1' } }, // critical P1 regression case: inherited '1' must be stripped
    ];

    for (const { label, env: extraEnv } of parentValues) {
        const baseEnv = { ...process.env };
        delete baseEnv.ZETRO_LIVE_SMOKE;
        const parentEnv = { ...baseEnv, ...extraEnv };

        // Run the deterministic suite runner for adapter under this parent environment
        const checkRes = spawnSync(process.execPath, [
            path.resolve(ROOT_DIR, 'scripts/zetro-check.js'),
            '--suite=antigravity-adapter'
        ], {
            cwd: ROOT_DIR,
            env: parentEnv,
            encoding: 'utf8',
            timeout: 25000
        });

        assert.strictEqual(
            checkRes.status,
            0,
            `zetro-check failed when parent ZETRO_LIVE_SMOKE was ${label}: ${checkRes.stderr}\n${checkRes.stdout}`
        );

        // Verify the harness output shows 1 skipped test (the opt-in live smoke) and 0 fails
        assert.ok(
            checkRes.stdout.includes('skip: 1'),
            `zetro-check must report 1 skipped live smoke test when parent ZETRO_LIVE_SMOKE was ${label}. Output: ${checkRes.stdout}`
        );
        assert.ok(
            !checkRes.stdout.includes('FAIL'),
            `zetro-check must not fail any test when parent ZETRO_LIVE_SMOKE was ${label}`
        );
    }
});

test('Offline isolation sentinel: loopback sentinels block live process discovery and fail if live process is queried', () => {
    // When sentinel environment is injected, discovery must immediately fail closed without scanning Win32 processes
    const env = {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:59999',
        ANTIGRAVITY_CSRF_TOKEN: 'deterministic-sentinel-token',
        ZETRO_ANTIGRAVITY_EXECUTABLE: 'non-existent-language-server.exe',
    };
    delete env.ZETRO_LIVE_SMOKE;

    const start = Date.now();
    const result = spawnSync(process.execPath, [
        path.resolve(ROOT_DIR, 'packages/antigravity-adapter/dist/cli.js'),
        'status',
        '--json'
    ], {
        cwd: ROOT_DIR,
        env,
        encoding: 'utf8',
        timeout: 5000
    });
    const duration = Date.now() - start;

    // Must return exit code 2 (offline) deterministically and fast without scanning Win32 processes
    assert.strictEqual(result.status, 2);
    assert.ok(duration < 3000, `Sentinel-guarded status must complete quickly (<3000ms); took ${duration}ms`);
    const data = JSON.parse(result.stdout);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 5);
    // Sentinel check: if live discovery ran and hit real Antigravity, connected would be true.
    // Sentinel verification GUARANTEES connected === false for all agents.
    for (const agent of data) {
        assert.strictEqual(agent.connected, false, `Agent ${agent.agent} must be offline under sentinel trap`);
        assert.strictEqual(agent.confidence, 'diagnostic_fallback');
    }
});
