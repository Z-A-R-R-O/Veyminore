import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFreshWorkerPackage,
  createWorkerAcknowledgment,
  verifyWorkerAcknowledgment,
  assertStructuralSafety,
  sanitizeText,
  sanitizeData,
  ContextPackageError,
  ContextPackageBoundsError,
  ContextPackageSecurityError,
  MAX_STRING_BYTES,
  MAX_ARRAY_LENGTH,
  MAX_OBJECT_KEYS,
  MAX_NESTING_DEPTH,
  MAX_ENTRY_BOUNDS
} from '../src/ifz/context-package.js';

function createBasicParams(overrides = {}) {
  return {
    worker: {
      workerId: 'AGR-3',
      workerType: 'agr',
      adapterId: 'antigravity-adapter',
      capabilities: { read: true, write: true, execute: true },
      tools: ['view_file', 'replace_file_content', 'run_command']
    },
    adapter: 'antigravity-adapter',
    project: 'zetro',
    workspace: 'e:/Veyminore/products/zetro',
    task: {
      taskId: 'task-001',
      runId: 'run-001',
      userObjective: 'Implement IFZ master prompt slice'
    },
    routePosition: { index: 1, total: 3 },
    scope: {
      ownedPaths: ['packages/orchestration-core/src/ifz/master-prompt.js'],
      allowedActions: ['read', 'write', 'check']
    },
    preset: 'ZETRO Standard',
    ...overrides
  };
}

test('buildFreshWorkerPackage - generates 8-step boot package in documented order', () => {
  const pkg = buildFreshWorkerPackage(createBasicParams());

  assert.equal(pkg.sections.length, 8);
  assert.equal(pkg.sections[0].step, 1);
  assert.equal(pkg.sections[0].name, 'charter');
  assert.equal(pkg.sections[0].title, '1. ZETRO Charter');

  assert.equal(pkg.sections[1].step, 2);
  assert.equal(pkg.sections[1].name, 'workerContract');
  assert.equal(pkg.sections[1].title, '2. Worker Identity and Capability Contract');

  assert.equal(pkg.sections[2].step, 3);
  assert.equal(pkg.sections[2].name, 'projectContext');
  assert.equal(pkg.sections[2].title, '3. Current Project Context');

  assert.equal(pkg.sections[3].step, 4);
  assert.equal(pkg.sections[3].name, 'preset');
  assert.equal(pkg.sections[3].title, '4. Selected Master Prompt Preset');

  assert.equal(pkg.sections[4].step, 5);
  assert.equal(pkg.sections[4].name, 'taskPackage');
  assert.equal(pkg.sections[4].title, '5. Task Package');

  assert.equal(pkg.sections[5].step, 6);
  assert.equal(pkg.sections[5].name, 'toolsAndScope');
  assert.equal(pkg.sections[5].title, '6. Allowed Tools and Scope');

  assert.equal(pkg.sections[6].step, 7);
  assert.equal(pkg.sections[6].name, 'requiredEvidence');
  assert.equal(pkg.sections[6].title, '7. Required Evidence');

  assert.equal(pkg.sections[7].step, 8);
  assert.equal(pkg.sections[7].name, 'delegationProtocol');
  assert.equal(pkg.sections[7].title, '8. Delegation and Receipt Protocols');
});

test('buildFreshWorkerPackage - binds package to worker, adapter, project, workspace, task, route, and versions', () => {
  const pkg = buildFreshWorkerPackage(createBasicParams());
  const b = pkg.bindings;

  assert.equal(b.workerId, 'AGR-3');
  assert.equal(b.adapterId, 'antigravity-adapter');
  assert.equal(b.project, 'zetro');
  assert.equal(b.workspace, 'e:/Veyminore/products/zetro');
  assert.equal(b.taskId, 'task-001');
  assert.equal(b.runId, 'run-001');
  assert.equal(b.routePosition.index, 1);
  assert.equal(b.routePosition.total, 3);

  assert.ok(b.contextVersions.charterVersion);
  assert.ok(b.contextVersions.workerKnowledgeVersion);
  assert.ok(b.contextVersions.projectContextVersion);
  assert.ok(b.contextVersions.taskPackageVersion);
  assert.ok(b.contextVersions.presetVersion);
  assert.ok(b.contextVersions.compositeVersion.startsWith('cv1#'));

  assert.ok(Object.isFrozen(pkg));
  assert.ok(Object.isFrozen(pkg.bindings));
  assert.ok(Object.isFrozen(pkg.scope));
});

