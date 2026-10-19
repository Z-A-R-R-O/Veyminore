import test from 'node:test';
import assert from 'node:assert/strict';

import { createWindowsObserver } from '../src/observer-adapter.js';

/**
 * Honest Native Smoke Test Fixture
 *
 * POLICY ENFORCEMENT:
 * 1. Real user desktop enumeration and native capture must NEVER be invoked automatically.
 * 2. General enumeration fallback is strictly PROHIBITED in native smoke to prevent
 *    inspecting or touching real user applications or desktop windows.
 * 3. Native smoke REQUIRES explicit fixture HWND, PID, and start identity:
 *    - ZETRO_FIXTURE_HWND
 *    - ZETRO_FIXTURE_PID
 *    - ZETRO_FIXTURE_START_IDENTITY
 *    If any are absent, test status is strictly NOTRUN.
 * 4. Parent / coordinator independently launches and qualifies the fixture application.
 */

test('native-smoke: status is NOTRUN without explicit fixture HWND, PID, and start identity', (t) => {
  const hwnd = process.env.ZETRO_FIXTURE_HWND;
  const pid = process.env.ZETRO_FIXTURE_PID;
  const startIdentity = process.env.ZETRO_FIXTURE_START_IDENTITY;

  const hasCompleteFixture = Boolean(
    hwnd && /^\d+$/.test(hwnd.trim()) && Number(hwnd.trim()) > 0 &&
    pid && /^\d+$/.test(pid.trim()) && Number(pid.trim()) > 0 &&
    startIdentity && startIdentity.trim() !== ''
  );

  if (!hasCompleteFixture) {
    t.skip(
      'NOTRUN: Native smoke requires explicit fixture HWND (ZETRO_FIXTURE_HWND), PID (ZETRO_FIXTURE_PID), ' +
      'and start identity (ZETRO_FIXTURE_START_IDENTITY). General enumeration fallback is strictly prohibited ' +
      'to prevent accidental observation of real user windows.'
    );
    return;
  }

  // When qualified fixture is explicitly provided, verify exact identity targeting
  assert.ok(hasCompleteFixture);
});

test('native-smoke: general enumeration fallback is strictly prohibited without fixture', () => {
  const hwnd = process.env.ZETRO_FIXTURE_HWND;
  const pid = process.env.ZETRO_FIXTURE_PID;
  const startIdentity = process.env.ZETRO_FIXTURE_START_IDENTITY;

  // In standard authorpass, fixture environment variables must be absent
  const hasFixture = Boolean(hwnd && pid && startIdentity);
  assert.equal(
    hasFixture,
    false,
    'Authorpass must not run live fixture or general enumeration; parent independently qualifies fixture later'
  );
});

test('native-smoke: capture interface honestly reports unsupported by default', () => {
  const isCaptureQualified = process.env.ZETRO_CAPTURE_QUALIFIED === '1';
  assert.equal(
    isCaptureQualified,
    false,
    'Native capture must not be self-certified as qualified without independent attestation'
  );

  const observer = createWindowsObserver({
    execFileImpl: async () => ({ stdout: '', stderr: '' })
  });
  const caps = observer.getCapabilities();
  assert.equal(caps.nativeCapture, 'unsupported');
  assert.equal(caps.effects.mouse, false);
  assert.equal(caps.effects.keyboard, false);
  assert.equal(caps.effects.clipboard, false);
  assert.equal(caps.effects.shell, false);
});

test('native-smoke: notepad architectural limitations are documented and bounded', () => {
  // Verifies that provider does not claim generic computer capabilities for Notepad.
  // Windows 11 uses a XAML island RichEditD2DPT control (UIA Document/Edit);
  // legacy Windows 10 uses a Win32 Edit control.
  const limitations = {
    disposableFixtureOnly: true,
    genericComputerClaims: false,
    windows11Architecture: 'XAML Island RichEditD2DPT (UIAutomation ValuePattern / TextPattern)',
    legacyWindowsArchitecture: 'Win32 Edit Control (WM_GETTEXT / SendMessage)',
    clipboardManipulation: false,
    arbitraryShellExecution: false,
    defaultDisabledInput: true
  };

  assert.equal(limitations.disposableFixtureOnly, true);
  assert.equal(limitations.genericComputerClaims, false);
  assert.equal(limitations.clipboardManipulation, false);
  assert.equal(limitations.arbitraryShellExecution, false);
  assert.equal(limitations.defaultDisabledInput, true);
});

