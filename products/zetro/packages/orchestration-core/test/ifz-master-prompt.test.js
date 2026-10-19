import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCharter,
  createWorkerKnowledge,
  createProjectContext,
  createTaskPackage,
  createMasterPrompt,
  MasterPromptError,
  DEFAULT_CHARTER_CONTENT,
  DEFAULT_CHARTER_PRINCIPLES
} from '../src/ifz/master-prompt.js';
import {
  getPreset,
  listPresets,
  validatePreset,
  applyPreset,
  PresetError,
  InvalidPresetApplicationError,
  PRESET_NAMES,
  PRESET_IDS
} from '../src/ifz/presets.js';

test('createCharter - creates default versioned charter', () => {
  const charter = createCharter();
  assert.equal(charter.layer, 'charter');
  assert.equal(charter.version, '1.0.0');
  assert.equal(charter.title, 'ZETRO Charter');
  assert.equal(charter.author, 'user');
  assert.equal(charter.content, DEFAULT_CHARTER_CONTENT);
  assert.deepEqual(charter.principles, DEFAULT_CHARTER_PRINCIPLES);
  assert.ok(Object.isFrozen(charter));
});

test('createCharter - supports custom version and principles, rejects invalid', () => {
  const custom = createCharter({
    version: '2.0.0',
    title: 'Custom Charter',
    content: 'Special rules apply.',
    principles: ['Rule A', 'Rule B']
  });
  assert.equal(custom.version, '2.0.0');
  assert.equal(custom.title, 'Custom Charter');
  assert.deepEqual(custom.principles, ['Rule A', 'Rule B']);

  assert.throws(() => createCharter({ version: '' }), MasterPromptError);
  assert.throws(() => createCharter({ content: '   ' }), MasterPromptError);
  assert.throws(() => createCharter({ principles: [] }), MasterPromptError);
});

test('createWorkerKnowledge - derives from manifest with capabilities and protocols', () => {
  const manifest = {
    workerId: 'AGR-3',
    workerType: 'agr',
    adapterId: 'antigravity-adapter',
    capabilities: { read: true, write: true, execute: true },
    tools: ['view_file', 'replace_file_content', 'run_command']
  };

  const knowledge = createWorkerKnowledge(manifest, { version: '1.2.0' });
  assert.equal(knowledge.layer, 'worker_knowledge');
  assert.equal(knowledge.version, '1.2.0');
  assert.equal(knowledge.workerId, 'AGR-3');
  assert.equal(knowledge.workerType, 'agr');
  assert.equal(knowledge.adapterId, 'antigravity-adapter');
  assert.deepEqual(knowledge.capabilities, { read: true, write: true, execute: true });
  assert.deepEqual(knowledge.tools, ['view_file', 'replace_file_content', 'run_command']);
  assert.ok(knowledge.messageProtocol.includes('IFZ'));
  assert.ok(knowledge.delegationMethod.includes('IFZ'));
  assert.ok(knowledge.receiptFormat.includes('receipt'));
  assert.ok(Object.isFrozen(knowledge));

  assert.throws(() => createWorkerKnowledge(null), MasterPromptError);
  assert.throws(() => createWorkerKnowledge({ workerId: '' }), MasterPromptError);
});

test('createProjectContext - captures bounded context and rejects missing workspace', () => {
  const context = createProjectContext({
    version: '1.1.0',
    project: 'zetro-core',
    workspace: 'e:/Veyminore/products/zetro',
    milestone: 'IFZ Architecture',
    acceptedWork: ['AGR-1', 'AGR-2'],
    pendingWork: ['AGR-3', 'AGR-4'],
    ownership: { 'packages/orchestration-core': 'AGR-3' },
    relevantFiles: [{ path: 'packages/orchestration-core/src/ifz/master-prompt.js' }],
    checks: [{ name: 'unit_tests', command: 'node --test' }]
  });

  assert.equal(context.layer, 'project_context');
  assert.equal(context.version, '1.1.0');
  assert.equal(context.project, 'zetro-core');
  assert.equal(context.workspace, 'e:/Veyminore/products/zetro');
  assert.equal(context.milestone, 'IFZ Architecture');
  assert.equal(context.acceptedWork.length, 2);
  assert.equal(context.pendingWork.length, 2);
  assert.ok(Object.isFrozen(context));

  assert.throws(() => createProjectContext({ workspace: '' }), MasterPromptError);
  assert.throws(() => createProjectContext({ workspace: 'e:/ws', acceptedWork: 'not-an-array' }), MasterPromptError);
});