test('adversarial: structural rejection of secrets and credentials at every nested level', () => {
  // 1. Secret key at root
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ task: { taskId: 't1', userObjective: 'clean', apiKey: 'sk-123' } })),
    ContextPackageSecurityError
  );

  // 2. Secret key nested in scope
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      scope: {
        ownedPaths: ['src/a.js'],
        credentials: { password: 'plain_password' }
      }
    })),
    ContextPackageSecurityError
  );

  // 3. Secret token string in userObjective
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      task: {
        taskId: 't2',
        userObjective: 'Use token bearer sk-12345678901234567890'
      }
    })),
    ContextPackageSecurityError
  );

  // 4. GitHub token in tools
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      tools: ['view_file', 'ghp_123456789012345678901234567890123456']
    })),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of .env material', () => {
  // .env line syntax in task objective
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      task: {
        taskId: 't-env',
        userObjective: 'Configuration:\nDATABASE_URL=postgres://user:pass@localhost:5432/db\nRun migration'
      }
    })),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of private reasoning / model-thinking fields and tags', () => {
  // 1. Field named thinking
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      task: {
        taskId: 't-think',
        userObjective: 'Normal task',
        thinking: 'Internal confidential thought chain'
      }
    })),
    ContextPackageSecurityError
  );

  // 2. XML tag <thinking>
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      task: {
        taskId: 't-think-tag',
        userObjective: 'Investigate bug <thinking>The user might be mistaken</thinking> and report.'
      }
    })),
    ContextPackageSecurityError
  );

  // 3. Chain of thought field
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      worker: {
        workerId: 'AGR-3',
        chainOfThought: 'private steps'
      }
    })),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of full-transcript payloads', () => {
  // Full transcript turn dump
  const fullTranscript = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Turn number ${i} message content`
  }));

  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      task: {
        taskId: 't-transcript',
        userObjective: 'Analyze conversation',
        transcript: fullTranscript
      }
    })),
    ContextPackageSecurityError
  );

  // Reject array of raw turns
  assert.throws(
    () => assertStructuralSafety(fullTranscript, 'test.transcript'),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of circular references', () => {
  const cyclicTask = {
    taskId: 't-cyclic',
    userObjective: 'Looping reference'
  };
  cyclicTask.self = cyclicTask;

  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ task: cyclicTask })),
    (err) => err instanceof ContextPackageError && err.message.includes('Circular reference')
  );
});

test('adversarial: structural rejection of accessors (getters/setters)', () => {
  const accessorTask = {
    taskId: 't-accessor',
    userObjective: 'Task with getter'
  };
  Object.defineProperty(accessorTask, 'sneaky', {
    get() {
      return 'hidden';
    },
    enumerable: true
  });

  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ task: accessorTask })),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of unsafe prototypes and __proto__ poisoning', () => {
  // 1. Non-plain object instance
  class CustomClass {
    constructor() {
      this.taskId = 'custom-inst';
      this.userObjective = 'Non plain instance';
    }
  }
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ task: new CustomClass() })),
    ContextPackageSecurityError
  );

  // 2. Object with __proto__ own property
  const protoPoison = Object.create(null);
  Object.defineProperty(protoPoison, '__proto__', {
    value: { polluted: true },
    enumerable: true
  });
  assert.throws(
    () => assertStructuralSafety(protoPoison),
    ContextPackageSecurityError
  );
});

test('adversarial: structural rejection of excessive nesting', () => {
  // Nest beyond MAX_NESTING_DEPTH (10)
  let nested = 'deepest value';
  for (let i = 0; i < MAX_NESTING_DEPTH + 2; i++) {
    nested = { child: nested };
  }

  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ task: { taskId: 't-nest', userObjective: 'clean', extra: nested } })),
    ContextPackageBoundsError
  );
});

test('adversarial: structural rejection of oversized arrays, objects, and strings', () => {
  // 1. Oversized array (> MAX_ARRAY_LENGTH = 100)
  const hugeArray = Array.from({ length: MAX_ARRAY_LENGTH + 5 }, (_, i) => `item-${i}`);
  assert.throws(
    () => assertStructuralSafety(hugeArray),
    ContextPackageBoundsError
  );

  // 2. Oversized object (> MAX_OBJECT_KEYS = 100)
  const hugeObject = Object.fromEntries(
    Array.from({ length: MAX_OBJECT_KEYS + 5 }, (_, i) => [`key_${i}`, `val_${i}`])
  );
  assert.throws(
    () => assertStructuralSafety(hugeObject),
    ContextPackageBoundsError
  );

  // 3. Oversized string (> MAX_STRING_BYTES = 16384)
  const hugeString = 'A'.repeat(MAX_STRING_BYTES + 10);
  assert.throws(
    () => assertStructuralSafety(hugeString),
    ContextPackageBoundsError
  );
});

test('adversarial: context packages and presets never widen destination, workspace, paths, or budgets', () => {
  const baseAuthority = {
    destination: 'AGR-3',
    workspace: 'e:/Veyminore/products/zetro',
    project: 'zetro',
    ownedPaths: ['src/a.js'],
    allowedActions: ['read', 'write'],
    readOnly: false,
    limits: {
      maxSteps: 20,
      maxPackageBytes: 40000,
      timeoutMs: 30000,
      maxTokens: 10000,
      maxProviderAttempts: 3,
      maxWorkers: 2,
      maxDepth: 1,
      maxBranches: 2
    }
  };

  // 1. Destination widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      worker: { workerId: 'AGR-9', capabilities: { read: true } }
    })),
    ContextPackageSecurityError
  );

  // 2. Workspace widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      workspace: 'c:/other/workspace'
    })),
    ContextPackageSecurityError
  );

  // 3. Project widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      project: 'malicious-project'
    })),
    ContextPackageSecurityError
  );

  // 4. Owned paths widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      scope: { ownedPaths: ['src/a.js', 'src/unauthorized.js'] }
    })),
    ContextPackageSecurityError
  );

  // 5. Allowed actions widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      scope: { ownedPaths: ['src/a.js'], allowedActions: ['read', 'write', 'execute'] }
    })),
    ContextPackageSecurityError
  );

  // 6. Time limit widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      scope: { ownedPaths: ['src/a.js'] },
      limits: { timeoutMs: 90000 } // base is 30000
    })),
    ContextPackageBoundsError
  );

  // 7. Max tokens widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      scope: { ownedPaths: ['src/a.js'] },
      limits: { maxTokens: 50000 } // base is 10000
    })),
    ContextPackageBoundsError
  );

  // 8. Max depth widening rejected
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      baseAuthority,
      scope: { ownedPaths: ['src/a.js'] },
      limits: { maxDepth: 5 } // base is 1
    })),
    ContextPackageBoundsError
  );
});

test('acknowledgment - admission evidence only; cannot claim dispatch, completion, or verification', () => {
  const pkg = buildFreshWorkerPackage(createBasicParams());

  const validAck = createWorkerAcknowledgment({
    workerId: pkg.bindings.workerId,
    workspace: pkg.bindings.workspace,
    taskId: pkg.bindings.taskId,
    scope: {
      ownedPaths: [...pkg.scope.ownedPaths],
      allowedActions: [...pkg.scope.allowedActions],
      readOnly: pkg.scope.readOnly
    },
    contextVersion: pkg.bindings.contextVersions.compositeVersion
  });

  // Verify properties confirm admission evidence ONLY
  assert.equal(validAck.acknowledged, true);
  assert.equal(validAck.evidenceType, 'admission_evidence');
  assert.equal(validAck.isDispatch, false);
  assert.equal(validAck.isCompletion, false);
  assert.equal(validAck.isVerification, false);

  const verification = verifyWorkerAcknowledgment(pkg, validAck);
  assert.equal(verification.valid, true);
  assert.equal(verification.evidenceType, 'admission_evidence');
  assert.equal(verification.isDispatch, false);
  assert.equal(verification.isCompletion, false);
  assert.equal(verification.isVerification, false);

  // Adversarial: Acknowledgment attempting to claim dispatch is rejected
  const dispatchClaim = { ...validAck, isDispatch: true };
  const r1 = verifyWorkerAcknowledgment(pkg, dispatchClaim);
  assert.equal(r1.valid, false);
  assert.ok(r1.reason.includes('cannot claim dispatch'));

  // Adversarial: Acknowledgment attempting to claim completion is rejected
  const completionClaim = { ...validAck, isCompletion: true };
  const r2 = verifyWorkerAcknowledgment(pkg, completionClaim);
  assert.equal(r2.valid, false);
  assert.ok(r2.reason.includes('cannot claim dispatch, completion, or verification'));

  // Adversarial: Acknowledgment attempting to claim verification is rejected
  const verificationClaim = { ...validAck, isVerification: true };
  const r3 = verifyWorkerAcknowledgment(pkg, verificationClaim);
  assert.equal(r3.valid, false);
  assert.ok(r3.reason.includes('cannot claim dispatch, completion, or verification'));
});

test('defense-in-depth sanitization functions', () => {
  const dirtyText = 'Sample clean text with <thinking>hidden reasoning</thinking>';
  const sanitized = sanitizeText(dirtyText);
  assert.ok(!sanitized.includes('hidden reasoning'));
  assert.ok(sanitized.includes('[REDACTED_PRIVATE_REASONING]'));

  const obj = { normal: 'clean', token: 'super_secret', thinking: 'internal' };
  const cleaned = sanitizeData(obj);
  assert.equal(cleaned.normal, 'clean');
  assert.equal(cleaned.token, '[REDACTED_SECRET]');
  assert.equal(cleaned.thinking, undefined);
});

test('presets - all 7 presets build valid fresh-worker packages', () => {
  const presets = [
    'ZETRO Standard',
    'ECO Mode',
    'Build Mode',
    'Review Mode',
    'Design Mode',
    'Qualification Mode',
    'Recovery Mode'
  ];

  for (const presetName of presets) {
    const pkg = buildFreshWorkerPackage(createBasicParams({ preset: presetName }));
    assert.equal(pkg.sections.length, 8);
    assert.equal(pkg.preset.name, presetName);
    assert.ok(pkg.totalBytes <= pkg.maxByteBudget, `${presetName} exceeded byte budget`);
    assert.ok(pkg.bindings.contextVersions.compositeVersion.includes('cv1#'));

    const ack = createWorkerAcknowledgment({
      workerId: pkg.bindings.workerId,
      workspace: pkg.bindings.workspace,
      taskId: pkg.bindings.taskId,
      scope: {
        ownedPaths: [...pkg.scope.ownedPaths],
        allowedActions: [...pkg.scope.allowedActions],
        readOnly: pkg.scope.readOnly
      },
      contextVersion: pkg.bindings.contextVersions.compositeVersion
    });
    assert.equal(verifyWorkerAcknowledgment(pkg, ack).valid, true);
  }
});

test('bounds enforcement - rejects tools exceeding maxTools entry bound', () => {
  const excessiveTools = Array.from({ length: MAX_ENTRY_BOUNDS.maxTools + 5 }, (_, i) => `tool_${i}`);
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({ tools: excessiveTools })),
    ContextPackageBoundsError
  );

  const excessiveWorkerTools = Array.from({ length: MAX_ENTRY_BOUNDS.maxTools + 5 }, (_, i) => `tool_${i}`);
  assert.throws(
    () => buildFreshWorkerPackage(createBasicParams({
      worker: {
        workerId: 'AGR-3',
        capabilities: { read: true },
        tools: excessiveWorkerTools
      }
    })),
    ContextPackageBoundsError
  );
});

