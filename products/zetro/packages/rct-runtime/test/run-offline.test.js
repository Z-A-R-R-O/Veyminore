import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/workspace.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let tmpDir;
let fixtureDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rct-offline-test-'));
  fixtureDir = path.join(tmpDir, 'fixtures');
  await mkdir(fixtureDir, { recursive: true });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function runCli(manifestPath) {
    try {
        const { stdout, stderr } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
        return { code: 0, stdout, stderr };
    } catch (e) {
        return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
}

async function runCliArgs(...args) {
    try {
        const { stdout, stderr } = await exec(process.execPath, [cliPath, ...args]);
        return { code: 0, stdout, stderr };
    } catch (e) {
        return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
}

test('run-offline offline success and source unchanged', async () => {
    const root = path.join(tmpDir, 'source-success');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest1.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 0);
    assert.equal(result.state, 'review_ready');
    assert.equal(result.sourceUnchanged, true);

    // Verify canonical reviewPatch, workspaceAdmission, and executionIdentity
    assert.ok(result.reviewPatch, 'reviewPatch must be present in stdout metadata');
    assert.equal(result.reviewPatch.schemaVersion, 'rct.review_patch.v1');
    assert.equal(result.reviewPatch.task.id, 'test-run-offline');
    assert.equal(result.reviewPatch.verification.verified, true);
    assert.equal(result.reviewPatch.changes.length, 1);
    assert.equal(result.reviewPatch.changes[0].path, 'src/greeting.txt');

    assert.ok(result.workspaceAdmission, 'workspaceAdmission must be present in stdout metadata');
    assert.equal(result.workspaceAdmission.schemaVersion, 'zetro.protocol.workspace_admission.v1');
    assert.equal(result.workspaceAdmission.taskId, 'test-run-offline');

    assert.ok(result.executionIdentity, 'executionIdentity must be present in stdout metadata');
    assert.equal(result.executionIdentity.taskId, 'test-run-offline');
    assert.equal(result.executionIdentity.attemptId, 1);

    // Verify persisted artifact file
    assert.ok(result.artifactPath, 'artifactPath must be emitted');
    const saved = JSON.parse(await readFile(result.artifactPath, 'utf8'));
    assert.ok(saved.reviewPatch, 'reviewPatch must be persisted in artifact');
    assert.ok(saved.workspaceAdmission, 'workspaceAdmission must be persisted in artifact');
    assert.ok(saved.executionIdentity, 'executionIdentity must be persisted in artifact');
    assert.equal(saved.reviewPatch.manifestHash, result.reviewPatch.manifestHash);

    // Verify source truly unchanged
    const sourceContent = await readFile(path.join(root, 'src', 'greeting.txt'), 'utf8');
    assert.equal(sourceContent, 'hello\n');
});

test('run-offline reject missing files before snapshot', async () => {
    const root = path.join(tmpDir, 'source-missing');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline-missing',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    };

    const manifestPath = path.join(fixtureDir, 'manifest2.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    await rm(path.join(root, 'src', 'greeting.txt'));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.status, 'error');
    assert.ok(result.reason.includes('vanished') || result.reason.includes('Scope path'));
});

test('run-offline reject unsupported createPaths', async () => {
    const root = path.join(tmpDir, 'source-create');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-run-offline-create',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: ['src/newfile.txt']
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    };

    const manifestPath = path.join(fixtureDir, 'manifest4.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.status, 'error');
    assert.ok(result.reason.includes('createPaths are not safely executable'));
});

test('run-offline false worker completion yields failed state', async () => {
    const root = path.join(tmpDir, 'source-false-completion');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-false-completion',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        _fakeSteps: [
            { name: 'submit_receipt', args: { summary: 'I did not actually patch anything' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest5.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code, stdout } = await runCli(manifestPath);
    const result = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(result.state, 'failed');
    assert.equal(result.sourceUnchanged, true);
});

test('review subcommand inspects valid artifact successfully', async () => {
    const root = path.join(tmpDir, 'source-review-valid');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-review-valid',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest-review-valid.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code: runCode, stdout: runStdout } = await runCli(manifestPath);
    assert.equal(runCode, 0);
    const runResult = JSON.parse(runStdout);

    // Review the emitted artifact
    const { code: revCode, stdout: revStdout } = await runCliArgs('review', runResult.artifactPath);
    assert.equal(revCode, 0);
    const reviewResult = JSON.parse(revStdout);

    assert.equal(reviewResult.status, 'valid');
    assert.equal(reviewResult.taskId, 'test-review-valid');
    assert.equal(reviewResult.verified, true);
    assert.equal(reviewResult.manifestHash, runResult.reviewPatch.manifestHash);
    assert.equal(reviewResult.diffOutcome, 'applied');
    assert.equal(reviewResult.changes.length, 1);
    assert.equal(reviewResult.changes[0].path, 'src/greeting.txt');
    assert.equal(reviewResult.changes[0].patchContent, 'hello world\n');
    assert.ok(reviewResult.workspaceAdmission);
    assert.ok(reviewResult.executionIdentity);
});

test('review subcommand rejects tampered patch content with exit code 1', async () => {
    const root = path.join(tmpDir, 'source-review-tampered-content');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-review-tampered-content',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest-review-tamper.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code: runCode, stdout: runStdout } = await runCli(manifestPath);
    assert.equal(runCode, 0);
    const runResult = JSON.parse(runStdout);

    // Tamper with patchContent in the artifact
    const artifact = JSON.parse(await readFile(runResult.artifactPath, 'utf8'));
    artifact.reviewPatch.changes[0].patchContent = 'malicious modification\n';
    const tamperedPath = path.join(fixtureDir, 'artifact-tampered-content.json');
    await writeFile(tamperedPath, JSON.stringify(artifact));

    const { code: revCode, stdout: revStdout } = await runCliArgs('review', tamperedPath);
    assert.equal(revCode, 1);
    const reviewResult = JSON.parse(revStdout);

    assert.equal(reviewResult.status, 'invalid');
    assert.equal(reviewResult.taskId, 'test-review-tampered-content');
    assert.ok(reviewResult.reason.includes('mismatch'));
});

test('review subcommand rejects tampered manifestHash with exit code 1', async () => {
    const root = path.join(tmpDir, 'source-review-tampered-hash');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-review-tampered-hash',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest-review-tamper-hash.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code: runCode, stdout: runStdout } = await runCli(manifestPath);
    assert.equal(runCode, 0);
    const runResult = JSON.parse(runStdout);

    // Tamper with manifestHash
    const artifact = JSON.parse(await readFile(runResult.artifactPath, 'utf8'));
    artifact.reviewPatch.manifestHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const tamperedPath = path.join(fixtureDir, 'artifact-tampered-hash.json');
    await writeFile(tamperedPath, JSON.stringify(artifact));

    const { code: revCode, stdout: revStdout } = await runCliArgs('review', tamperedPath);
    assert.equal(revCode, 1);
    const reviewResult = JSON.parse(revStdout);

    assert.equal(reviewResult.status, 'invalid');
    assert.ok(reviewResult.reason.includes('Manifest hash integrity mismatch'));
});

test('review subcommand rejects stale artifact when source file changes on disk', async () => {
    const root = path.join(tmpDir, 'source-review-stale');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-review-stale',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest-review-stale.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code: runCode, stdout: runStdout } = await runCli(manifestPath);
    assert.equal(runCode, 0);
    const runResult = JSON.parse(runStdout);

    // Modify the source baseline file on disk after execution
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'concurrent external edit\n');

    const { code: revCode, stdout: revStdout } = await runCliArgs('review', runResult.artifactPath);
    assert.equal(revCode, 1);
    const reviewResult = JSON.parse(revStdout);

    assert.equal(reviewResult.status, 'invalid');
    assert.ok(reviewResult.reason.includes('Stale baseline'), `Expected Stale baseline reason, got: ${reviewResult.reason}`);
});

test('review subcommand rejects stale artifact when source file is deleted on disk', async () => {
    const root = path.join(tmpDir, 'source-review-deleted');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');

    const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'test-review-deleted',
        objective: 'Update greeting',
        acceptance: ['greeting matches'],
        source: { root },
        scope: {
            readPaths: ['src/greeting.txt'],
            writePaths: ['src/greeting.txt'],
            createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }],
        budget: { maxTurns: 10, maxWallMs: 60000 },
        _fakeSteps: [
            { name: 'read_slice', args: { path: 'src/greeting.txt' } },
            { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
            { name: 'submit_receipt', args: { summary: 'Done' } }
        ]
    };

    const manifestPath = path.join(fixtureDir, 'manifest-review-deleted.json');
    await writeFile(manifestPath, JSON.stringify(manifest));

    const { code: runCode, stdout: runStdout } = await runCli(manifestPath);
    assert.equal(runCode, 0);
    const runResult = JSON.parse(runStdout);

    // Delete the source baseline file on disk
    await rm(path.join(root, 'src', 'greeting.txt'));

    const { code: revCode, stdout: revStdout } = await runCliArgs('review', runResult.artifactPath);
    assert.equal(revCode, 1);
    const reviewResult = JSON.parse(revStdout);

    assert.equal(reviewResult.status, 'invalid');
    assert.ok(reviewResult.reason.includes('missing or inaccessible'), `Expected missing or inaccessible reason, got: ${reviewResult.reason}`);
});

test('review subcommand rejects missing artifact or malformed JSON', async () => {
    // Missing file
    const { code: codeMissing, stdout: stdoutMissing } = await runCliArgs('review', path.join(fixtureDir, 'nonexistent-artifact.json'));
    assert.equal(codeMissing, 1);
    const resMissing = JSON.parse(stdoutMissing);
    assert.equal(resMissing.status, 'error');
    assert.equal(resMissing.stage, 'read_artifact');

    // Malformed JSON
    const malformedPath = path.join(fixtureDir, 'malformed-artifact.json');
    await writeFile(malformedPath, '{ not valid json');
    const { code: codeMalformed, stdout: stdoutMalformed } = await runCliArgs('review', malformedPath);
    assert.equal(codeMalformed, 1);
    const resMalformed = JSON.parse(stdoutMalformed);
    assert.equal(resMalformed.status, 'error');
    assert.equal(resMalformed.stage, 'parse_artifact');

    // Artifact missing reviewPatch
    const noReviewPatchPath = path.join(fixtureDir, 'no-review-patch.json');
    await writeFile(noReviewPatchPath, JSON.stringify({ taskId: 'foo' }));
    const { code: codeNoPatch, stdout: stdoutNoPatch } = await runCliArgs('review', noReviewPatchPath);
    assert.equal(codeNoPatch, 1);
    const resNoPatch = JSON.parse(stdoutNoPatch);
    assert.equal(resNoPatch.status, 'error');
    assert.equal(resNoPatch.stage, 'validate_artifact');
});

test('review subcommand requires argument and exits with code 2', async () => {
    const { code, stderr } = await runCliArgs('review');
    assert.equal(code, 2);
    assert.ok(stderr.includes('Usage: node src/cli.js review'));
});