test('createTaskPackage - validates required fields and captures route position', () => {
  const task = createTaskPackage({
    version: '1.0.1',
    taskId: 'task-ifz-01',
    runId: 'run-ifz-99',
    conversationId: 'conv-101',
    userObjective: 'Implement Master Prompt and Fresh Worker Package',
    routePosition: { index: 2, total: 5, sourceWorker: 'codex', destinationWorker: 'AGR-3' },
    ownedPaths: ['packages/orchestration-core/src/ifz/master-prompt.js'],
    allowedActions: ['read', 'write', 'check'],
    limits: { maxSteps: 25, maxBytes: 50000 },
    checks: ['npm test']
  });

  assert.equal(task.layer, 'task_package');
  assert.equal(task.version, '1.0.1');
  assert.equal(task.taskId, 'task-ifz-01');
  assert.equal(task.runId, 'run-ifz-99');
  assert.equal(task.conversationId, 'conv-101');
  assert.equal(task.userObjective, 'Implement Master Prompt and Fresh Worker Package');
  assert.deepEqual(task.routePosition, {
    index: 2,
    total: 5,
    sourceWorker: 'codex',
    destinationWorker: 'AGR-3'
  });
  assert.deepEqual(task.ownedPaths, ['packages/orchestration-core/src/ifz/master-prompt.js']);
  assert.deepEqual(task.allowedActions, ['read', 'write', 'check']);
  assert.equal(task.limits.maxSteps, 25);
  assert.equal(task.limits.maxBytes, 50000);
  assert.ok(Object.isFrozen(task));

  assert.throws(() => createTaskPackage({ taskId: '', runId: 'r', userObjective: 'o' }), MasterPromptError);
  assert.throws(() => createTaskPackage({ taskId: 't', runId: '', userObjective: 'o' }), MasterPromptError);
  assert.throws(() => createTaskPackage({ taskId: 't', runId: 'r', userObjective: '' }), MasterPromptError);
});

test('createMasterPrompt - unites the 4 versioned layers and renders markdown', () => {
  const charter = createCharter({ version: '1.0.0' });
  const workerKnowledge = createWorkerKnowledge({ workerId: 'AGR-3', workerType: 'agr' }, { version: '1.0.0' });
  const projectContext = createProjectContext({ workspace: 'e:/ws', version: '1.0.0' });
  const taskPackage = createTaskPackage({
    taskId: 'task-test',
    runId: 'run-test',
    userObjective: 'Build master prompt',
    version: '1.0.0'
  });

  const masterPrompt = createMasterPrompt({
    charter,
    workerKnowledge,
    projectContext,
    taskPackage,
    preset: 'ZETRO Standard',
    version: '1.0.0'
  });

  assert.equal(masterPrompt.version, '1.0.0');
  assert.ok(masterPrompt.compositeVersion.includes('c1.0.0:w1.0.0:p1.0.0:t1.0.0'));
  assert.equal(masterPrompt.preset.name, 'ZETRO Standard');

  const layers = masterPrompt.getLayers();
  assert.equal(layers.charter.layer, 'charter');
  assert.equal(layers.workerKnowledge.layer, 'worker_knowledge');
  assert.equal(layers.projectContext.layer, 'project_context');
  assert.equal(layers.taskPackage.layer, 'task_package');

  const rendered = masterPrompt.render();
  assert.ok(rendered.includes('# ZETRO Charter'));
  assert.ok(rendered.includes('Worker Knowledge: AGR-3'));
  assert.ok(rendered.includes('Project Context: zetro'));
  assert.ok(rendered.includes('Master Prompt Preset: ZETRO Standard'));
  assert.ok(rendered.includes('Task Package: task-test'));

  // Rejection when missing layers
  assert.throws(() => createMasterPrompt({ workerKnowledge, projectContext, taskPackage }), MasterPromptError);
});

test('presets - provides all 7 required presets', () => {
  const allPresets = listPresets();
  assert.equal(allPresets.length, 7);

  const names = allPresets.map(p => p.name);
  for (const requiredName of PRESET_NAMES) {
    assert.ok(names.includes(requiredName), `Missing required preset: ${requiredName}`);
  }

  const ids = allPresets.map(p => p.id);
  for (const requiredId of PRESET_IDS) {
    assert.ok(ids.includes(requiredId), `Missing required preset ID: ${requiredId}`);
  }

  for (const preset of allPresets) {
    assert.equal(validatePreset(preset), true);
    assert.ok(Object.isFrozen(preset));
  }
});

