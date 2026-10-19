/**
 * @file action-contract.js
 * Canonical ComputerAction contract for ZETRO Universal Agent 2.0.
 *
 * This is the immutable, vendor-neutral interface between all model adapters
 * and the guarded Windows native executor. The native executor ONLY understands
 * this schema.
 */

import { randomUUID } from 'node:crypto';

export const ACTION_CONTRACT_VERSION = 'zetro.canonical_action.v1';

export const ComputerActionType = Object.freeze({
  OBSERVE: 'observe',
  CLICK: 'click',
  MOUSE_MOVE: 'mouseMove',
  DRAG: 'drag',
  TYPE_TEXT: 'typeText',
  PRESS_KEYS: 'pressKeys',
  SCROLL: 'scroll',
  WAIT: 'wait',
  REQUEST_APPROVAL: 'requestApproval',
  FINISH: 'finish'
});

export const MouseButton = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  MIDDLE: 'middle'
});

export const ClickType = Object.freeze({
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple'
});

export const RiskLevel = Object.freeze({
  BENIGN: 'benign',
  LOW: 'benign',
  REVERSIBLE_UI: 'reversible_ui',
  CONSEQUENTIAL: 'consequential',
  CRITICAL: 'critical'
});

export class ComputerActionValidationError extends Error {
  constructor(message, details = {}) {
    super(`[CanonicalActionContract] ${message}`);
    this.name = 'ComputerActionValidationError';
    this.details = details;
  }
}

/**
 * Validates a normalized ComputerAction object against the canonical contract.
 * Throws ComputerActionValidationError if malformed.
 *
 * @param {Object} action
 * @returns {Object} Validated action
 */
