import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '../src/fake-provider.js';
import { runAssignment, validateAssignment, sha256 } from '../src/index.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

describe('Validation Parity: validateAssignment vs admitAssignment', () => {
  it('rejects empty contains check', () => {
    assert.throws(
      () => validateAssignment({
        objective: 'Test objective',
        acceptance: 'Test acceptance',
        allowedPaths: ['src/greeting.txt'],
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: '' }]
      }),
      /contains must not be empty/
    );
  });

  it('accepts non-empty contains check and empty equals check', () => {
    const validContains = validateAssignment({
      objective: 'Test objective',
      acceptance: 'Test acceptance',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    });
    assert.equal(validContains.checks[0].text, 'hello');

    const validEqualsEmpty = validateAssignment({
      objective: 'Test objective',
      acceptance: 'Test acceptance',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: '' }]
    });
    assert.equal(validEqualsEmpty.checks[0].text, '');
  });

  it('rejects invalid scope shapes', () => {
    // null scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: null, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    // primitive scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: 123, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: 'a.txt', checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    // empty object scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: {}, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    // non-array readPaths
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: { readPaths: 'a.txt' }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    // empty arrays in both readPaths and writePaths
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: { readPaths: [], writePaths: [] }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Scope must include at least one readPath or writePath/);
    // invalid createPaths type
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: { readPaths: ['a.txt'], writePaths: [], createPaths: null }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid allowedPaths/);
    // path traversal in scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: ['../secret.txt'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid relative path/);
    // hidden file in scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: ['.env'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid relative path/);
    // backslash in scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: ['src\\a.txt'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid relative path/);
    // colon in scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: ['src:stream/a.txt'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid relative path/);
    // null byte in scope
    assert.throws(() => validateAssignment({ objective: 'Test', acceptance: 'Test', allowedPaths: ['src/a\0.txt'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }), /Invalid relative path/);
  });

  it('strictly validates canonical scope object contract', () => {
    // Array passed as canonical scope must be rejected
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: ['a.txt'], checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /Missing or invalid scope object/
    );
    // Null canonical scope
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: null, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /Missing or invalid scope object/
    );
    // Missing writePaths
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { readPaths: ['a.txt'] }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /scope\.writePaths must be an array/
    );
    // Missing readPaths
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { writePaths: ['a.txt'] }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /scope\.readPaths must be an array/
    );
    // Both arrays empty
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { readPaths: [], writePaths: [] }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /Scope must include at least one readPath or writePath/
    );
    // Non-array createPaths
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { readPaths: ['a.txt'], writePaths: ['a.txt'], createPaths: null }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /scope\.createPaths must be an array/
    );
    // Create-only shape (unsupported createPaths semantics)
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { readPaths: [], writePaths: [], createPaths: ['new.txt'] }, checks: [{ type: 'equals', path: 'new.txt', text: 'x' }] }),
      /createPaths are not safely executable with current runtime semantics/
    );
    // Non-empty createPaths rejected
    assert.throws(
      () => validateAssignment({ objective: 'Test', acceptance: 'Test', scope: { readPaths: ['a.txt'], writePaths: ['a.txt'], createPaths: ['new.txt'] }, checks: [{ type: 'equals', path: 'a.txt', text: 'x' }] }),
      /createPaths are not safely executable with current runtime semantics/
    );
  });

  it('preserves legacy allowedPaths array support and maps to read+write scope', () => {
    const res = validateAssignment({
      objective: 'Test objective',
      acceptance: 'Test acceptance',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello' }]
    });
    assert.deepEqual(res.allowedPaths, ['src/greeting.txt']);
    assert.deepEqual(res.scope.readPaths, ['src/greeting.txt']);
    assert.deepEqual(res.scope.writePaths, ['src/greeting.txt']);
    assert.deepEqual(res.scope.createPaths, []);
  });

  it('accepts scope object with readPaths and writePaths, and supports canonical scope property name', () => {
    const res = validateAssignment({
      objective: 'Test objective',
      acceptance: 'Test acceptance',
      scope: {
        readPaths: ['src/read.txt'],
        writePaths: ['src/write.txt']
      },
      checks: [{ type: 'equals', path: 'src/write.txt', text: 'ok' }]
    });
    assert.deepEqual(res.allowedPaths, ['src/read.txt', 'src/write.txt']);
    assert.deepEqual(res.scope.readPaths, ['src/read.txt']);
    assert.deepEqual(res.scope.writePaths, ['src/write.txt']);
  });

  it('deduplicates paths when validating maximum 20 paths limit', () => {
    const paths = Array.from({ length: 15 }, (_, i) => `src/file_${i}.txt`);
    const res = validateAssignment({
      objective: 'Test objective',
      acceptance: 'Test acceptance',
      scope: {
        readPaths: paths,
        writePaths: paths
      },
      checks: [{ type: 'equals', path: 'src/file_0.txt', text: 'ok' }]
    });
    assert.equal(res.allowedPaths.length, 15);
  });

  it('validates schemaVersion, taskId, and acceptance array', () => {
    assert.throws(
      () => validateAssignment({
        schemaVersion: 'rct.assignment.v2',
        objective: 'Test',
        acceptance: 'Test',
        allowedPaths: ['a.txt'],
        checks: [{ type: 'equals', path: 'a.txt', text: 'x' }]
      }),
      /Unsupported schemaVersion/
    );

    assert.throws(
      () => validateAssignment({
        taskId: '../traversal-id',
        objective: 'Test',
        acceptance: 'Test',
        allowedPaths: ['a.txt'],
        checks: [{ type: 'equals', path: 'a.txt', text: 'x' }]
      }),
      /Invalid or missing taskId/
    );

    assert.throws(
      () => validateAssignment({
        objective: 'Test',
        acceptance: [],
        allowedPaths: ['a.txt'],
        checks: [{ type: 'equals', path: 'a.txt', text: 'x' }]
      }),
      /acceptance must be a non-empty array/
    );

    const validArrayAcceptance = validateAssignment({
      taskId: 'valid-task-id_01',
      schemaVersion: 'rct.assignment.v1',
      objective: 'Test objective',
      acceptance: ['first line of criteria', 'second line of criteria'],
      allowedPaths: ['a.txt'],
      checks: [{ type: 'equals', path: 'a.txt', text: 'x' }]
    });
    assert.equal(validArrayAcceptance.id, 'valid-task-id_01');
    assert.equal(validArrayAcceptance.acceptance, 'first line of criteria\nsecond line of criteria');
  });
});