test('presets - getPreset resolves by ID and name case-insensitively', () => {
  const p1 = getPreset('eco');
  assert.equal(p1.id, 'eco');
  assert.equal(p1.name, 'ECO Mode');

  const p2 = getPreset('Review Mode');
  assert.equal(p2.id, 'review');
  assert.equal(p2.readOnly, true);

  const p3 = getPreset('qualification');
  assert.equal(p3.id, 'qualification');
  assert.equal(p3.purpose, 'Strict independent testing');

  const p4 = getPreset('Recovery Mode');
  assert.equal(p4.id, 'recovery');

  const p5 = getPreset('Build Mode');
  assert.equal(p5.id, 'build');

  const p6 = getPreset('Design Mode');
  assert.equal(p6.id, 'design');

  const p7 = getPreset('ZETRO Standard');
  assert.equal(p7.id, 'standard');

  assert.throws(() => getPreset('Unknown Preset'), PresetError);
  assert.throws(() => getPreset(''), PresetError);
});

test('presets - applyPreset narrows work and cannot weaken authority', () => {
  // Base configuration: only read and write permitted; maximum 30 steps
  const base = {
    destination: 'AGR-3',
    allowedActionClasses: ['read', 'write'],
    readOnly: false,
    limits: { maxPackageBytes: 65536, maxSteps: 30, maxFiles: 20 },
    security: { allowExternalSend: false },
    requiredEvidence: ['work_receipt']
  };

  // 1. Review Mode narrows to readOnly and strips write
  const reviewResult = applyPreset(base, 'Review Mode');
  assert.equal(reviewResult.readOnly, true);
  assert.deepEqual(reviewResult.allowedActionClasses, ['read']);
  assert.equal(reviewResult.limits.maxSteps, 20); // Narrowed from 30 to 20
  assert.equal(reviewResult.destination, 'AGR-3');

  // 2. ECO Mode narrows limits
  const ecoResult = applyPreset(base, 'ECO Mode');
  assert.equal(ecoResult.limits.maxPackageBytes, 24576); // Narrowed to 24KB
  assert.equal(ecoResult.limits.maxSteps, 15); // Narrowed from 30 to 15
  assert.equal(ecoResult.limits.maxFiles, 10); // Narrowed from 20 to 10

  // 3. Negative Constraint: Preset CANNOT expand action classes beyond base
  // Base only allows ['read', 'check']. If preset has ['read', 'write', 'execute'], write/execute must NOT be added.
  const readOnlyBase = {
    destination: 'AGR-3',
    allowedActionClasses: ['read', 'check'],
    readOnly: true,
    limits: { maxPackageBytes: 50000, maxSteps: 20, maxFiles: 10 }
  };

  // Applying Build Mode (which includes write/create/execute) to a readOnly base naturally narrows to ['read', 'check']
  const narrowedBuild = applyPreset(readOnlyBase, 'Build Mode');
  assert.equal(narrowedBuild.readOnly, true);
  assert.deepEqual(narrowedBuild.allowedActionClasses, ['read', 'check']);
  assert.ok(!narrowedBuild.allowedActionClasses.includes('write'));
  assert.ok(!narrowedBuild.allowedActionClasses.includes('create'));
  assert.ok(!narrowedBuild.allowedActionClasses.includes('execute'));

  // If strictAuthority is explicitly enabled, attempting to apply preset with unadmitted actions throws
  assert.throws(
    () => applyPreset({ ...readOnlyBase, strictAuthority: true }, 'Build Mode'),
    InvalidPresetApplicationError
  );

  // 4. Negative Constraint: Preset CANNOT increase usage limits above base
  const smallBudgetBase = {
    destination: 'AGR-3',
    allowedActionClasses: ['read', 'write', 'create', 'execute', 'check'],
    readOnly: false,
    limits: { maxPackageBytes: 16000, maxSteps: 10, maxFiles: 5 }
  };
  const standardResult = applyPreset(smallBudgetBase, 'ZETRO Standard');
  // ZETRO Standard defaults to maxSteps: 50, but base is 10. Result MUST stay 10!
  assert.equal(standardResult.limits.maxSteps, 10);
  assert.equal(standardResult.limits.maxPackageBytes, 16000);
  assert.equal(standardResult.limits.maxFiles, 5);

  // 5. Negative Constraint: Preset CANNOT weaken security
  const secureBase = {
    destination: 'AGR-3',
    allowedActionClasses: ['read', 'check'],
    security: { allowExternalSend: false }
  };
  const roguePreset = {
    id: 'rogue',
    name: 'Rogue Preset',
    version: '1.0.0',
    purpose: 'Attempted security bypass',
    allowedActionClasses: ['read', 'check'],
    readOnly: true,
    allowExternalSend: true,
    limits: { maxPackageBytes: 10000, maxSteps: 10 }
  };
  assert.throws(
    () => applyPreset(secureBase, roguePreset),
    InvalidPresetApplicationError
  );
});
