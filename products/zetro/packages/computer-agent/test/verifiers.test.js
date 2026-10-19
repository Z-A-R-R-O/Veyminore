import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createVerifierPort,
  verifyEditorText,
  verifyBrowserSearch,
  verifyWindowsSearch,
  verifyWhatsAppNavigation
} from '../src/verifiers.js';

describe('Independent Outcome Verifiers', () => {
  const target = {
    hwnd: 1001,
    processId: 2002
  };

  it('verifies editor text from post-observation UI text', () => {
    const postObs = {
      hwnd: 1001,
      processId: 2002,
      text: 'Prefix content... Success — Codex completed this sentence using ZETRO Computing. ...suffix'
    };

    const res = verifyEditorText({
      target,
      postObservation: postObs,
      expectedText: 'Success — Codex completed this sentence using ZETRO Computing.'
    });

    assert.strictEqual(res.verified, true);
    assert.ok(res.evidence);
    assert.strictEqual(res.evidence.type, 'editor_text_readback');
  });

  it('fails editor text verification when observed text does not match', () => {
    const postObs = {
      hwnd: 1001,
      processId: 2002,
      text: 'Completely different text'
    };

    const res = verifyEditorText({
      target,
      postObservation: postObs,
      expectedText: 'Expected sentence'
    });

    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /did not contain expected text/);
  });

  it('fails editor text verification on HWND mismatch', () => {
    const postObs = {
      hwnd: 9999, // Mismatched HWND
      processId: 2002,
      text: 'Expected sentence'
    };

    const res = verifyEditorText({
      target,
      postObservation: postObs,
      expectedText: 'Expected sentence'
    });

    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /Target HWND mismatch/);
  });

  it('verifies browser search from browser window state', () => {
    const postObs = {
      hwnd: 3001,
      processId: 4002,
      title: 'Veyminore ZETRO - Google Search',
      text: 'About 120,000 results'
    };

    const res = verifyBrowserSearch({
      target: { hwnd: 3001, processId: 4002 },
      postObservation: postObs,
      expectedQuery: 'Veyminore ZETRO'
    });

    assert.strictEqual(res.verified, true);
    assert.ok(res.evidence);
    assert.strictEqual(res.evidence.type, 'browser_search_readback');
  });

  it('verifies windows search for application', () => {
    const postObs = {
      hwnd: 5001,
      processId: 6002,
      title: 'Search - Calculator Best match',
      automation: { name: 'Calculator App' }
    };

    const res = verifyWindowsSearch({
      target: { hwnd: 5001, processId: 6002 },
      postObservation: postObs,
      targetApp: 'Calculator'
    });

    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.evidence.type, 'windows_search_readback');
  });

  it('verifies whatsapp navigation with zero messages sent', () => {
    const postObs = {
      hwnd: 7001,
      processId: 8002,
      title: 'WhatsApp - Settings'
    };

    const res = verifyWhatsAppNavigation({
      target: { hwnd: 7001, processId: 8002 },
      postObservation: postObs,
      expectedSection: 'Settings'
    });

    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.evidence.unauthorizedMessagesSent, 0);
  });
});
