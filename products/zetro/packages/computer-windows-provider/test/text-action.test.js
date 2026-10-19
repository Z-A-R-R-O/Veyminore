/**
 * @zetro/computer-windows-provider - Target-Scoped Text & Independent Readback Unit Tests
 *
 * Verifies strict authorization gates, grant expiry, wrong target rejection,
 * independent readback parsing, and bounded text entry without live desktop execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWindowsProcessRunner,
  ProcessRunnerError
} from '../src/process-runner.js';
import {
  buildHelperReadTextArgs,
  parseHelperReadTextOutput,
  buildHelperWriteTextArgs,
  parseHelperWriteTextOutput,
  MAX_TEXT_LENGTH,
  MAX_TEXT_BYTES,
  ProtocolError
} from '../src/protocol.js';
import { createWindowsObserver } from '../src/observer-adapter.js';

const AUTHORIZED_DEMO_SENTENCE = 'Success — Codex, AGR, and OCR completed this sentence using ZETRO Computing.';
const DYNAMIC_TASK_SENTENCE = 'Success — AGR-4 completed this task using ZETRO Computing.';

test('protocol: buildHelperWriteTextArgs enforces policy gates and valid grant', () => {
  const clockNow = 1700000000000;
  const validExpiry = clockNow + 60000;

  // 1. inputEnabled = false (default) MUST throw ProtocolError
  assert.throws(
    () => buildHelperWriteTextArgs(1001, AUTHORIZED_DEMO_SENTENCE, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      inputEnabled: false,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /Input is disabled by policy/.test(err.message),
    'Should fail closed when inputEnabled is false'
  );

  // 2. inputEnabled omitted MUST throw ProtocolError
  assert.throws(
    () => buildHelperWriteTextArgs(1001, AUTHORIZED_DEMO_SENTENCE, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /Input is disabled by policy/.test(err.message),
    'Should fail closed when inputEnabled is omitted'
  );

  // 3. Expired grantExpiry MUST throw ProtocolError
  assert.throws(
    () => buildHelperWriteTextArgs(1001, AUTHORIZED_DEMO_SENTENCE, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: clockNow - 1000,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /grant expired/.test(err.message),
    'Should fail closed when grantExpiry is in the past'
  );

  // 4. Invalid or non-numeric HWND MUST throw ProtocolError
  assert.throws(
    () => buildHelperWriteTextArgs(0, AUTHORIZED_DEMO_SENTENCE, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /Invalid hwnd/.test(err.message)
  );

  // 5. Valid call builds exact safe argument vector
  const args = buildHelperWriteTextArgs(12345, AUTHORIZED_DEMO_SENTENCE, {
    expectedPid: 9876,
    expectedStart: '12345:9876:boot',
    sessionId: 'session-agr4-001',
    grantExpiry: validExpiry,
    inputEnabled: true,
    clockNow
  });

  assert.deepEqual(args, [
    '--write-text', '12345',
    '--text', AUTHORIZED_DEMO_SENTENCE,
    '--input-enabled',
    '--grant-expiry', String(validExpiry),
    '--expected-pid', '9876',
    '--expected-start', '12345:9876:boot',
    '--session', 'session-agr4-001'
  ]);
});

test('protocol: buildHelperWriteTextArgs strictly requires full non-empty identity (PID, start, session)', () => {
  const clockNow = 1700000000000;
  const validExpiry = clockNow + 60000;

  // Missing or non-positive expectedPid
  assert.throws(
    () => buildHelperWriteTextArgs(1001, 'test', {
      expectedPid: 0,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /expectedPid is required/.test(err.message)
  );

  assert.throws(
    () => buildHelperWriteTextArgs(1001, 'test', {
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /expectedPid is required/.test(err.message)
  );

  // Missing or whitespace expectedStart
  assert.throws(
    () => buildHelperWriteTextArgs(1001, 'test', {
      expectedPid: 100,
      expectedStart: '   ',
      sessionId: 'sess-01',
      grantExpiry: validExpiry,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /expectedStart generation token is required/.test(err.message)
  );

  // Missing or whitespace sessionId
  assert.throws(
    () => buildHelperWriteTextArgs(1001, 'test', {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: '',
      grantExpiry: validExpiry,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /sessionId is required/.test(err.message)
  );
});

test('protocol: buildHelperWriteTextArgs enforces exact expiry boundary and declared text limits', () => {
  const clockNow = 1700000000000;

  // Exact boundary: grantExpiry === clockNow MUST throw ProtocolError
  assert.throws(
    () => buildHelperWriteTextArgs(1001, 'test', {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: clockNow,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /grant expired/.test(err.message)
  );

  // grantExpiry > clockNow passes boundary
  const validArgs = buildHelperWriteTextArgs(1001, 'test', {
    expectedPid: 100,
    expectedStart: '1001:100:boot',
    sessionId: 'sess-01',
    grantExpiry: clockNow + 1,
    inputEnabled: true,
    clockNow
  });
  assert.ok(validArgs.includes('--grant-expiry'));

  // Empty text rejection
  assert.throws(
    () => buildHelperWriteTextArgs(1001, '', {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: clockNow + 60000,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /non-empty string/.test(err.message)
  );

  // Text exceeding MAX_TEXT_LENGTH rejection
  const oversizedText = 'A'.repeat(MAX_TEXT_LENGTH + 1);
  assert.throws(
    () => buildHelperWriteTextArgs(1001, oversizedText, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: clockNow + 60000,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /exceeds declared limit of 4096 characters/.test(err.message)
  );

  // Text exceeding MAX_TEXT_BYTES rejection (multibyte UTF-8 characters)
  const multibyteOversized = '😀'.repeat(Math.ceil(MAX_TEXT_BYTES / 4) + 1);
  assert.throws(
    () => buildHelperWriteTextArgs(1001, multibyteOversized, {
      expectedPid: 100,
      expectedStart: '1001:100:boot',
      sessionId: 'sess-01',
      grantExpiry: clockNow + 60000,
      inputEnabled: true,
      clockNow
    }),
    (err) => err instanceof ProtocolError && /exceeds declared limit/.test(err.message)
  );
});

test('protocol: parseHelperWriteTextOutput parses valid written response', () => {
  const rawJson = JSON.stringify({
    status: 'written',
    hwnd: 12345,
    processId: 9876,
    method: 'UIA_ValuePattern',
    charsWritten: AUTHORIZED_DEMO_SENTENCE.length
  });

  const parsed = parseHelperWriteTextOutput(rawJson);
  assert.equal(parsed.status, 'written');
  assert.equal(parsed.hwnd, 12345);
  assert.equal(parsed.processId, 9876);
  assert.equal(parsed.method, 'UIA_ValuePattern');
  assert.equal(parsed.charsWritten, AUTHORIZED_DEMO_SENTENCE.length);

  // Rejects invalid status
  assert.throws(
    () => parseHelperWriteTextOutput(JSON.stringify({ status: 'failed' })),
    (err) => err instanceof ProtocolError
  );
});

test('protocol: buildHelperReadTextArgs constructs independent read arguments', () => {
  const args = buildHelperReadTextArgs(12345, {
    expectedPid: 9876,
    expectedStart: '12345:9876:boot'
  });

  assert.deepEqual(args, [
    '--read-text', '12345',
    '--expected-pid', '9876',
    '--expected-start', '12345:9876:boot'
  ]);
});

test('protocol: parseHelperReadTextOutput strictly parses actual document text without echoing', () => {
  const helperOutput = JSON.stringify({
    status: 'read',
    hwnd: 12345,
    processId: 9876,
    method: 'UIA_ValuePattern',
    text: AUTHORIZED_DEMO_SENTENCE,
    charCount: AUTHORIZED_DEMO_SENTENCE.length
  });

  const result = parseHelperReadTextOutput(helperOutput);
  assert.equal(result.status, 'read');
  assert.equal(result.hwnd, 12345);
  assert.equal(result.processId, 9876);
  assert.equal(result.method, 'UIA_ValuePattern');
  assert.equal(result.text, AUTHORIZED_DEMO_SENTENCE);
  assert.equal(result.charCount, AUTHORIZED_DEMO_SENTENCE.length);

  // Dynamic sentence verification
  const dynamicOutput = JSON.stringify({
    status: 'read',
    hwnd: 12345,
    processId: 9876,
    method: 'WM_GETTEXT',
    text: DYNAMIC_TASK_SENTENCE,
    charCount: DYNAMIC_TASK_SENTENCE.length
  });

  const dynamicResult = parseHelperReadTextOutput(dynamicOutput);
  assert.equal(dynamicResult.text, DYNAMIC_TASK_SENTENCE);
  assert.equal(dynamicResult.method, 'WM_GETTEXT');
});

test('process-runner: writeText enforces inputEnabled gate before spawning process', async () => {
  let spawned = false;
  const fakeExec = async () => {
    spawned = true;
    return { stdout: '{}', stderr: '' };
  };

  const runner = createWindowsProcessRunner({
    helperPath: 'fake-helper.exe',
    execFileImpl: fakeExec
  });

  // inputEnabled: false MUST NOT spawn process
  await assert.rejects(
    async () => {
      await runner.writeText(1001, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 100,
        expectedStart: '1001:100:boot',
        sessionId: 'sess-01',
        grantExpiry: Date.now() + 60000,
        inputEnabled: false
      });
    },
    (err) => err instanceof ProtocolError && /Input is disabled by policy/.test(err.message)
  );
  assert.equal(spawned, false, 'Process must not be spawned when inputEnabled is false');

  // expired grant MUST NOT spawn process
  await assert.rejects(
    async () => {
      await runner.writeText(1001, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 100,
        expectedStart: '1001:100:boot',
        sessionId: 'sess-01',
        grantExpiry: Date.now() - 10000,
        inputEnabled: true
      });
    },
    (err) => err instanceof ProtocolError && /grant expired/.test(err.message)
  );
  assert.equal(spawned, false, 'Process must not be spawned when grant is expired');
});

test('process-runner: writeText executes authorized action and returns written receipt', async () => {
  let capturedArgs = null;
  let capturedOptions = null;

  const fakeExec = async (cmd, args, opts) => {
    capturedArgs = args;
    capturedOptions = opts;
    return {
      stdout: JSON.stringify({
        status: 'written',
        hwnd: 12345,
        processId: 9876,
        method: 'UIA_ValuePattern',
        charsWritten: AUTHORIZED_DEMO_SENTENCE.length
      }),
      stderr: ''
    };
  };

  const runner = createWindowsProcessRunner({
    helperPath: 'fake-helper.exe',
    execFileImpl: fakeExec
  });

  const validExpiry = Date.now() + 60000;
  const result = await runner.writeText(12345, AUTHORIZED_DEMO_SENTENCE, {
    expectedPid: 9876,
    expectedStart: '12345:9876:boot',
    sessionId: 'session-test-001',
    grantExpiry: validExpiry,
    inputEnabled: true
  });

  assert.equal(result.status, 'written');
  assert.equal(result.hwnd, 12345);
  assert.equal(result.processId, 9876);
  assert.equal(result.method, 'UIA_ValuePattern');
  assert.equal(result.charsWritten, AUTHORIZED_DEMO_SENTENCE.length);

  assert.equal(capturedOptions.shell, false, 'Execution must strictly avoid shell wrapping');
  assert.ok(capturedArgs.includes('--write-text'));
  assert.ok(capturedArgs.includes('--input-enabled'));
  assert.ok(capturedArgs.includes('--expected-pid'));
  assert.ok(capturedArgs.includes('--session'));
});

test('process-runner: writeText maps native exit codes to descriptive ProcessRunnerError codes', async () => {
  // 1. INPUT_DISABLED (exit code 10)
  const fakeExecDisabled = async () => {
    const err = new Error('Command failed');
    err.code = 10;
    err.stderr = 'Input is disabled by policy (default inputdisabled). Explicit authorization required.';
    throw err;
  };

  const runner1 = createWindowsProcessRunner({ helperPath: 'fake-helper.exe', execFileImpl: fakeExecDisabled });
  await assert.rejects(
    async () => {
      await runner1.writeText(12345, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 9876,
        expectedStart: '12345:9876:boot',
        sessionId: 'sess-01',
        grantExpiry: Date.now() + 60000,
        inputEnabled: true
      });
    },
    (err) => err instanceof ProcessRunnerError && err.code === 'INPUT_DISABLED'
  );

  // 2. PID_MISMATCH (exit code 4)
  const fakeExecPidMismatch = async () => {
    const err = new Error('Command failed');
    err.code = 4;
    err.stderr = 'Process PID mismatch: expected 9876, got 1111';
    throw err;
  };

  const runner2 = createWindowsProcessRunner({ helperPath: 'fake-helper.exe', execFileImpl: fakeExecPidMismatch });
  await assert.rejects(
    async () => {
      await runner2.writeText(12345, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 9876,
        expectedStart: '12345:9876:boot',
        sessionId: 'sess-01',
        grantExpiry: Date.now() + 60000,
        inputEnabled: true
      });
    },
    (err) => err instanceof ProcessRunnerError && err.code === 'PID_MISMATCH'
  );

  // 3. Substring start identity rejection -> IDENTITY_MISMATCH (exit code 5)
  const fakeExecSubstringMismatch = async () => {
    const err = new Error('Command failed');
    err.code = 5;
    err.stderr = "Start identity mismatch: expected exact '12345:9876', got '12345:9876:boot'";
    throw err;
  };

  const runner3 = createWindowsProcessRunner({ helperPath: 'fake-helper.exe', execFileImpl: fakeExecSubstringMismatch });
  await assert.rejects(
    async () => {
      await runner3.writeText(12345, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 9876,
        expectedStart: '12345:9876',
        sessionId: 'sess-01',
        grantExpiry: Date.now() + 60000,
        inputEnabled: true
      });
    },
    (err) => err instanceof ProcessRunnerError && err.code === 'IDENTITY_MISMATCH'
  );

  // 4. Uncertain UIA failure without fallback -> UIA_UNCERTAIN_FAILURE (exit code 14)
  const fakeExecUiaUncertain = async () => {
    const err = new Error('Command failed');
    err.code = 14;
    err.stderr = 'UIAutomation ValuePattern invocation failed or uncertain: COM error 0x80004005. Fallback SendInput prohibited to prevent duplicate/corrupted input.';
    throw err;
  };

  const runner4 = createWindowsProcessRunner({ helperPath: 'fake-helper.exe', execFileImpl: fakeExecUiaUncertain });
  await assert.rejects(
    async () => {
      await runner4.writeText(12345, AUTHORIZED_DEMO_SENTENCE, {
        expectedPid: 9876,
        expectedStart: '12345:9876:boot',
        sessionId: 'sess-01',
        grantExpiry: Date.now() + 60000,
        inputEnabled: true
      });
    },
    (err) => err instanceof ProcessRunnerError && err.code === 'UIA_UNCERTAIN_FAILURE'
  );
});

test('process-runner & observer-adapter: readText queries actual control without echoing input', async () => {
  const actualEditorContent = 'Success — Codex, AGR, and OCR completed this sentence using ZETRO Computing.';

  const fakeExec = async (cmd, args) => {
    assert.deepEqual(args, ['--read-text', '54321', '--expected-pid', '8888']);
    return {
      stdout: JSON.stringify({
        status: 'read',
        hwnd: 54321,
        processId: 8888,
        method: 'UIA_ValuePattern',
        text: actualEditorContent,
        charCount: actualEditorContent.length
      }),
      stderr: ''
    };
  };

  const observer = createWindowsObserver({
    helperPath: 'fake-helper.exe',
    execFileImpl: fakeExec
  });

  const readResult = await observer.readText(54321, { expectedPid: 8888 });

  assert.equal(readResult.status, 'read');
  assert.equal(readResult.hwnd, 54321);
  assert.equal(readResult.processId, 8888);
  assert.equal(readResult.method, 'UIA_ValuePattern');
  assert.equal(readResult.text, actualEditorContent);
  assert.equal(readResult.charCount, actualEditorContent.length);
});

