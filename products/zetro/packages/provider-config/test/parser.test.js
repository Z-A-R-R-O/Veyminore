import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotEnv, parseDotEnvFile } from '../src/parser.js';

test('parseDotEnv handles synthetic .env syntax without external dependencies', async (t) => {
  await t.test('parses basic key-value pairs', () => {
    const raw = `
GROQ_API_KEY=gsk_fake_key_12345
ZETRO_MODEL_PROVIDER=groq
ZETRO_ALLOW_LIVE=1
`;
    const parsed = parseDotEnv(raw);
    assert.deepStrictEqual(parsed, {
      GROQ_API_KEY: 'gsk_fake_key_12345',
      ZETRO_MODEL_PROVIDER: 'groq',
      ZETRO_ALLOW_LIVE: '1'
    });
  });

  await t.test('handles comments and empty lines', () => {
    const raw = `
# This is a full-line comment
# Another comment

KEY_ONE=val1 # inline comment
KEY_TWO=val2

# Trailing comment
`;
    const parsed = parseDotEnv(raw);
    assert.deepStrictEqual(parsed, {
      KEY_ONE: 'val1',
      KEY_TWO: 'val2'
    });
  });

  await t.test('handles quoted strings with escaped characters', () => {
    const raw = `
DOUBLE_QUOTED="hello \\"world\\" with # hash inside"
NEWLINE_STRING="first line\\nsecond line"
SINGLE_QUOTED='single \\n quoted raw'
`;
    const parsed = parseDotEnv(raw);
    assert.strictEqual(parsed.DOUBLE_QUOTED, 'hello "world" with # hash inside');
    assert.strictEqual(parsed.NEWLINE_STRING, 'first line\nsecond line');
    assert.strictEqual(parsed.SINGLE_QUOTED, 'single \\n quoted raw');
  });

  await t.test('handles export prefix and empty values', () => {
    const raw = `
export EXPORTED_VAR=exported_val
EMPTY_VAR=
SPACED_KEY = spaced_val 
`;
    const parsed = parseDotEnv(raw);
    assert.strictEqual(parsed.EXPORTED_VAR, 'exported_val');
    assert.strictEqual(parsed.EMPTY_VAR, '');
    assert.strictEqual(parsed.SPACED_KEY, 'spaced_val');
  });

  await t.test('handles CRLF line endings (Windows portability)', () => {
    const raw = "KEY_CRLF1=val1\r\nKEY_CRLF2=val2\r\n";
    const parsed = parseDotEnv(raw);
    assert.deepStrictEqual(parsed, {
      KEY_CRLF1: 'val1',
      KEY_CRLF2: 'val2'
    });
  });
});

test('parseDotEnvFile safely reads temporary synthetic file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetro-test-env-'));
  const tmpFile = path.join(tmpDir, 'synthetic.env');

  try {
    fs.writeFileSync(tmpFile, 'SYNTHETIC_VAR=synthetic_val\n', 'utf8');
    const parsed = parseDotEnvFile(tmpFile);
    assert.strictEqual(parsed.SYNTHETIC_VAR, 'synthetic_val');

    // Non-existent file returns empty object without throwing
    const nonExistent = parseDotEnvFile(path.join(tmpDir, 'does-not-exist.env'));
    assert.deepStrictEqual(nonExistent, {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