export function validateComputerAction(action) {
  if (!action || typeof action !== 'object') {
    throw new ComputerActionValidationError('Action must be a non-null object');
  }

  if (typeof action.type !== 'string' || !Object.values(ComputerActionType).includes(action.type)) {
    throw new ComputerActionValidationError(`Invalid or unsupported action type '${action?.type}'`, {
      supportedTypes: Object.values(ComputerActionType)
    });
  }

  // Ensure action has a valid ID
  const id = typeof action.id === 'string' && action.id.trim() !== '' ? action.id.trim() : randomUUID();

  switch (action.type) {
    case ComputerActionType.OBSERVE: {
      if (action.cropRegion) {
        validateCropRegion(action.cropRegion);
      }
      return {
        id,
        type: ComputerActionType.OBSERVE,
        displayId: action.displayId ? String(action.displayId) : undefined,
        cropRegion: action.cropRegion ? { ...action.cropRegion } : undefined,
        outputFile: typeof action.outputFile === 'string' ? action.outputFile : undefined,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.CLICK: {
      const target = validateTarget(action.target);
      const button = action.button || MouseButton.LEFT;
      if (!Object.values(MouseButton).includes(button)) {
        throw new ComputerActionValidationError(`Invalid mouse button '${button}'`, { supported: Object.values(MouseButton) });
      }
      const clickType = action.clickType || ClickType.SINGLE;
      if (!Object.values(ClickType).includes(clickType)) {
        throw new ComputerActionValidationError(`Invalid clickType '${clickType}'`, { supported: Object.values(ClickType) });
      }

      return {
        id,
        type: ComputerActionType.CLICK,
        target,
        button,
        clickType,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.MOUSE_MOVE: {
      const target = validateCoordinatePoint(action.target, 'target');
      const durationMs = typeof action.durationMs === 'number' && Number.isFinite(action.durationMs)
        ? Math.max(0, Math.min(action.durationMs, 5000))
        : 0;

      return {
        id,
        type: ComputerActionType.MOUSE_MOVE,
        target,
        durationMs,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.DRAG: {
      const start = validateCoordinatePoint(action.start, 'start');
      const end = validateCoordinatePoint(action.end, 'end');
      const durationMs = typeof action.durationMs === 'number' && Number.isFinite(action.durationMs)
        ? Math.max(100, Math.min(action.durationMs, 10000))
        : 500;

      return {
        id,
        type: ComputerActionType.DRAG,
        start,
        end,
        durationMs,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.TYPE_TEXT: {
      if (typeof action.text !== 'string' || action.text.length === 0) {
        throw new ComputerActionValidationError("Parameter 'text' for typeText action must be a non-empty string");
      }
      if (action.text.length > 4096) {
        throw new ComputerActionValidationError(`Text length (${action.text.length}) exceeds maximum allowed length of 4096 characters`);
      }
      const delayMs = typeof action.delayMs === 'number' && Number.isFinite(action.delayMs)
        ? Math.max(0, Math.min(action.delayMs, 500))
        : 0;

      return {
        id,
        type: ComputerActionType.TYPE_TEXT,
        text: action.text,
        delayMs,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.PRESS_KEYS: {
      if (!Array.isArray(action.keys) || action.keys.length === 0) {
        throw new ComputerActionValidationError("Parameter 'keys' for pressKeys action must be a non-empty array of key strings");
      }
      const validatedKeys = action.keys.map((k, idx) => {
        if (typeof k !== 'string' || k.trim() === '') {
          throw new ComputerActionValidationError(`Invalid key at index ${idx} in keys array; must be non-empty string`);
        }
        return k.trim();
      });

      return {
        id,
        type: ComputerActionType.PRESS_KEYS,
        keys: validatedKeys,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.SCROLL: {
      const deltaX = typeof action.deltaX === 'number' && Number.isFinite(action.deltaX) ? action.deltaX : 0;
      const deltaY = typeof action.deltaY === 'number' && Number.isFinite(action.deltaY) ? action.deltaY : 0;
      if (deltaX === 0 && deltaY === 0) {
        throw new ComputerActionValidationError("At least one of 'deltaX' or 'deltaY' must be non-zero for scroll action");
      }
      const anchor = action.anchor ? validateCoordinatePoint(action.anchor, 'anchor') : undefined;

      return {
        id,
        type: ComputerActionType.SCROLL,
        deltaX,
        deltaY,
        anchor,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.WAIT: {
      const durationMs = typeof action.durationMs === 'number' && Number.isFinite(action.durationMs)
        ? Math.max(50, Math.min(action.durationMs, 30000))
        : 500;
      const expectedCondition = typeof action.expectedCondition === 'string' && action.expectedCondition.trim() !== ''
        ? action.expectedCondition.trim()
        : undefined;

      return {
        id,
        type: ComputerActionType.WAIT,
        durationMs,
        expectedCondition,
        riskLevel: action.riskLevel || RiskLevel.LOW
      };
    }

    case ComputerActionType.REQUEST_APPROVAL: {
      if (typeof action.reason !== 'string' || action.reason.trim() === '') {
        throw new ComputerActionValidationError("Parameter 'reason' for requestApproval must be a non-empty string");
      }
      if (typeof action.proposedEffect !== 'string' || action.proposedEffect.trim() === '') {
        throw new ComputerActionValidationError("Parameter 'proposedEffect' for requestApproval must be a non-empty string");
      }
      const riskLevel = action.riskLevel || RiskLevel.CONSEQUENTIAL;
      if (![RiskLevel.CONSEQUENTIAL, RiskLevel.CRITICAL].includes(riskLevel)) {
        throw new ComputerActionValidationError(`Invalid riskLevel '${riskLevel}' for approval request`);
      }

      return {
        id,
        type: ComputerActionType.REQUEST_APPROVAL,
        reason: action.reason.trim(),
        proposedEffect: action.proposedEffect.trim(),
        riskLevel
      };
    }

    case ComputerActionType.FINISH: {
      return {
        id,
        type: ComputerActionType.FINISH,
        success: action.success !== false,
        summary: typeof action.summary === 'string' ? action.summary.trim() : '',
        riskLevel: RiskLevel.BENIGN
      };
    }

    default:
      throw new ComputerActionValidationError(`Unhandled action type: '${action.type}'`);
  }
}

/**
 * Validates coordinate point object { x, y } in normalized [0..1000] space or physical bounds.
 */
function validateCoordinatePoint(pt, fieldName) {
  if (!pt || typeof pt !== 'object') {
    throw new ComputerActionValidationError(`Field '${fieldName}' must be an object with numeric x and y coordinates`);
  }
  if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || pt.x < 0) {
    throw new ComputerActionValidationError(`Field '${fieldName}.x' must be a non-negative finite number`);
  }
  if (typeof pt.y !== 'number' || !Number.isFinite(pt.y) || pt.y < 0) {
    throw new ComputerActionValidationError(`Field '${fieldName}.y' must be a non-negative finite number`);
  }
  return { x: pt.x, y: pt.y };
}

/**
 * Validates target object: point, element, or window handle.
 */
function validateTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new ComputerActionValidationError("Action 'target' must be a non-null object");
  }

  const kind = target.kind || (typeof target.x === 'number' && typeof target.y === 'number' ? 'point' : undefined);
  if (!['point', 'element', 'window'].includes(kind)) {
    throw new ComputerActionValidationError(`Target kind must be 'point', 'element', or 'window', got '${kind}'`);
  }

  if (kind === 'point') {
    return {
      kind: 'point',
      ...validateCoordinatePoint(target, 'target')
    };
  }

  if (kind === 'element') {
    if (typeof target.id !== 'string' || target.id.trim() === '') {
      throw new ComputerActionValidationError("Element target requires a non-empty string 'id'");
    }
    return {
      kind: 'element',
      id: target.id.trim()
    };
  }

  if (kind === 'window') {
    if (typeof target.hwnd !== 'number' || !Number.isSafeInteger(target.hwnd) || target.hwnd <= 0) {
      throw new ComputerActionValidationError("Window target requires a positive integer 'hwnd'");
    }
    return {
      kind: 'window',
      hwnd: target.hwnd
    };
  }

  throw new ComputerActionValidationError(`Unsupported target kind '${kind}'`);
}

function validateCropRegion(region) {
  if (!region || typeof region !== 'object') {
    throw new ComputerActionValidationError("cropRegion must be a non-null object");
  }
  for (const dim of ['x', 'y', 'width', 'height']) {
    if (typeof region[dim] !== 'number' || !Number.isFinite(region[dim]) || region[dim] < 0) {
      throw new ComputerActionValidationError(`cropRegion.${dim} must be a non-negative finite number`);
    }
  }
  if (region.width === 0 || region.height === 0) {
    throw new ComputerActionValidationError("cropRegion width and height must be greater than zero");
  }
}
