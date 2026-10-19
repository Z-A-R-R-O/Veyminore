import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAssignment,
  isAssignment,
  ValidationError,
  SCHEMA_VERSIONS,
  CheckType,
  DataClassification
} from '../src/index.js';

describe('Assignment Schema & Validator', () => {
  const validAssignment = {
    schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
    taskId: 'task-101',
    attemptId: 1,
    agentId: 'AGR-1',
    objective: 'Implement protocol package for ZETRO',
    acceptance: ['Code exists in packages/protocol', 'Deterministic tests pass'],
    scope: {
      root: 'E:/Veyminore/products/zetro',
      readPaths: ['packages/protocol/src/index.js'],
      writePaths: ['packages/protocol/src/index.js'],
      createPaths: ['packages/protocol/src/new-file.js'],
      sourceHashes: {
        'packages/protocol/src/index.js': 'a'.repeat(64)
      }
    },
    checks: [
      {
        type: CheckType.EQUALS,
        path: 'packages/protocol/src/index.js',
        text: 'export * from "./constants.js";'
      },
      {
        type: CheckType.COMMAND,
        command: ['npm', 'test']
      }
    ],
    budget: {
      maxTurns: 10,
      maxInputTokens: 8000,
      maxOutputTokens: 4000,
      maxPromptChars: 20000,
      maxReadBytes: 16384,
      maxWriteBytes: 16384,
      maxWallMs: 45000,
      maxContextChars: 60000,
      maxReplyChars: 12000
    },
    dataPolicy: {
      classification: DataClassification.PUBLIC,
      allowRemoteInference: false
    },
    deadlineMs: 60000
  };

  it('validates a well-formed assignment and returns normalized copy', () => {
    const res = validateAssignment(validAssignment);
    assert.equal(res.taskId, 'task-101');
    assert.equal(res.attemptId, 1);
    assert.equal(res.agentId, 'AGR-1');
    assert.equal(res.scope.readPaths.length, 1);
    assert.equal(res.scope.createPaths.length, 1);
    assert.equal(isAssignment(validAssignment), true);
  });

  it('rejects unsupported schemaVersion', () => {
    assert.throws(
      () => validateAssignment({ ...validAssignment, schemaVersion: 'zetro.protocol.assignment.v0' }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('schemaVersion'));
        return true;
      }
    );
  });

  it('rejects invalid or missing taskId, attemptId, and agentId', () => {
    assert.throws(
      () => validateAssignment({ ...validAssignment, taskId: 'invalid taskId with spaces!' }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({ ...validAssignment, attemptId: -5 }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({ ...validAssignment, agentId: '' }),
      ValidationError
    );
  });

  it('rejects invalid objective bounds (<3 or >2000)', () => {
    assert.throws(
      () => validateAssignment({ ...validAssignment, objective: 'no' }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({ ...validAssignment, objective: 'x'.repeat(2001) }),
      ValidationError
    );
  });

  it('rejects empty or invalid acceptance criteria', () => {
    assert.throws(
      () => validateAssignment({ ...validAssignment, acceptance: [] }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({ ...validAssignment, acceptance: ['ok', 'too short: a'] }),
      ValidationError
    );
  });

  it('rejects bare filesystem roots for scope.root', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        scope: { ...validAssignment.scope, root: '/' }
      }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        scope: { ...validAssignment.scope, root: 'C:\\' }
      }),
      ValidationError
    );
  });

  it('rejects dangerous or malformed relative paths in scope', () => {
    const badPaths = [
      '../traversal',
      'foo/../../bar',
      '/absolute/path',
      'C:/windows/path',
      'has\\backslash',
      'has\0null',
      '.hidden/file',
      'segment/with:colon',
      'double//slash'
    ];

    for (const bad of badPaths) {
      assert.throws(
        () => validateAssignment({
          ...validAssignment,
          scope: {
            ...validAssignment.scope,
            readPaths: [bad]
          }
        }),
        ValidationError,
        `Expected rejection for path: ${bad}`
      );
    }
  });

  it('rejects empty scope where readPaths, writePaths, createPaths are all empty', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        scope: {
          root: 'E:/Veyminore/products/zetro',
          readPaths: [],
          writePaths: [],
          createPaths: []
        }
      }),
      ValidationError
    );
  });

  it('rejects checks referencing paths outside declared scope', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        checks: [
          {
            type: CheckType.EQUALS,
            path: 'unscoped/file.txt',
            text: 'forbidden'
          }
        ]
      }),
      ValidationError
    );
  });

  it('rejects empty contains check text', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        checks: [
          {
            type: CheckType.CONTAINS,
            path: 'packages/protocol/src/index.js',
            text: ''
          }
        ]
      }),
      ValidationError
    );
  });

  it('rejects budget values exceeding bounds', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        budget: { ...validAssignment.budget, maxTurns: 100 }
      }),
      ValidationError
    );
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        budget: { ...validAssignment.budget, maxWallMs: 50 } // min 100
      }),
      ValidationError
    );
  });

  it('rejects remote inference on sensitive data classification', () => {
    assert.throws(
      () => validateAssignment({
        ...validAssignment,
        dataPolicy: {
          classification: DataClassification.SENSITIVE,
          allowRemoteInference: true
        }
      }),
      (err) => {
        assert(err instanceof ValidationError);
        assert(err.message.includes('remote inference is not permitted for sensitive'));
        return true;
      }
    );
  });
});
