/**
 * @file test/intent-status.test.js
 * Test suite for privacy-conscious deterministic intent-status phrase model.
 *
 * Covers:
 * 1. Supported operations (create_folder, open_app, search, move_pointer) across all phases.
 * 2. Exact contract example verification (create_folder with hello and Downloads).
 * 3. Strict literal boolean gating (allowDisplayLabels === true required).
 * 4. Label sanitization & malicious input rejection (controls, paths, URLs, queries, scripts, sensitive tokens).
 * 5. Bounded output lengths and character constraints.
 * 6. Fallback to existing activityLabel for unknown operations, invalid intents, and unrecognized phases.
 * 7. Privacy preservation: zero query or typed-text leakage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntentStatus,
  sanitizeLabel,
  SUPPORTED_INTENT_OPERATIONS,
  INTENT_PHASES
} from '../src/intent-status.js';
import { activityLabel } from '../src/activity-label.js';

describe('Privacy-Conscious Intent Status Model (intent-status.js)', () => {
  describe('1. Exact Shared Contract Specification Examples', () => {
    it('generates exact required phrases for create_folder with approved labels', () => {
      const intentStatus = createIntentStatus({
        operation: 'create_folder',
        targetLabel: 'hello',
        destinationLabel: 'Downloads',
        allowDisplayLabels: true
      });

      assert.deepEqual(intentStatus.describe('intention'), {
        phase: 'intention',
        text: "I'll create \u2018hello\u2019 in Downloads."
      });
      assert.deepEqual(intentStatus.describe('observing'), {
        phase: 'observing',
        text: 'Finding Downloads\u2026'
      });
      assert.deepEqual(intentStatus.describe('thinking'), {
        phase: 'thinking',
        text: 'Planning folder creation\u2026'
      });
      assert.deepEqual(intentStatus.describe('acting'), {
        phase: 'acting',
        text: 'Creating \u2018hello\u2019\u2026'
      });
      assert.deepEqual(intentStatus.describe('checking'), {
        phase: 'checking',
        text: 'Checking the folder\u2026'
      });
      assert.deepEqual(intentStatus.describe('completed'), {
        phase: 'completed',
        text: '\u2018hello\u2019 is ready.'
      });
      assert.deepEqual(intentStatus.describe('blocked'), {
        phase: 'blocked',
        text: 'Folder creation needs attention'
      });
      assert.deepEqual(intentStatus.describe('failed'), {
        phase: 'failed',
        text: 'Unable to create folder'
      });
      assert.deepEqual(intentStatus.describe('uncertain'), {
        phase: 'uncertain',
        text: 'Folder creation uncertain'
      });
      assert.deepEqual(intentStatus.describe('cancelled'), {
        phase: 'cancelled',
        text: 'Folder creation cancelled'
      });
      assert.deepEqual(intentStatus.describe('stopped'), {
        phase: 'stopped',
        text: 'Folder creation stopped'
      });
    });

    it('generates single-label create_folder phrases when destination is absent', () => {
      const intentStatus = createIntentStatus({
        operation: 'create_folder',
        targetLabel: 'Projects',
        allowDisplayLabels: true
      });

      assert.equal(intentStatus.describe('intention').text, "I'll create \u2018Projects\u2019.");
      assert.equal(intentStatus.describe('observing').text, 'Finding destination\u2026');
      assert.equal(intentStatus.describe('acting').text, 'Creating \u2018Projects\u2019\u2026');
      assert.equal(intentStatus.describe('completed').text, '\u2018Projects\u2019 is ready.');
    });
  });

  describe('2. Supported Operations Across Phases', () => {
    it('handles open_app with approved application label', () => {
      const intentStatus = createIntentStatus({
        operation: 'open_app',
        application: 'Notepad',
        allowDisplayLabels: true
      });

      assert.equal(intentStatus.describe('intention').text, "I'll open Notepad.");
      assert.equal(intentStatus.describe('observing').text, 'Finding Notepad\u2026');
      assert.equal(intentStatus.describe('acting').text, 'Opening Notepad\u2026');
      assert.equal(intentStatus.describe('checking').text, 'Checking Notepad\u2026');
      assert.equal(intentStatus.describe('completed').text, 'Notepad is ready.');
      assert.equal(intentStatus.describe('failed').text, 'Unable to open application');
    });

    it('handles search with approved application label', () => {
      const intentStatus = createIntentStatus({
        operation: 'search',
        application: 'Google Chrome',
        allowDisplayLabels: true
      });

      assert.equal(intentStatus.describe('intention').text, "I'll search in Google Chrome.");
      assert.equal(intentStatus.describe('observing').text, 'Finding Google Chrome\u2026');
      assert.equal(intentStatus.describe('acting').text, 'Searching in Google Chrome\u2026');
      assert.equal(intentStatus.describe('checking').text, 'Checking search results\u2026');
      assert.equal(intentStatus.describe('completed').text, 'Search completed.');
    });

    it('handles move_pointer with approved target label', () => {
      const intentStatus = createIntentStatus({
        operation: 'move_pointer',
        targetLabel: 'Submit Button',
        allowDisplayLabels: true
      });

      assert.equal(intentStatus.describe('intention').text, "I'll move pointer to \u2018Submit Button\u2019.");
      assert.equal(intentStatus.describe('observing').text, 'Locating \u2018Submit Button\u2019\u2026');
      assert.equal(intentStatus.describe('acting').text, 'Moving pointer to \u2018Submit Button\u2019\u2026');
      assert.equal(intentStatus.describe('checking').text, 'Checking pointer position\u2026');
      assert.equal(intentStatus.describe('completed').text, 'Pointer moved.');
    });
  });

  describe('3. Strict Literal Boolean allowDisplayLabels Gating', () => {
    it('suppresses all labels when allowDisplayLabels is false', () => {
      const intentStatus = createIntentStatus({
        operation: 'create_folder',
        targetLabel: 'hello',
        destinationLabel: 'Downloads',
        allowDisplayLabels: false
      });

      assert.equal(intentStatus.describe('intention').text, "I'll create the folder.");
      assert.equal(intentStatus.describe('observing').text, 'Finding destination\u2026');
      assert.equal(intentStatus.describe('acting').text, 'Creating folder\u2026');
      assert.equal(intentStatus.describe('completed').text, 'Folder is ready.');
    });

    it('suppresses all labels when allowDisplayLabels is omitted or undefined', () => {
      const intentStatus = createIntentStatus({
        operation: 'open_app',
        application: 'Notepad'
      });

      assert.equal(intentStatus.describe('intention').text, "I'll open the application.");
      assert.equal(intentStatus.describe('acting').text, 'Opening application\u2026');
      assert.equal(intentStatus.describe('completed').text, 'Application is ready.');
    });

    it('rejects non-boolean truthy values for allowDisplayLabels (defense against truthy coercion)', () => {
      const truthyCases = ['true', 1, {}, [], () => true, 'yes'];

      for (const nonBool of truthyCases) {
        const intentStatus = createIntentStatus({
          operation: 'create_folder',
          targetLabel: 'hello',
          destinationLabel: 'Downloads',
          allowDisplayLabels: nonBool
        });

        const res = intentStatus.describe('intention');
        assert.equal(
          res.text,
          "I'll create the folder.",
          `Failed to suppress label for non-boolean allowDisplayLabels: ${JSON.stringify(nonBool)}`
        );
      }
    });
  });

  describe('4. Label Sanitization & Security Boundary', () => {
    it('sanitizes clean alphanumeric strings with spaces, hyphens, and underscores', () => {
      assert.equal(sanitizeLabel('Documents'), 'Documents');
      assert.equal(sanitizeLabel('My Project'), 'My Project');
      assert.equal(sanitizeLabel('folder-01'), 'folder-01');
      assert.equal(sanitizeLabel('archive_2026'), 'archive_2026');
    });

    it('rejects control characters, newlines, and ANSI escapes', () => {
      assert.equal(sanitizeLabel('hello\x00world'), null);
      assert.equal(sanitizeLabel('hello\r\nworld'), null);
      assert.equal(sanitizeLabel('hello\tworld'), null);
      assert.equal(sanitizeLabel('\x1b[31mRed\x1b[0m'), null);
    });

    it('rejects file paths and path traversal attempts', () => {
      assert.equal(sanitizeLabel('C:\\Windows\\System32'), null);
      assert.equal(sanitizeLabel('/etc/passwd'), null);
      assert.equal(sanitizeLabel('../secrets'), null);
      assert.equal(sanitizeLabel('..\\secret'), null);
      assert.equal(sanitizeLabel('foo/bar'), null);
    });

    it('rejects URLs and network endpoints', () => {
      assert.equal(sanitizeLabel('https://evil.com'), null);
      assert.equal(sanitizeLabel('http://localhost:3000'), null);
      assert.equal(sanitizeLabel('ftp://server/file'), null);
      assert.equal(sanitizeLabel('file:///c:/test'), null);
    });

    it('rejects query strings, shell operators, and code injection characters', () => {
      assert.equal(sanitizeLabel('?q=search'), null);
      assert.equal(sanitizeLabel('user=admin&pwd=secret'), null);
      assert.equal(sanitizeLabel('<script>alert(1)</script>'), null);
      assert.equal(sanitizeLabel('hello; rm -rf /'), null);
      assert.equal(sanitizeLabel('hello | cat'), null);
      assert.equal(sanitizeLabel('hello `whoami`'), null);
      assert.equal(sanitizeLabel('hello $(id)'), null);
      assert.equal(sanitizeLabel("hello 'world'"), null);
      assert.equal(sanitizeLabel('hello "world"'), null);
    });

    it('rejects sensitive token and credential keywords', () => {
      assert.equal(sanitizeLabel('password'), null);
      assert.equal(sanitizeLabel('secret_token'), null);
      assert.equal(sanitizeLabel('api_key'), null);
      assert.equal(sanitizeLabel('bearer'), null);
      assert.equal(sanitizeLabel('credential'), null);
    });

    it('rejects non-string types, empty strings, and strings exceeding max length (40 chars)', () => {
      assert.equal(sanitizeLabel(null), null);
      assert.equal(sanitizeLabel(undefined), null);
      assert.equal(sanitizeLabel(12345), null);
      assert.equal(sanitizeLabel({}), null);
      assert.equal(sanitizeLabel([]), null);
      assert.equal(sanitizeLabel(''), null);
      assert.equal(sanitizeLabel('   '), null);
      assert.equal(sanitizeLabel('a'.repeat(41)), null);
      assert.equal(sanitizeLabel('a'.repeat(40)), 'a'.repeat(40));
    });
  });

  describe('5. Fallback Behavior to activityLabel', () => {
    it('falls back to activityLabel when intent is null or non-object', () => {
      const nullStatus = createIntentStatus(null);
      assert.deepEqual(nullStatus.describe('observing'), activityLabel('observing'));
      assert.deepEqual(nullStatus.describe('acting', 'click'), activityLabel('acting', 'click'));

      const nonObjStatus = createIntentStatus('string-intent');
      assert.deepEqual(nonObjStatus.describe('thinking'), activityLabel('thinking'));
    });

    it('falls back to activityLabel when operation is unknown or unsupported', () => {
      const unknownStatus = createIntentStatus({ operation: 'unknown' });
      assert.deepEqual(unknownStatus.describe('observing'), activityLabel('observing'));

      const unsupportedStatus = createIntentStatus({ operation: 'unsupported_op' });
      assert.deepEqual(unsupportedStatus.describe('checking'), activityLabel('checking'));
    });

    it('falls back to activityLabel for phases outside the intent model', () => {
      const intentStatus = createIntentStatus({
        operation: 'create_folder',
        targetLabel: 'hello',
        allowDisplayLabels: true
      });

      assert.deepEqual(intentStatus.describe('paused'), activityLabel('paused'));
      assert.deepEqual(intentStatus.describe('disconnected'), activityLabel('disconnected'));
      assert.deepEqual(intentStatus.describe('requesting_control'), activityLabel('requesting_control'));
      assert.deepEqual(intentStatus.describe('expired'), activityLabel('expired'));
    });
  });

  describe('6. Zero Prompt and Private Data Leakage', () => {
    it('never leaks raw prompt strings or typed text into status outputs', () => {
      const maliciousPromptIntent = {
        operation: 'search',
        application: 'Chrome',
        query: 'confidential corporate acquisition memo 2026',
        prompt: 'Search for confidential acquisition memo on Chrome',
        typedText: 'confidential_password_123',
        allowDisplayLabels: true
      };

      const intentStatus = createIntentStatus(maliciousPromptIntent);

      for (const phase of INTENT_PHASES) {
        const { text } = intentStatus.describe(phase);
        assert.ok(!text.includes('confidential'), `Leaked confidential in phase: ${phase}`);
        assert.ok(!text.includes('acquisition'), `Leaked acquisition in phase: ${phase}`);
        assert.ok(!text.includes('password'), `Leaked password in phase: ${phase}`);
      }
    });

    it('never leaks path or query parameters into generic search status', () => {
      const intentStatus = createIntentStatus({
        operation: 'search',
        query: 'C:\\Users\\admin\\passwords.txt',
        allowDisplayLabels: true
      });

      for (const phase of INTENT_PHASES) {
        const { text } = intentStatus.describe(phase);
        assert.ok(!text.includes('C:'), `Leaked drive in phase: ${phase}`);
        assert.ok(!text.includes('passwords'), `Leaked passwords in phase: ${phase}`);
      }
    });
  });

  describe('7. Output Bounds and Immutability', () => {
    it('produces bounded length status text across all operations and phases (< 120 chars)', () => {
      for (const op of SUPPORTED_INTENT_OPERATIONS) {
        const statusWithLabels = createIntentStatus({
          operation: op,
          targetLabel: 'a'.repeat(40),
          destinationLabel: 'b'.repeat(40),
          application: 'c'.repeat(40),
          allowDisplayLabels: true
        });

        const statusWithoutLabels = createIntentStatus({
          operation: op,
          allowDisplayLabels: false
        });

        for (const phase of INTENT_PHASES) {
          const res1 = statusWithLabels.describe(phase);
          assert.ok(typeof res1.phase === 'string');
          assert.ok(typeof res1.text === 'string');
          assert.ok(res1.text.length < 120, `Text too long: ${res1.text.length} for ${op}/${phase}`);

          const res2 = statusWithoutLabels.describe(phase);
          assert.ok(typeof res2.phase === 'string');
          assert.ok(typeof res2.text === 'string');
          assert.ok(res2.text.length < 120, `Text too long: ${res2.text.length} for ${op}/${phase}`);
        }
      }
    });
  });
});
