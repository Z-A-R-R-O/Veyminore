/**
 * @file compatibility/computer-translation.js
 * Explicit bidirectional translation contract between legacy OCR Computer contracts
 * (zetro.computer.*.alpha.v1) and versioned Protocol Computer contracts (zetro.protocol.computer_*.v1).
 *
 * Ensures 100% interoperability with existing OCR observers without native execution or sibling edits.
 */

import {
  ComputerOperation,
  ComputerActionStatus
} from '../constants.js';
import {
  createComputerActionRequest,
  validateComputerActionRequest
} from '../validators/computer-action-request.js';
import {
  createComputerActionResult,
  validateComputerActionResult
} from '../validators/computer-action-result.js';
import { computeDigest } from '../digest.js';

/**
 * Translates an OCR observe request (zetro.computer.observe_request.alpha.v1)
 * into a versioned Protocol ComputerActionRequest (zetro.protocol.computer_request.v1).
 *
 * @param {object} ocrRequest - OCR ObserveRequest object
 * @param {object} context - Execution context binding task, attempt, and window metadata
 * @param {string} [context.taskId='computer-task']
 * @param {number|string} [context.attemptId=1]
 * @param {number} [context.hwnd]
 * @param {number} [context.processId]
 * @param {number} [context.processStartTimestamp]
 * @param {string} [context.processName]
 * @param {number|string} [context.displayId]
 * @param {number} [context.dpi=96]
 * @param {string|number} [context.generation='gen-1']
 * @param {number} [context.sequence=1]
 * @param {number} [context.ttlMs=30000]
 * @returns {object} Validated Protocol ComputerActionRequest
 */
export function translateOcrObserveRequestToProtocol(ocrRequest, context = {}) {
  if (!ocrRequest || typeof ocrRequest !== 'object') {
    throw new Error('OCR observe request is required for translation');
  }

  const displayId = context.displayId ?? (ocrRequest.target?.kind === 'screen' ? Number(ocrRequest.target.targetId) : 0);
  const isScreen = ocrRequest.target?.kind === 'screen';

  const target = isScreen
    ? {
        displayId,
        dpi: context.dpi ?? 96,
        hwnd: context.hwnd ?? 0x10010,
        processId: context.processId ?? 1,
        processStartTimestamp: context.processStartTimestamp ?? ocrRequest.requestedAt,
        processName: context.processName ?? 'explorer.exe',
        generation: context.generation ?? 'gen-1'
      }
    : {
        hwnd: context.hwnd ?? Number(ocrRequest.target?.targetId || 1),
        processId: context.processId ?? 1234,
        processStartTimestamp: context.processStartTimestamp ?? ocrRequest.requestedAt,
        processName: context.processName ?? 'notepad.exe',
        displayId,
        dpi: context.dpi ?? 96,
        generation: context.generation ?? 'gen-1'
      };

  const operation = isScreen && !context.hwnd
    ? ComputerOperation.CAPTURE
    : ComputerOperation.CAPTURE;

  return createComputerActionRequest({
    requestId: ocrRequest.requestId,
    taskId: context.taskId || 'computer-task',
    attemptId: context.attemptId || 1,
    sessionId: ocrRequest.sessionId,
    principalId: ocrRequest.principalId,
    operation,
    target,
    parameters: {
      format: 'png',
      bounds: null
    },
    sequence: context.sequence || 1,
    requestedAt: ocrRequest.requestedAt,
    ttlMs: context.ttlMs || ocrRequest.freshness?.maxAgeMs || 30000,
    limits: {
      maxPayloadBytes: ocrRequest.limits?.maxPayloadBytes || 65536
    }
  });
}

/**
 * Translates a versioned Protocol ComputerActionResult (zetro.protocol.computer_result.v1)
 * into a legacy OCR ObservationResult (zetro.computer.observation_result.alpha.v1).
 *
 * @param {object} protoResult - Protocol ComputerActionResult
 * @param {object} ocrRequest - Original OCR ObserveRequest
 * @returns {object} Legacy OCR ObservationResult compatible object
 */
export function translateProtocolResultToOcrObservationResult(protoResult, ocrRequest) {
  if (!protoResult || typeof protoResult !== 'object') {
    throw new Error('Protocol result is required for translation');
  }

  const dataPayload = protoResult.payload?.data || JSON.stringify(protoResult.payload || {});
  const sha256Digest = protoResult.payload?.dataSha256 || computeDigest(dataPayload);
  const byteLength = protoResult.payload?.byteLength || Buffer.byteLength(dataPayload, 'utf8');

  return {
    schemaVersion: 'zetro.computer.observation_result.alpha.v1',
    requestId: protoResult.requestId,
    sessionId: protoResult.sessionId,
    target: {
      targetId: String(protoResult.target?.hwnd ?? protoResult.target?.displayId ?? ocrRequest?.target?.targetId ?? '0'),
      fingerprint: protoResult.target?.fingerprint ?? ocrRequest?.target?.fingerprint ?? sha256Digest
    },
    capturedAt: protoResult.executedAt,
    sequence: protoResult.sequence,
    payload: {
      sha256: sha256Digest,
      byteLength,
      mimeType: protoResult.payload?.mimeType || 'application/json'
    },
    observedBy: 'worker-ocr-adapter'
  };
}
