import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProviderConfig } from '../src/loader.js';
import { getDoctorReport, formatDoctorReport, runDoctorCli } from '../src/doctor.js';

const CANARY_GROQ = 'gsk_TEST_CANARY_SECRET_GROQ_998877665544332211';
const CANARY_OPENCODE = 'oc_TEST_CANARY_SECRET_OPENCODE_112233445566778899';
const CANARY_OPENROUTER = 'sk-or-v1-TEST_CANARY_SECRET_OPENROUTER_554433221199887766';

test('Security Invariant: Zero secret leakage in WeakMap, inspect (with showHidden/customInspect:false), serialization, and errors', async (t) => {
  const config = loadProviderConfig({
    env: {
      GROQ_API_KEY: CANARY_GROQ,
      OPENCODE_API_KEY: CANARY_OPENCODE,
      OPENROUTER_API_KEY: CANARY_OPENROUTER,
      ZETRO_PROVIDER: 'groq',
      ZETRO_APPROVED_PROVIDERS: 'groq',
      ZETRO_LIVE_INFERENCE_ENABLED: '1',
      ZETRO_ALLOW_REMOTE_SOURCE: '1',
      ZETRO_FREE_ONLY: '1'
    }
  });

  const canaryList = [CANARY_GROQ, CANARY_OPENCODE, CANARY_OPENROUTER];

  function assertNoLeak(targetString, contextName) {
    for (const canary of canaryList) {
      assert.strictEqual(
        targetString.includes(canary),
        false,
        `SECURITY VIOLATION: Secret canary leaked in ${contextName}`
      );
    }
  }

  await t.test('util.inspect with showHidden: true does NOT leak credentials (P2 WeakMap fix)', () => {
    // Standard inspect
    const inspectStandard = util.inspect(config, { depth: null });
    assertNoLeak(inspectStandard, 'util.inspect(config)');

    // Crucial: inspect with showHidden: true
    const inspectHidden = util.inspect(config, { showHidden: true, depth: null });
    assertNoLeak(inspectHidden, 'util.inspect(config, { showHidden: true })');

    // Crucial: inspect with customInspect: false and showHidden: true (inspects raw internal object slots)
    const inspectRawSlots = util.inspect(config, { showHidden: true, customInspect: false, depth: null });
    assertNoLeak(inspectRawSlots, 'util.inspect(config, { showHidden: true, customInspect: false })');
  });

  await t.test('Object.getOwnPropertySymbols(config) does NOT expose any secret storage symbols', () => {
    const symbols = Object.getOwnPropertySymbols(config);
    for (const sym of symbols) {
      const symVal = config[sym];
      assertNoLeak(JSON.stringify(symVal) || '', `Symbol ${sym.toString()}`);
    }
  });

  await t.test('Object.keys, Object.values, and Object.getOwnPropertyNames do NOT expose secrets', () => {
    const names = Object.getOwnPropertyNames(config);
    assertNoLeak(JSON.stringify(names), 'Object.getOwnPropertyNames(config)');
    const values = Object.values(config);
    assertNoLeak(JSON.stringify(values), 'Object.values(config)');
  });

  await t.test('JSON.stringify and getPublicConfig() have zero secret tokens', () => {
    assertNoLeak(JSON.stringify(config), 'JSON.stringify(config)');
    assertNoLeak(JSON.stringify(config.getPublicConfig()), 'JSON.stringify(config.getPublicConfig())');
  });

  await t.test('public error paths and invalid flags never include secret tokens', () => {
    const invalidConfig = loadProviderConfig({
      env: {
        GROQ_API_KEY: CANARY_GROQ,
        ZETRO_FREE_ONLY: 'typo',
        ZETRO_MAX_CONCURRENT_WORKERS: 'invalid'
      }
    });

    const errorStr = JSON.stringify(invalidConfig.invalidFlags) + JSON.stringify(invalidConfig.status.reasons);
    assertNoLeak(errorStr, 'public error / invalidFlags string');
  });

  await t.test('doctor report, formatting, and CLI outputs contain zero secrets', () => {
    const report = getDoctorReport(config);
    assertNoLeak(JSON.stringify(report), 'getDoctorReport(config)');
    assertNoLeak(formatDoctorReport(report), 'formatDoctorReport(report)');

    let stdoutBuffer = '';
    runDoctorCli([], {
      stdout: { write: (msg) => { stdoutBuffer += msg; } },
      env: {
        GROQ_API_KEY: CANARY_GROQ,
        OPENCODE_API_KEY: CANARY_OPENCODE,
        OPENROUTER_API_KEY: CANARY_OPENROUTER
      }
    });
    assertNoLeak(stdoutBuffer, 'runDoctorCli stdout');
  });

  await t.test('keysPresent contains strictly booleans and no string values', () => {
    assert.strictEqual(typeof config.keysPresent.groq, 'boolean');
    assert.strictEqual(typeof config.keysPresent.opencode, 'boolean');
    assert.strictEqual(typeof config.keysPresent.openrouter, 'boolean');
    assert.strictEqual(config.keysPresent.groq, true);
    assert.strictEqual(config.keysPresent.opencode, true);
    assert.strictEqual(config.keysPresent.openrouter, true);
  });

  await t.test('WeakMap credential access works exclusively via runtime getter', () => {
    assert.strictEqual(config.hasApiKey('groq'), true);
    assert.strictEqual(config.getApiKey('groq'), CANARY_GROQ);
    assert.strictEqual(config.hasApiKey('opencode'), true);
    assert.strictEqual(config.getApiKey('opencode'), CANARY_OPENCODE);
    assert.strictEqual(config.hasApiKey('openrouter'), true);
    assert.strictEqual(config.getApiKey('openrouter'), CANARY_OPENROUTER);
  });
});

test('Security Invariant: Ignore rules and isolated synthetic fixtures', async (t) => {
  await t.test('temporary synthetic fixtures are created in isolated tempdir and cleaned up', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetro-sec-test-'));
    const tmpFile = path.join(tmpDir, 'test.env');

    try {
      fs.writeFileSync(tmpFile, `GROQ_API_KEY=${CANARY_GROQ}\n`, 'utf8');
      assert.ok(fs.existsSync(tmpFile));

      const config = loadProviderConfig({ env: {}, envFile: tmpFile });
      assert.strictEqual(config.keysPresent.groq, true);
      assert.strictEqual(config.getApiKey('groq'), CANARY_GROQ);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    assert.strictEqual(fs.existsSync(tmpDir), false);
  });

  await t.test('repo gitignore rules cover .env files', () => {
    const rootGitignore = path.resolve(process.cwd(), '../../.gitignore');
    if (fs.existsSync(rootGitignore)) {
      const content = fs.readFileSync(rootGitignore, 'utf8');
      assert.ok(content.includes('.env'), 'Root .gitignore must include .env');
      assert.ok(content.includes('.env.local'), 'Root .gitignore must include .env.local');
    }
  });
});
