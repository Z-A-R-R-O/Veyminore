import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ComputerActionType,
  MouseButton,
  ClickType,
  RiskLevel,
  ComputerActionValidationError,
  validateComputerAction
} from '../src/contracts/action-contract.js';

describe('Canonical ComputerAction Contract', () => {
  it('validates a valid observe action', () => {
    const action = validateComputerAction({
      type: ComputerActionType.OBSERVE,
      displayId: 'display-0'
    });
    assert.strictEqual(action.type, 'observe');
    assert.strictEqual(action.displayId, 'display-0');
    assert.ok(action.id);
  });

  it('validates an observe action with cropRegion', () => {
    const action = validateComputerAction({
      type: ComputerActionType.OBSERVE,
      cropRegion: { x: 100, y: 100, width: 800, height: 600 }
    });
    assert.deepStrictEqual(action.cropRegion, { x: 100, y: 100, width: 800, height: 600 });
  });

  it('rejects cropRegion with zero dimensions or negative coordinates', () => {
    assert.throws(
      () => validateComputerAction({ type: 'observe', cropRegion: { x: -10, y: 0, width: 100, height: 100 } }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'observe', cropRegion: { x: 0, y: 0, width: 0, height: 100 } }),
      ComputerActionValidationError
    );
  });

  it('validates a click action with point target', () => {
    const action = validateComputerAction({
      type: ComputerActionType.CLICK,
      target: { kind: 'point', x: 450, y: 320 },
      button: MouseButton.LEFT,
      clickType: ClickType.SINGLE
    });
    assert.strictEqual(action.type, 'click');
    assert.strictEqual(action.target.kind, 'point');
    assert.strictEqual(action.target.x, 450);
    assert.strictEqual(action.target.y, 320);
    assert.strictEqual(action.button, 'left');
    assert.strictEqual(action.clickType, 'single');
  });

  it('validates a click action with element target and double click', () => {
    const action = validateComputerAction({
      type: ComputerActionType.CLICK,
      target: { kind: 'element', id: 'btn-search-12' },
      button: MouseButton.LEFT,
      clickType: ClickType.DOUBLE
    });
    assert.strictEqual(action.target.kind, 'element');
    assert.strictEqual(action.target.id, 'btn-search-12');
    assert.strictEqual(action.clickType, 'double');
  });

  it('validates a click action with window target', () => {
    const action = validateComputerAction({
      type: ComputerActionType.CLICK,
      target: { kind: 'window', hwnd: 10452 },
      button: MouseButton.RIGHT
    });
    assert.strictEqual(action.target.kind, 'window');
    assert.strictEqual(action.target.hwnd, 10452);
    assert.strictEqual(action.button, 'right');
  });

  it('rejects invalid targets', () => {
    assert.throws(
      () => validateComputerAction({ type: 'click', target: null }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'click', target: { kind: 'unknown' } }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'click', target: { kind: 'point', x: -5, y: 10 } }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'click', target: { kind: 'element', id: '' } }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'click', target: { kind: 'window', hwnd: -1 } }),
      ComputerActionValidationError
    );
  });

  it('validates mouseMove action', () => {
    const action = validateComputerAction({
      type: ComputerActionType.MOUSE_MOVE,
      target: { x: 500, y: 500 },
      durationMs: 250
    });
    assert.strictEqual(action.type, 'mouseMove');
    assert.strictEqual(action.target.x, 500);
    assert.strictEqual(action.durationMs, 250);
  });

  it('validates drag action', () => {
    const action = validateComputerAction({
      type: ComputerActionType.DRAG,
      start: { x: 100, y: 100 },
      end: { x: 500, y: 400 },
      durationMs: 800
    });
    assert.strictEqual(action.type, 'drag');
    assert.deepStrictEqual(action.start, { x: 100, y: 100 });
    assert.deepStrictEqual(action.end, { x: 500, y: 400 });
    assert.strictEqual(action.durationMs, 800);
  });

  it('validates typeText action and enforces bounds', () => {
    const action = validateComputerAction({
      type: ComputerActionType.TYPE_TEXT,
      text: 'Hello ZETRO!',
      delayMs: 20
    });
    assert.strictEqual(action.type, 'typeText');
    assert.strictEqual(action.text, 'Hello ZETRO!');
    assert.strictEqual(action.delayMs, 20);

    // Empty text rejected
    assert.throws(
      () => validateComputerAction({ type: 'typeText', text: '' }),
      ComputerActionValidationError
    );

    // Oversized text rejected (>4096)
    assert.throws(
      () => validateComputerAction({ type: 'typeText', text: 'a'.repeat(4097) }),
      ComputerActionValidationError
    );
  });

  it('validates pressKeys action and key array', () => {
    const action = validateComputerAction({
      type: ComputerActionType.PRESS_KEYS,
      keys: ['Control', 'Shift', 'N']
    });
    assert.strictEqual(action.type, 'pressKeys');
    assert.deepStrictEqual(action.keys, ['Control', 'Shift', 'N']);

    // Empty array rejected
    assert.throws(
      () => validateComputerAction({ type: 'pressKeys', keys: [] }),
      ComputerActionValidationError
    );
    // Non-string key rejected
    assert.throws(
      () => validateComputerAction({ type: 'pressKeys', keys: ['Ctrl', 123] }),
      ComputerActionValidationError
    );
  });

  it('validates scroll action with deltas', () => {
    const action = validateComputerAction({
      type: ComputerActionType.SCROLL,
      deltaX: 0,
      deltaY: -120,
      anchor: { x: 500, y: 300 }
    });
    assert.strictEqual(action.type, 'scroll');
    assert.strictEqual(action.deltaY, -120);
    assert.deepStrictEqual(action.anchor, { x: 500, y: 300 });

    // Both delta zero rejected
    assert.throws(
      () => validateComputerAction({ type: 'scroll', deltaX: 0, deltaY: 0 }),
      ComputerActionValidationError
    );
  });

  it('validates wait action with bounds', () => {
    const action = validateComputerAction({
      type: ComputerActionType.WAIT,
      durationMs: 2000,
      expectedCondition: 'window_focused'
    });
    assert.strictEqual(action.type, 'wait');
    assert.strictEqual(action.durationMs, 2000);
    assert.strictEqual(action.expectedCondition, 'window_focused');
  });

  it('validates requestApproval action for consequential actions', () => {
    const action = validateComputerAction({
      type: ComputerActionType.REQUEST_APPROVAL,
      reason: 'Creating folder on filesystem modifies disk state',
      proposedEffect: 'create_directory(C:\\Users\\Downloads\\Hello)',
      riskLevel: RiskLevel.CONSEQUENTIAL
    });
    assert.strictEqual(action.type, 'requestApproval');
    assert.strictEqual(action.riskLevel, 'consequential');
    assert.ok(action.reason.includes('Creating folder'));

    // Missing reason or effect rejected
    assert.throws(
      () => validateComputerAction({ type: 'requestApproval', reason: '', proposedEffect: 'something' }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction({ type: 'requestApproval', reason: 'reason', proposedEffect: '' }),
      ComputerActionValidationError
    );
  });

  it('rejects unknown action types', () => {
    assert.throws(
      () => validateComputerAction({ type: 'format_hard_drive' }),
      ComputerActionValidationError
    );
    assert.throws(
      () => validateComputerAction(null),
      ComputerActionValidationError
    );
  });
});
