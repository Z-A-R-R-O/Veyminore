import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEvent,
  isEvent,
  ValidationError,
  SCHEMA_VERSIONS,
  EventType,
  ActorRole
} from '../src/index.js';

describe('Event Schema & Validator', () => {
  const validEvent = {
    schemaVersion: SCHEMA_VERSIONS.EVENT,
    eventId: 'evt-001',
    taskId: 'task-101',
    attemptId: 1,
    type: EventType.TASK_CREATED,
    timestamp: Date.now(),
    actor: {
      principalId: 'coordinator',
      role: ActorRole.COORDINATOR
    },
    payload: {
      objective: 'Implement protocol package'
    },
    eventDigest: 'c'.repeat(64)
  };

  it('validates a well-formed event', () => {
    const res = validateEvent(validEvent);
    assert.equal(res.eventId, 'evt-001');
    assert.equal(res.type, EventType.TASK_CREATED);
    assert.equal(isEvent(validEvent), true);
  });

  it('rejects unsupported schemaVersion', () => {
    assert.throws(
      () => validateEvent({ ...validEvent, schemaVersion: 'zetro.protocol.event.v0' }),
      ValidationError
    );
  });

  it('rejects unsupported event type', () => {
    assert.throws(
      () => validateEvent({ ...validEvent, type: 'magic_teleport' }),
      ValidationError
    );
  });

  it('rejects malformed actor principal or role', () => {
    assert.throws(
      () => validateEvent({
        ...validEvent,
        actor: { principalId: '', role: ActorRole.WORKER }
      }),
      ValidationError
    );
    assert.throws(
      () => validateEvent({
        ...validEvent,
        actor: { principalId: 'p1', role: 'wizard' }
      }),
      ValidationError
    );
  });

  it('rejects non-object payload', () => {
    assert.throws(
      () => validateEvent({ ...validEvent, payload: 'not-an-object' }),
      ValidationError
    );
  });

  it('rejects invalid eventDigest format', () => {
    assert.throws(
      () => validateEvent({ ...validEvent, eventDigest: 'not-a-64-hex' }),
      ValidationError
    );
  });
});
