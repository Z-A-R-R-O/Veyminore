import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../src/cli.js');

function runCli(args, env = process.env) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        killSignal: 'SIGKILL',
        env,
    });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    return { exitCode: result.status, output: JSON.parse(result.stdout) };
}

let tmpDir;
try {
    console.log('Running integration tests...');

    if (process.env.ZETRO_LIVE_SMOKE === '1') {
        console.log('Running live Antigravity status-compact check...');
        const { exitCode: statusExitCode, output: sCompact } = runCli(['status-compact']);
        assert.strictEqual(sCompact.status, 'success');
        assert.strictEqual(statusExitCode, sCompact.data.some(d => d.connected === false) ? 1 : 0);
        if (sCompact.data.length > 0) {
            assert.strictEqual(sCompact.data[0].workspace, undefined);
        }
    } else {
        console.log('Skipping live Antigravity status check (opt-in via ZETRO_LIVE_SMOKE=1).');
    }

    // Dry-run send-packed integration (deterministic, no live send)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-tools-test-'));
    const taskJson = path.join(tmpDir, 'task.json');
    fs.writeFileSync(taskJson, JSON.stringify({
        objective: 'smoke packed',
        acceptanceCriteria: 'pass',
        permissions: 'none',
        blockers: 'none',
        context: { big: 'A'.repeat(5000) }
    }));
    const storeDir = path.join(tmpDir, 'store');

    const { exitCode: packExitCode, output: sPackRes } = runCli([
        'send-packed', 'AGR-1', '--input', taskJson, '--store', storeDir, '--budget', '2000', '--dry-run'
    ]);
    assert.strictEqual(packExitCode, 0);
    assert.strictEqual(sPackRes.status, 'not_attempted');
    assert.ok(sPackRes.metrics.savedChars > 300);

    console.log('Integration tests passed.');
} catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
} finally {
    if (tmpDir && fs.existsSync(tmpDir)) {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
    }
}
