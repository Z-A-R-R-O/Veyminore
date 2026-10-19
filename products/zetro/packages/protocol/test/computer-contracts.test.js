import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSIONS,
  ComputerOperation,
  ComputerActionStatus,
  COMPUTER_PAYLOAD_BOUNDS,
  validateComputerActionRequest,
  createComputerActionRequest,
  validateComputerActionResult,
  createComputerActionResult,
  translateOcrObserveRequestToProtocol,
  translateProtocolResultToOcrObservationResult,
  ValidationError
} from '../src/index.js';

describe('Native Computer Protocol Contracts (zetro.protocol.computer_*.v1)', () => {
  const baseTarget = {
    hwnd: 123456,
    processId: 7890,
    processStartTimestamp: 1713000000000,
    processName: 'notepad.exe',
    displayId: 0,
    dpi: 96,
    generation: 'gen-001'
  };

  describe('createComputerActionRequest & validateComputerActionRequest', () => {
    it('creates and validates an ENUMERATE request', () => {
      const req = createComputerActionRequest({
        taskId: 'task-comp-01',
        attemptId: 1,
        sessionId: 'session-comp-01',
        principalId: 'worker-notepad',
        operation: ComputerOperation.ENUMERATE,
        target: { displayId: 0, dpi: 96 },
        parameters: {}
      });

      assert.equal(req.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST);
      assert.equal(req.operation, ComputerOperation.ENUMERATE);
      assert.equal(req.target.displayId, 0);
      assert.equal(req.target.dpi, 96);
      assert.equal(req.sequence, 1);
      assert.equal(typeof req.requestDigest, 'string');
      assert.equal(req.requestDigest.length, 64);
      assert.ok(Object.isFrozen(req));
      assert.ok(Object.isFrozen(req.target));
      assert.ok(Object.isFrozen(req.parameters));
    });

    it('creates and validates an INSPECT request', () => {
      const req = createComputerActionRequest({
        taskId: 'task-comp-02',
        attemptId: 1,
        sessionId: 'session-comp-02',
        principalId: 'worker-notepad',
        operation: ComputerOperation.INSPECT,
        target: baseTarget,
        parameters: { detailLevel: 'full' }
      });

      assert.equal(req.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST);
      assert.equal(req.operation, ComputerOperation.INSPECT);
      assert.equal(req.target.hwnd, 123456);
      assert.equal(req.target.processName, 'notepad.exe');
      assert.equal(req.target.generation, 'gen-001');
      assert.equal(req.sequence, 1);
      assert.equal(req.requestDigest.length, 64);
    });

    it('creates and validates a CAPTURE request with bounds and format', () => {
      const req = createComputerActionRequest({
        taskId: 'task-comp-03',
        attemptId: 1,
        sessionId: 'session-comp-03',
        principalId: 'worker-notepad',
        operation: ComputerOperation.CAPTURE,
        target: baseTarget,
        parameters: {
          format: 'png',
          bounds: { x: 10, y: 20, width: 800, height: 600 }
        },
        sequence: 2,
        ttlMs: 45000,
        limits: { maxPayloadBytes: 262144 }
      });

      assert.equal(req.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST);
      assert.equal(req.operation, ComputerOperation.CAPTURE);
      assert.equal(req.sequence, 2);
      assert.equal(req.limits.maxPayloadBytes, 262144);
      assert.ok(req.expiresAt > req.requestedAt);
      assert.equal(req.requestDigest.length, 64);
    });

    it('creates and validates all proposed input actions with valid parameters', () => {
      // MOVE
      const moveReq = createComputerActionRequest({
        taskId: 'task-input',
        attemptId: 1,
        sessionId: 'session-input',
        principalId: 'worker-input',
        operation: ComputerOperation.MOVE,
        target: baseTarget,
        parameters: { x: 150, y: 300 }
      });
      assert.equal(moveReq.operation, ComputerOperation.MOVE);
      assert.equal(moveReq.parameters.x, 150);
      assert.equal(moveReq.parameters.y, 300);

      // CLICK
      const clickReq = createComputerActionRequest({
        taskId: 'task-input',
        attemptId: 1,
        sessionId: 'session-input',
        principalId: 'worker-input',
        operation: ComputerOperation.CLICK,
        target: baseTarget,
        parameters: { button: 'left' }
      });
      assert.equal(clickReq.operation, ComputerOperation.CLICK);
      assert.equal(clickReq.parameters.button, 'left');

      // SCROLL
      const scrollReq = createComputerActionRequest({
        taskId: 'task-input',
        attemptId: 1,
        sessionId: 'session-input',
        principalId: 'worker-input',
        operation: ComputerOperation.SCROLL,
        target: baseTarget,
        parameters: { deltaX: 0, deltaY: -120 }
      });
      assert.equal(scrollReq.operation, ComputerOperation.SCROLL);
      assert.equal(scrollReq.parameters.deltaY, -120);

      // KEY
      const keyReq = createComputerActionRequest({
        taskId: 'task-input',
        attemptId: 1,
        sessionId: 'session-input',
        principalId: 'worker-input',
        operation: ComputerOperation.KEY,
        target: baseTarget,
        parameters: { key: 'Enter' }
      });
      assert.equal(keyReq.operation, ComputerOperation.KEY);
      assert.equal(keyReq.parameters.key, 'Enter');

      // TEXT
      const textReq = createComputerActionRequest({
        taskId: 'task-input',
        attemptId: 1,
        sessionId: 'session-input',
        principalId: 'worker-input',
        operation: ComputerOperation.TEXT,
        target: baseTarget,
        parameters: { text: 'Hello, World!' }
      });
      assert.equal(textReq.operation, ComputerOperation.TEXT);
      assert.equal(textReq.parameters.text, 'Hello, World!');
    });
  });

  describe('validateComputerActionRequest - Negative Tests & Fail-Closed Boundaries', () => {
    it('rejects non-object or null input', () => {
      assert.throws(
        () => validateComputerActionRequest(null),
        (err) => err instanceof ValidationError && err.message.includes('non-null object')
      );
      assert.throws(
        () => validateComputerActionRequest('string-input'),
        (err) => err instanceof ValidationError && err.message.includes('non-null object')
      );
    });

    it('rejects invalid schemaVersion', () => {
      assert.throws(
        () => validateComputerActionRequest({
          schemaVersion: 'zetro.protocol.computer_request.v99',
          requestId: 'req-inv-schema',
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: baseTarget,
          parameters: {},
          sequence: 1,
          requestedAt: Date.now(),
          expiresAt: Date.now() + 10000,
          limits: { maxPayloadBytes: 65536 },
          requestDigest: 'a'.repeat(64)
        }),
        (err) => err instanceof ValidationError && err.message.includes('schemaVersion')
      );
    });

    it('rejects malformed target identity: invalid HWND', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, hwnd: -1 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.hwnd')
      );
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, hwnd: 0 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.hwnd')
      );
    });

    it('rejects malformed target identity: invalid PID and processStartTimestamp', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, processId: 0 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.processId')
      );

      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, processStartTimestamp: -100 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.processStartTimestamp')
      );
    });

    it('rejects malformed target identity: empty processName or generation', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, processName: '' }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.processName')
      );

      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, generation: '' }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.generation')
      );
    });

    it('rejects out of bounds DPI (< 48 or > 960)', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, dpi: 24 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.dpi')
      );

      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: { ...baseTarget, dpi: 1200 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('target.dpi')
      );
    });

    it('rejects non-positive sequence numbers (sequence < 1)', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: baseTarget,
          sequence: 0
        }),
        (err) => err instanceof ValidationError && err.message.includes('sequence')
      );
    });

    it('rejects invalid timestamp order (expiresAt <= requestedAt)', () => {
      const now = Date.now();
      assert.throws(
        () => validateComputerActionRequest({
          schemaVersion: SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST,
          requestId: 'req-ts-01',
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.INSPECT,
          target: baseTarget,
          parameters: {},
          sequence: 1,
          requestedAt: now,
          expiresAt: now - 1000,
          limits: { maxPayloadBytes: 65536 },
          requestDigest: 'a'.repeat(64)
        }),
        (err) => err instanceof ValidationError && err.message.includes('expiresAt')
      );
    });

    it('rejects limits outside bounds (< 1 or > 1048576)', () => {
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.CAPTURE,
          target: baseTarget,
          limits: { maxPayloadBytes: 0 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('limits.maxPayloadBytes')
      );

      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.CAPTURE,
          target: baseTarget,
          limits: { maxPayloadBytes: 2000000 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('limits.maxPayloadBytes')
      );
    });

    it('rejects invalid action parameters for proposed input operations', () => {
      // MOVE missing y
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.MOVE,
          target: baseTarget,
          parameters: { x: 100 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('parameters.y')
      );

      // CLICK invalid button
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.CLICK,
          target: baseTarget,
          parameters: { button: 'invalid_btn' }
        }),
        (err) => err instanceof ValidationError && err.message.includes('parameters.button')
      );

      // SCROLL non-finite
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.SCROLL,
          target: baseTarget,
          parameters: { deltaX: 'not-a-number', deltaY: 0 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('parameters.deltaX')
      );

      // KEY non-string or empty
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.KEY,
          target: baseTarget,
          parameters: { key: '' }
        }),
        (err) => err instanceof ValidationError && err.message.includes('parameters.key')
      );

      // TEXT non-string
      assert.throws(
        () => createComputerActionRequest({
          taskId: 't1',
          attemptId: 1,
          sessionId: 's1',
          principalId: 'p1',
          operation: ComputerOperation.TEXT,
          target: baseTarget,
          parameters: { text: 12345 }
        }),
        (err) => err instanceof ValidationError && err.message.includes('parameters.text')
      );
    });

    it('detects request parameter tampering when verifyDigest=true', () => {
      const validReq = createComputerActionRequest({
        taskId: 't-tamper',
        attemptId: 1,
        sessionId: 's-tamper',
        principalId: 'p-tamper',
        operation: ComputerOperation.CAPTURE,
        target: baseTarget,
        parameters: { format: 'png' }
      });

      // Tamper parameters
      const tampered = {
        ...validReq,
        parameters: { format: 'jpeg' }
      };

      assert.throws(
        () => validateComputerActionRequest(tampered, { verifyDigest: true }),
        (err) => err instanceof ValidationError && err.message.includes('requestDigest mismatch')
      );
    });
  });

  describe('createComputerActionResult & validateComputerActionResult', () => {
    it('creates and validates a successful ComputerActionResult', () => {
      const res = createComputerActionResult({
        requestId: 'req-comp-res-01',
        sessionId: 'session-res-01',
        operation: ComputerOperation.CAPTURE,
        status: ComputerActionStatus.SUCCESS,
        target: baseTarget,
        sequence: 1,
        payload: {
          mimeType: 'image/png',
          byteLength: 4096,
          dataSha256: 'b'.repeat(64)
        }
      });

      assert.equal(res.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_RESULT);
      assert.equal(res.status, ComputerActionStatus.SUCCESS);
      assert.equal(res.operation, ComputerOperation.CAPTURE);
      assert.equal(res.sequence, 1);
      assert.equal(res.resultDigest.length, 64);
      assert.ok(Object.isFrozen(res));
      assert.ok(Object.isFrozen(res.payload));
    });

    it('creates and validates a failed ComputerActionResult with reason', () => {
      const res = createComputerActionResult({
        requestId: 'req-comp-res-02',
        sessionId: 'session-res-02',
        operation: ComputerOperation.INSPECT,
        status: ComputerActionStatus.FAILED,
        reason: 'target_window_closed',
        target: baseTarget,
        sequence: 2,
        payload: { error: 'HWND not found' }
      });

      assert.equal(res.status, ComputerActionStatus.FAILED);
      assert.equal(res.reason, 'target_window_closed');
      assert.equal(res.resultDigest.length, 64);
    });

    it('rejects tampered resultDigest when verifyDigest=true', () => {
      const res = createComputerActionResult({
        requestId: 'req-comp-res-03',
        sessionId: 'session-res-03',
        operation: ComputerOperation.ENUMERATE,
        status: ComputerActionStatus.SUCCESS,
        target: { displayId: 0 },
        payload: { windows: [] }
      });

      const tampered = {
        ...res,
        payload: { windows: [{ hwnd: 999 }] }
      };

      assert.throws(
        () => validateComputerActionResult(tampered, { verifyDigest: true }),
        (err) => err instanceof ValidationError && err.message.includes('resultDigest mismatch')
      );
    });
  });

  describe('Bidirectional Translation Contract (OCR <-> Protocol)', () => {
    it('translates legacy OCR window observe request to protocol ComputerActionRequest', () => {
      const legacyOcrRequest = {
        schemaVersion: 'zetro.computer.observe_request.alpha.v1',
        requestId: 'req-ocr-001',
        sessionId: 'session-ocr-001',
        principalId: 'worker-ocr',
        target: {
          kind: 'window',
          targetId: '54321'
        },
        requestedAt: 1713000000000,
        freshness: { maxAgeMs: 15000 },
        limits: { maxPayloadBytes: 131072 }
      };

      const protoReq = translateOcrObserveRequestToProtocol(legacyOcrRequest, {
        taskId: 'task-ocr-trans',
        attemptId: 2,
        processId: 9999,
        processName: 'notepad.exe',
        processStartTimestamp: 1712999000000,
        generation: 'gen-42',
        dpi: 144
      });

      assert.equal(protoReq.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST);
      assert.equal(protoReq.requestId, 'req-ocr-001');
      assert.equal(protoReq.sessionId, 'session-ocr-001');
      assert.equal(protoReq.principalId, 'worker-ocr');
      assert.equal(protoReq.operation, ComputerOperation.CAPTURE);
      assert.equal(protoReq.target.hwnd, 54321);
      assert.equal(protoReq.target.processId, 9999);
      assert.equal(protoReq.target.processName, 'notepad.exe');
      assert.equal(protoReq.target.generation, 'gen-42');
      assert.equal(protoReq.target.dpi, 144);
      assert.equal(protoReq.limits.maxPayloadBytes, 131072);
      assert.equal(protoReq.requestDigest.length, 64);
    });

    it('translates legacy OCR screen observe request to protocol ComputerActionRequest', () => {
      const legacyScreenReq = {
        schemaVersion: 'zetro.computer.observe_request.alpha.v1',
        requestId: 'req-ocr-screen',
        sessionId: 'session-ocr-screen',
        principalId: 'worker-ocr',
        target: {
          kind: 'screen',
          targetId: '0'
        },
        requestedAt: 1713000000000,
        freshness: { maxAgeMs: 30000 }
      };

      const protoReq = translateOcrObserveRequestToProtocol(legacyScreenReq, {
        taskId: 'task-screen-trans',
        attemptId: 1
      });

      assert.equal(protoReq.schemaVersion, SCHEMA_VERSIONS.COMPUTER_ACTION_REQUEST);
      assert.equal(protoReq.operation, ComputerOperation.CAPTURE);
      assert.equal(protoReq.target.displayId, 0);
      assert.equal(protoReq.requestDigest.length, 64);
    });

    it('translates protocol ComputerActionResult back to legacy OCR ObservationResult', () => {
      const protoRes = createComputerActionResult({
        requestId: 'req-proto-001',
        sessionId: 'session-proto-001',
        operation: ComputerOperation.CAPTURE,
        status: ComputerActionStatus.SUCCESS,
        target: baseTarget,
        sequence: 3,
        payload: {
          mimeType: 'image/png',
          byteLength: 2048,
          dataSha256: 'c'.repeat(64),
          data: 'base64-data-simulated'
        }
      });

      const ocrRes = translateProtocolResultToOcrObservationResult(protoRes, {
        target: { targetId: '123456', fingerprint: 'fp-123456' }
      });

      assert.equal(ocrRes.schemaVersion, 'zetro.computer.observation_result.alpha.v1');
      assert.equal(ocrRes.requestId, 'req-proto-001');
      assert.equal(ocrRes.sessionId, 'session-proto-001');
      assert.equal(ocrRes.target.targetId, '123456');
      assert.equal(ocrRes.sequence, 3);
      assert.equal(ocrRes.payload.sha256, 'c'.repeat(64));
      assert.equal(ocrRes.payload.byteLength, 2048);
      assert.equal(ocrRes.payload.mimeType, 'image/png');
      assert.equal(ocrRes.observedBy, 'worker-ocr-adapter');
    });

    it('throws when translation inputs are null or non-objects', () => {
      assert.throws(
        () => translateOcrObserveRequestToProtocol(null),
        /OCR observe request is required for translation/
      );
      assert.throws(
        () => translateProtocolResultToOcrObservationResult(null),
        /Protocol result is required for translation/
      );
    });
  });
});
