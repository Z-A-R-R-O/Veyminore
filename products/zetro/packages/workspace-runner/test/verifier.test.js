const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Verifier } = require('../src/verifier');

test('Verifier constructor requires non-empty allowedPaths', () => {
    assert.throws(
        () => new Verifier('./', []),
        { message: 'Explicit non-empty allowedPaths is required' }
    );
    assert.throws(
        () => new Verifier('./', null),
        { message: 'Explicit non-empty allowedPaths is required' }
    );
});

test('Verifier permits allowed paths and denies disallowed paths', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-paths-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'allowed'));
        fs.mkdirSync(path.join(tmpDir, 'disallowed'));
        fs.writeFileSync(path.join(tmpDir, 'allowed', 'test.txt'), 'hello world');
        fs.writeFileSync(path.join(tmpDir, 'disallowed', 'secret.txt'), 'secret');

        const verifier = new Verifier(tmpDir, ['allowed']);
        await verifier.init();

        assert.strictEqual(await verifier.isPathAllowed('allowed/test.txt'), true);
        assert.strictEqual(await verifier.isPathAllowed('disallowed/secret.txt'), false);
        assert.strictEqual(await verifier.isPathAllowed('../outside.txt'), false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier rejects directory junction boundary escape without privilege escalation', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-junction-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'allowed'));
        fs.mkdirSync(path.join(tmpDir, 'disallowed', 'secret_dir'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'disallowed', 'secret_dir', 'secret.txt'), 'classified');

        const junctionPath = path.join(tmpDir, 'allowed', 'junction_dir');
        const targetDir = path.join(tmpDir, 'disallowed', 'secret_dir');

        // Junction creation on Windows NTFS does not require SeCreateSymbolicLinkPrivilege
        fs.symlinkSync(targetDir, junctionPath, 'junction');

        const verifier = new Verifier(tmpDir, ['allowed']);
        await verifier.init();

        const isAllowed = await verifier.isPathAllowed('allowed/junction_dir/secret.txt');
        assert.strictEqual(isAllowed, false, 'Junction escaping allowed folder must be denied');

        const receipt = await verifier.generateReceipt(['allowed/junction_dir/secret.txt']);
        assert.strictEqual(
            receipt.files['allowed/junction_dir/secret.txt'].error,
            'Path not allowed or escape attempted'
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier rejects file symlink escape or explicitly accounts for Windows EPERM', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-symlink-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'allowed'));
        fs.mkdirSync(path.join(tmpDir, 'disallowed'));
        fs.writeFileSync(path.join(tmpDir, 'allowed', 'test.txt'), 'hello');
        fs.writeFileSync(path.join(tmpDir, 'disallowed', 'secret.txt'), 'secret');

        const symlinkDest = path.join(tmpDir, 'allowed', 'symlink.txt');
        const symlinkTarget = path.join(tmpDir, 'disallowed', 'secret.txt');

        let symlinkCreated = false;
        try {
            fs.symlinkSync(symlinkTarget, symlinkDest, 'file');
            symlinkCreated = true;
        } catch (symlinkErr) {
            if (symlinkErr.code === 'EPERM' || symlinkErr.code === 'ENOSYS') {
                t.skip(
                    `Windows unprivileged environment: file symlink creation threw ${symlinkErr.code}. ` +
                    'File-symlink escape test SKIPPED. This skipped test is NOT a passed security check and must be verified on a capable Windows runner.'
                );
                return;
            }
            throw symlinkErr;
        }

        if (symlinkCreated) {
            const verifier = new Verifier(tmpDir, ['allowed']);
            await verifier.init();

            assert.strictEqual(
                await verifier.isPathAllowed('allowed/symlink.txt'),
                false,
                'File symlink escaping allowed boundary must be denied'
            );

            const receipt = await verifier.generateReceipt(['allowed/symlink.txt']);
            assert.strictEqual(
                receipt.files['allowed/symlink.txt'].error,
                'Path not allowed or escape attempted'
            );
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier runCheck enforces allowlist and execution bounds', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-check-'));
    try {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'test-pkg',
            scripts: { test: 'echo test_pass' }
        }));

        const verifier = new Verifier(tmpDir, ['package.json']);
        
        // Disallowed command
        const resArbitrary = await verifier.runCheck('malicious-or-unknown-command');
        assert.strictEqual(resArbitrary.success, false);
        assert.strictEqual(resArbitrary.error, 'Command not in allowlist');
        assert.strictEqual(resArbitrary.code, -1);

        // Allowlisted command
        const resNpm = await verifier.runCheck('npm-test', { timeout: 10000 });
        assert.strictEqual(resNpm.success, true);
        assert.ok(resNpm.stdout.includes('test_pass') || resNpm.stdout.trim() !== '');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier generateReceipt calculates SHA256 and captures file size', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-receipt-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'allowed'));
        const content = 'deterministic receipt content';
        fs.writeFileSync(path.join(tmpDir, 'allowed', 'doc.txt'), content, 'utf8');

        const verifier = new Verifier(tmpDir, ['allowed']);
        const receipt = await verifier.generateReceipt(['allowed/doc.txt', 'disallowed/missing.txt']);

        assert.ok(receipt.timestamp);
        assert.ok(receipt.files['allowed/doc.txt'].hash);
        assert.strictEqual(receipt.files['allowed/doc.txt'].size, Buffer.byteLength(content));
        assert.strictEqual(receipt.files['disallowed/missing.txt'].error, 'Path not allowed or escape attempted');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier getGitMetadata reports valid git metadata or safe fallback', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-non-git-'));
    try {
        const verifierNonGit = new Verifier(tmpDir, ['dummy']);
        const nonGitMeta = await verifierNonGit.getGitMetadata();
        assert.strictEqual(nonGitMeta.isGit, false);

        // Run against this repository workspace
        const verifierRepo = new Verifier(path.resolve(__dirname, '../../..'), ['packages/workspace-runner']);
        const repoMeta = await verifierRepo.getGitMetadata();
        assert.strictEqual(repoMeta.isGit, true);
        assert.ok(repoMeta.headHash);
        assert.ok(Array.isArray(repoMeta.changedFiles));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Verifier runs non-colocated npm CLI through Node without live network and prevents spawn EINVAL', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-noncolocated-'));
    try {
        // Create an isolated mock npm-cli.js in a custom non-colocated directory
        const mockNpmDir = path.join(tmpDir, 'custom-npm-tree', 'bin');
        fs.mkdirSync(mockNpmDir, { recursive: true });
        const mockNpmCli = path.join(mockNpmDir, 'npm-cli.js');
        fs.writeFileSync(mockNpmCli, `
            const args = process.argv.slice(2);
            if (args[0] === 'test') {
                console.log('non-colocated offline npm test success');
                process.exit(0);
            }
            process.exit(1);
        `, 'utf8');

        // Create workspace with a dummy package.json
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'test-noncolocated-pkg',
            scripts: { test: 'node -e "process.exit(0)"' }
        }));

        // Pass npmCliPath explicitly to Verifier options
        const verifier = new Verifier(tmpDir, ['package.json'], { npmCliPath: mockNpmCli });
        const res = await verifier.runCheck('npm-test');

        assert.strictEqual(res.success, true);
        assert.ok(res.stdout.includes('non-colocated offline npm test success'));
        assert.strictEqual(res.code, 0);

        // Test unresolvable scenario fails closed without spawn EINVAL
        const fakeCliPath = path.join(tmpDir, 'nonexistent-npm', 'npm-cli.js');
        const resUnresolved = await verifier.runCheck('npm-test', { npmCliPath: fakeCliPath });
        // Must either succeed via system default or fail safely closed without spawn EINVAL
        assert.notStrictEqual(resUnresolved.error, 'spawn EINVAL');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