describe('Effective Diff and Reversion Safety', () => {
  async function withFixture(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rct-effective-diff-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'greeting.txt'), 'hello\n');
      return await fn(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it('reverted edit fails with empty_effective_diff in runAssignment', () => withFixture(async (root) => {
    const provider = new FakeProvider([
      { name: 'read_slice', args: { path: 'src/greeting.txt' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello world\n' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello world\n'), content: 'hello\n' } },
      { name: 'submit_receipt', args: { summary: 'Reverted back to original' } }
    ]);

    const result = await runAssignment({
      id: 'reversion-test',
      objective: 'Update greeting',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'failed');
    assert.equal(result.failureReason, 'empty_effective_diff');
    assert.equal(result.diffOutcome, 'reverted');
    assert.deepEqual(result.changedPaths, []);
    assert.equal(result.patches.length, 2);
  }));

  it('repeated edits collapse to effective diff in runAssignment', () => withFixture(async (root) => {
    const provider = new FakeProvider([
      { name: 'read_slice', args: { path: 'src/greeting.txt' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello step 1\n' } },
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello step 1\n'), content: 'hello world\n' } },
      { name: 'submit_receipt', args: { summary: 'Completed after two edits' } }
    ]);

    const result = await runAssignment({
      id: 'repeated-edits-test',
      objective: 'Update greeting',
      acceptance: 'Greeting equals hello world',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello world\n' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'review_ready');
    assert.equal(result.diffOutcome, 'applied');
    assert.deepEqual(result.changedPaths, ['src/greeting.txt']);
    assert.equal(result.patches.length, 2);
  }));

  it('multi-file edit with partial reversion accurately tracks only effectively changed files', () => withFixture(async (root) => {
    await writeFile(path.join(root, 'src', 'other.txt'), 'other original\n');

    const provider = new FakeProvider([
      { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello patched\n' } },
      { name: 'propose_patch', args: { path: 'src/other.txt', expectedSha256: sha256('other original\n'), content: 'other temp\n' } },
      { name: 'propose_patch', args: { path: 'src/other.txt', expectedSha256: sha256('other temp\n'), content: 'other original\n' } },
      { name: 'submit_receipt', args: { summary: 'Done with greeting, reverted other' } }
    ]);

    const result = await runAssignment({
      id: 'multi-file-partial-revert',
      objective: 'Update greeting',
      acceptance: 'Greeting equals hello patched',
      allowedPaths: ['src/greeting.txt', 'src/other.txt'],
      checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello patched\n' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'review_ready');
    assert.equal(result.diffOutcome, 'applied');
    assert.deepEqual(result.changedPaths, ['src/greeting.txt']);
    assert.equal(result.patches.length, 3);
  }));

  it('pre-edit budget exhaustion preserves budget_exhausted failureReason and diffOutcome: empty in runAssignment', () => withFixture(async (root) => {
    const provider = new FakeProvider([
      { name: 'read_slice', args: { path: 'src/greeting.txt' } }
    ]);

    const result = await runAssignment({
      id: 'pre-edit-budget-test',
      objective: 'Read greeting without patching',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      budget: { maxTurns: 1 },
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'budget_exhausted');
    assert.equal(result.failureReason, 'budget_exhausted');
    assert.equal(result.diffOutcome, 'empty');
    assert.deepEqual(result.changedPaths, []);
  }));

  it('pre-edit transport failure preserves transport_error failureReason and diffOutcome: empty in runAssignment', () => withFixture(async (root) => {
    const provider = {
      name: 'transport-failing-provider',
      async next() {
        const err = new Error('Transport socket hang up');
        err.name = 'ProviderTransportError';
        throw err;
      }
    };

    const result = await runAssignment({
      id: 'pre-edit-transport-test',
      objective: 'Attempt run with transport error',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'transport_error');
    assert.equal(result.diffOutcome, 'empty');
    assert.deepEqual(result.changedPaths, []);
  }));

  it('pre-edit transport timeout preserves transport_error failureReason and diffOutcome: empty in runAssignment', () => withFixture(async (root) => {
    const provider = {
      name: 'timeout-provider',
      async next() {
        const err = new Error('Request timed out');
        err.name = 'TimeoutError';
        throw err;
      }
    };

    const result = await runAssignment({
      id: 'pre-edit-timeout-test',
      objective: 'Attempt run with timeout error',
      acceptance: 'Greeting contains hello',
      allowedPaths: ['src/greeting.txt'],
      checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }]
    }, provider, root, { isolated: true });

    assert.equal(result.state, 'unknown');
    assert.equal(result.failureReason, 'transport_error');
    assert.equal(result.diffOutcome, 'empty');
    assert.deepEqual(result.changedPaths, []);
  }));

  it('offline CLI rejects reverted diff and emits metadata with empty changedPaths', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rct-cli-revert-'));
    try {
      await mkdir(path.join(tmp, 'src'), { recursive: true });
      await writeFile(path.join(tmp, 'src', 'greeting.txt'), 'hello\n');

      const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'cli-reversion-test',
        objective: 'Test reversion',
        acceptance: ['Greeting contains hello'],
        source: { root: tmp },
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }],
        _fakeSteps: [
          { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello modified\n' } },
          { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello modified\n'), content: 'hello\n' } },
          { name: 'submit_receipt', args: { summary: 'Reverted' } }
        ]
      };

      const manifestPath = path.join(tmp, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));

      let res;
      try {
        const { stdout, stderr } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
        res = { code: 0, stdout, stderr };
      } catch (e) {
        res = { code: e.code, stdout: e.stdout, stderr: e.stderr };
      }

      assert.equal(res.code, 1);
      const metadata = JSON.parse(res.stdout);
      assert.equal(metadata.state, 'failed');
      assert.equal(metadata.failureReason, 'empty_effective_diff');
      assert.equal(metadata.diffOutcome, 'reverted');
      assert.deepEqual(metadata.changedPaths, []);
      assert.equal(metadata.sourceUnchanged, true);

      const artifact = JSON.parse(await readFile(metadata.artifactPath, 'utf8'));
      assert.equal(artifact.state, 'failed');
      assert.equal(artifact.diffOutcome, 'reverted');
      assert.deepEqual(artifact.changedPaths, []);
      assert.deepEqual(artifact.patches, []);
      assert.equal(artifact.failureReason, 'empty_effective_diff');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('offline CLI reflects final effective source-to-snapshot diff for repeated edits', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rct-cli-repeated-'));
    try {
      await mkdir(path.join(tmp, 'src'), { recursive: true });
      await writeFile(path.join(tmp, 'src', 'greeting.txt'), 'hello\n');

      const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'cli-repeated-test',
        objective: 'Test repeated edits',
        acceptance: ['Greeting equals hello final'],
        source: { root: tmp },
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        checks: [{ type: 'equals', path: 'src/greeting.txt', text: 'hello final\n' }],
        _fakeSteps: [
          { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello\n'), content: 'hello intermediate\n' } },
          { name: 'propose_patch', args: { path: 'src/greeting.txt', expectedSha256: sha256('hello intermediate\n'), content: 'hello final\n' } },
          { name: 'submit_receipt', args: { summary: 'Final patch applied' } }
        ]
      };

      const manifestPath = path.join(tmp, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));

      const { stdout } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
      const metadata = JSON.parse(stdout);
      assert.equal(metadata.state, 'review_ready');
      assert.equal(metadata.diffOutcome, 'applied');
      assert.deepEqual(metadata.changedPaths, ['src/greeting.txt']);
      assert.equal(metadata.sourceUnchanged, true);

      const artifact = JSON.parse(await readFile(metadata.artifactPath, 'utf8'));
      assert.equal(artifact.state, 'review_ready');
      assert.equal(artifact.diffOutcome, 'applied');
      assert.deepEqual(artifact.changedPaths, ['src/greeting.txt']);
      assert.equal(artifact.patches.length, 1);
      assert.equal(artifact.patches[0].path, 'src/greeting.txt');
      assert.equal(artifact.patches[0].beforeContent, 'hello\n');
      assert.equal(artifact.patches[0].afterContent, 'hello final\n');
      assert.equal(artifact.patches[0].beforeSha256, sha256('hello\n'));
      assert.equal(artifact.patches[0].afterSha256, sha256('hello final\n'));
      assert.equal(artifact.appliedPatches.length, 2);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('offline CLI preserves budget_exhausted failureReason and diffOutcome: empty before diff', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rct-cli-budget-'));
    try {
      await mkdir(path.join(tmp, 'src'), { recursive: true });
      await writeFile(path.join(tmp, 'src', 'greeting.txt'), 'hello\n');

      const manifest = {
        schemaVersion: 'rct.assignment.v1',
        taskId: 'cli-budget-test',
        objective: 'Test budget exhaustion before diff',
        acceptance: ['Greeting contains hello'],
        source: { root: tmp },
        scope: {
          readPaths: ['src/greeting.txt'],
          writePaths: ['src/greeting.txt'],
          createPaths: []
        },
        dataPolicy: { classification: 'public', allowRemoteInference: true },
        budget: { maxTurns: 1 },
        checks: [{ type: 'contains', path: 'src/greeting.txt', text: 'hello' }],
        _fakeSteps: [
          { name: 'read_slice', args: { path: 'src/greeting.txt' } }
        ]
      };

      const manifestPath = path.join(tmp, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest));

      let res;
      try {
        const { stdout, stderr } = await exec(process.execPath, [cliPath, 'run-offline', manifestPath]);
        res = { code: 0, stdout, stderr };
      } catch (e) {
        res = { code: e.code, stdout: e.stdout, stderr: e.stderr };
      }

      assert.equal(res.code, 1);
      const metadata = JSON.parse(res.stdout);
      assert.equal(metadata.state, 'budget_exhausted');
      assert.equal(metadata.failureReason, 'budget_exhausted');
      assert.equal(metadata.diffOutcome, 'empty');
      assert.deepEqual(metadata.changedPaths, []);
      assert.equal(metadata.sourceUnchanged, true);

      const artifact = JSON.parse(await readFile(metadata.artifactPath, 'utf8'));
      assert.equal(artifact.state, 'budget_exhausted');
      assert.equal(artifact.failureReason, 'budget_exhausted');
      assert.equal(artifact.diffOutcome, 'empty');
      assert.deepEqual(artifact.changedPaths, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
