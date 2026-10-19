import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIfzWorkModel,
  generateRoutePreview,
  ROUTE_MODES,
  MASTER_PRESETS,
  REGISTERED_WORKERS,
  SAVED_WORKFLOWS,
  HONEST_FIXTURES,
  DEFAULT_UNVERIFIED_STATE
} from '../src/ifz-work-model.js';

test('ifz-work-model: default unverified state is truthful and unpopulated without evidence', () => {
  const model = createIfzWorkModel();
  const snap = model.getSnapshot();

  // Model must start in unknown/unverified state when no fixture is explicitly supplied
  assert.equal(snap.fixtureKey, null);
  assert.equal(snap.fixtureName, null);
  assert.equal(snap.workspace, null);
  assert.equal(snap.status, 'unknown');
  assert.equal(snap.connection, 'unknown');
  assert.equal(snap.devLab, false);
  assert.equal(snap.activeRun, null);
  assert.deepEqual(snap.events, []);
  assert.equal(snap.stats.totalEvents, 0);
  assert.equal(snap.stats.verifiedCount, 0);
  assert.equal(snap.stats.pendingCount, 0);

  // Draft remains ready with neutral defaults
  assert.ok(snap.draft);
  assert.equal(snap.draft.text, '');
  assert.equal(snap.draft.routeMode, ROUTE_MODES.AUTOMATIC);
  assert.deepEqual(snap.draft.manualWorkers, []);
  assert.equal(snap.routePreview.target, 'IFZ (Central Orchestrator)');

  // Invariant 1: No invented workspace or false authority claim
  assert.equal(snap.routePreview.authorityScope, null);
  assert.equal(DEFAULT_UNVERIFIED_STATE.name, null);
  assert.equal(DEFAULT_UNVERIFIED_STATE.workspace, null);
  assert.doesNotMatch(JSON.stringify(snap), /Default Workspace/);
  assert.doesNotMatch(JSON.stringify(snap), /Bounded to current workspace/);

  // Invariant 4: No connected/worker/route claims from default state
  assert.deepEqual(snap.availableWorkers, []);
  assert.deepEqual(snap.routePreview.assignedWorkers, []);
});

test('ifz-work-model: explicit fixture loading and snapshot structure', () => {
  const model = createIfzWorkModel({ initialFixture: 'empty' });
  const snap = model.getSnapshot();

  assert.equal(snap.fixtureKey, 'empty');
  assert.equal(snap.status, 'idle');
  assert.equal(snap.connection, 'connected');
  assert.equal(snap.workspace, 'zetro-workspace');
  assert.equal(snap.routePreview.authorityScope, 'Bounded to workspace: zetro-workspace');
  assert.ok(Array.isArray(snap.events));
  assert.equal(snap.events.length, 0);
  assert.ok(snap.draft);
  assert.equal(snap.draft.routeMode, ROUTE_MODES.AUTOMATIC);
  assert.equal(snap.routePreview.target, 'IFZ (Central Orchestrator)');
  assert.equal(snap.availablePresets.length, MASTER_PRESETS.length);
  assert.equal(snap.availableWorkers.length, REGISTERED_WORKERS.length);
});

test('ifz-work-model: devLab flag controls developer fixture visibility and isolation', () => {
  // Default devLab is false
  const defaultModel = createIfzWorkModel();
  assert.equal(defaultModel.getSnapshot().devLab, false);

  // Toggling devLab via setter
  defaultModel.setDevLab(true);
  assert.equal(defaultModel.getSnapshot().devLab, true);

  defaultModel.setDevLab(false);
  assert.equal(defaultModel.getSnapshot().devLab, false);

  // Initializing with devLab true
  const devModel = createIfzWorkModel({ devLab: true });
  assert.equal(devModel.getSnapshot().devLab, true);
});

test('ifz-work-model: fixture switching cleanly resets or restores unverified state', () => {
  const model = createIfzWorkModel();
  assert.equal(model.getSnapshot().status, 'unknown');

  // Switch to running fixture
  model.switchFixture('running');
  let snap = model.getSnapshot();
  assert.equal(snap.fixtureKey, 'running');
  assert.equal(snap.status, 'running');
  assert.equal(snap.workspace, 'zetro-workspace');
  assert.ok(snap.events.length > 0);

  // Switch back to unknown / null
  model.switchFixture('unknown');
  snap = model.getSnapshot();
  assert.equal(snap.fixtureKey, null);
  assert.equal(snap.status, 'unknown');
  assert.equal(snap.connection, 'unknown');
  assert.equal(snap.workspace, null);
  assert.deepEqual(snap.events, []);
});

test('ifz-work-model: route preview always targets IFZ across all route modes', () => {
  // 1. Automatic mode
  const autoPreview = generateRoutePreview({
    routeMode: ROUTE_MODES.AUTOMATIC,
    presetId: 'zetro-standard'
  });
  assert.match(autoPreview.target, /IFZ/);
  assert.equal(autoPreview.isConstrained, false);
  assert.deepEqual(autoPreview.chips, ['IFZ', 'Auto Route']);

  // 2. Manual mode: manual selection constrains IFZ, does NOT bypass IFZ
  const manualPreview = generateRoutePreview({
    routeMode: ROUTE_MODES.MANUAL,
    manualWorkers: ['AGR-2', 'RCT-1'],
    presetId: 'build-mode'
  });
  assert.match(manualPreview.target, /IFZ/);
  assert.equal(manualPreview.isConstrained, true);
  assert.deepEqual(manualPreview.chips, ['IFZ', 'AGR-2', 'RCT-1']);
  assert.match(manualPreview.description, /Manual constraint.*IFZ will route strictly to AGR-2, RCT-1/);

  // 3. Saved Workflow mode
  const workflowPreview = generateRoutePreview({
    routeMode: ROUTE_MODES.SAVED_WORKFLOW,
    savedWorkflowId: 'sequential_review',
    presetId: 'review-mode'
  });
  assert.match(workflowPreview.target, /IFZ/);
  assert.equal(workflowPreview.strategy, 'Sequential Review Chain');
  assert.deepEqual(workflowPreview.chips, ['IFZ', 'AGR-5', 'RCT-1']);
});

test('ifz-work-model: manual mode with zero selected workers is invalid and rejects send without silent AGR-1 fallback', () => {
  const model = createIfzWorkModel();
  model.setRouteMode(ROUTE_MODES.MANUAL);

  // Default manualWorkers must be empty
  let snap = model.getSnapshot();
  assert.deepEqual(snap.draft.manualWorkers, []);

  // Route preview must report invalidity and zero assigned workers
  assert.equal(snap.routePreview.isConstrained, true);
  assert.equal(snap.routePreview.isValid, false);
  assert.deepEqual(snap.routePreview.assignedWorkers, []);
  assert.equal(snap.routePreview.chips.includes('AGR-1'), false);
  assert.deepEqual(snap.routePreview.chips, ['IFZ', 'No worker selected']);
  assert.match(snap.routePreview.validationError, /at least one selected worker/i);

  // submitPrompt must reject send
  model.setDraft({ text: 'Some task to execute' });
  const rejected = model.submitPrompt();
  assert.equal(rejected.success, false);
  assert.match(rejected.reason, /at least one selected worker/i);

  // Adding worker validates manual route
  model.toggleManualWorker('RCT-1');
  snap = model.getSnapshot();
  assert.deepEqual(snap.draft.manualWorkers, ['RCT-1']);
  assert.equal(snap.routePreview.isValid, true);
  assert.deepEqual(snap.routePreview.assignedWorkers, ['RCT-1']);

  // Toggling off the worker allows reaching zero workers (never stuck on fallback)
  model.toggleManualWorker('RCT-1');
  snap = model.getSnapshot();
  assert.deepEqual(snap.draft.manualWorkers, []);
  assert.equal(snap.routePreview.isValid, false);
});

test('ifz-work-model: empty state template prompts do not assert premature worker routes', () => {
  const preview = generateRoutePreview({ routeMode: ROUTE_MODES.AUTOMATIC });
  assert.equal(preview.assignedWorkers.length, 0);
  assert.doesNotMatch(preview.description, /AGR-\d/);
  assert.doesNotMatch(preview.description, /RCT-\d/);
  assert.doesNotMatch(preview.description, /OCR-\d/);
});

test('ifz-work-model: deterministic clock and idGenerator injection eliminate nondeterminism', () => {
  const fixedTimestamp = 1776556800000;
  const isoTime = new Date(fixedTimestamp).toISOString();
  let idSeq = 0;
  const customIdGen = prefix => `deterministic_${prefix}_${++idSeq}`;

  const model = createIfzWorkModel({
    clock: () => fixedTimestamp,
    idGenerator: customIdGen
  });

  // Test attachment ID generation
  model.addAttachment({ name: 'audit-log.json', size: 512, type: 'application/json' });
  const snapWithAtt = model.getSnapshot();
  assert.equal(snapWithAtt.draft.attachments[0].id, 'deterministic_att_1');

  // Test submit prompt IDs and timestamps
  model.setDraft({ text: 'Deterministic execution run test' });
  const res = model.submitPrompt();
  assert.equal(res.success, true);
  assert.equal(res.envelope.timestamp, isoTime);

  const snap = model.getSnapshot();
  const userEv = snap.events[0];
  const noticeEv = snap.events[1];

  assert.equal(userEv.id, 'deterministic_ev-local_2');
  assert.equal(userEv.timestamp, isoTime);
  assert.equal(noticeEv.id, 'deterministic_ev-notice_3');
  assert.equal(noticeEv.timestamp, isoTime);
});

test('ifz-work-model: route suggestions and presets never auto-send or mutate event stream', () => {
  const model = createIfzWorkModel({ initialFixture: 'empty' });
  assert.equal(model.getSnapshot().events.length, 0);

  // Changing preset must not send
  model.setPreset('build-mode');
  assert.equal(model.getSnapshot().draft.presetId, 'build-mode');
  assert.equal(model.getSnapshot().events.length, 0);

  // Applying suggestion text to draft must not send
  model.setDraft({ text: 'Refactor dock-island.jsx to mount unified Work destination' });
  assert.equal(model.getSnapshot().draft.text, 'Refactor dock-island.jsx to mount unified Work destination');
  assert.equal(model.getSnapshot().events.length, 0);

  // Changing route mode must not send
  model.setRouteMode(ROUTE_MODES.MANUAL);
  assert.equal(model.getSnapshot().draft.routeMode, ROUTE_MODES.MANUAL);
  assert.equal(model.getSnapshot().events.length, 0);
});

test('ifz-work-model: draft text and parameters persist across fixture switches and updates', () => {
  const model = createIfzWorkModel({ initialFixture: 'running' });

  model.setDraft({
    text: 'Refactor desktop window probe',
    routeMode: ROUTE_MODES.MANUAL,
    manualWorkers: ['AGR-2'],
    presetId: 'eco-mode'
  });

  let snap = model.getSnapshot();
  assert.equal(snap.draft.text, 'Refactor desktop window probe');
  assert.equal(snap.draft.routeMode, ROUTE_MODES.MANUAL);
  assert.deepEqual(snap.draft.manualWorkers, ['AGR-2']);
  assert.equal(snap.draft.presetId, 'eco-mode');

  // Switch fixture (page-model transition)
  model.switchFixture('complete');
  snap = model.getSnapshot();

  // Draft must be preserved!
  assert.equal(snap.draft.text, 'Refactor desktop window probe');
  assert.equal(snap.draft.routeMode, ROUTE_MODES.MANUAL);
  assert.deepEqual(snap.draft.manualWorkers, ['AGR-2']);
  assert.equal(snap.draft.presetId, 'eco-mode');
  assert.equal(snap.fixtureKey, 'complete');
});

test('ifz-work-model: attachments can be added and removed', () => {
  const model = createIfzWorkModel();

  model.addAttachment({ name: 'architecture-spec.md', size: 1024, type: 'text/markdown' });
  let snap = model.getSnapshot();
  assert.equal(snap.draft.attachments.length, 1);
  const attId = snap.draft.attachments[0].id;
  assert.equal(snap.draft.attachments[0].name, 'architecture-spec.md');

  model.removeAttachment(attId);
  snap = model.getSnapshot();
  assert.equal(snap.draft.attachments.length, 0);
});

test('ifz-work-model: worker branch expansion toggling', () => {
  const model = createIfzWorkModel({ initialFixture: 'running' });
  let snap = model.getSnapshot();
  assert.equal(snap.expandedBranches.includes('branch-agr-3'), true);

  model.toggleBranch('branch-agr-3');
  snap = model.getSnapshot();
  assert.equal(snap.expandedBranches.includes('branch-agr-3'), false);

  model.toggleBranch('branch-agr-3');
  snap = model.getSnapshot();
  assert.equal(snap.expandedBranches.includes('branch-agr-3'), true);
});

test('ifz-work-model: all 8 honest fixtures are valid, structured, and contain zero private reasoning', () => {
  const requiredFixtures = [
    'empty',
    'loading',
    'disconnected',
    'running',
    'partial_failure',
    'uncertain',
    'cancelled',
    'complete'
  ];

  requiredFixtures.forEach(key => {
    const fixture = HONEST_FIXTURES[key];
    assert.ok(fixture, `Fixture ${key} must exist`);
    assert.ok(fixture.name, `Fixture ${key} must have name`);
    assert.ok(fixture.status, `Fixture ${key} must have status`);
    assert.ok(Array.isArray(fixture.events), `Fixture ${key} must have events array`);

    // Invariant: Zero private model reasoning or raw tokens in any public event
    fixture.events.forEach(ev => {
      assert.ok(ev.id, 'Event must have ID');
      assert.ok(ev.type, 'Event must have type');
      assert.ok(ev.content, 'Event must have content');

      const serialized = JSON.stringify(ev).toLowerCase();
      assert.equal(serialized.includes('thinking_process'), false, 'Zero internal thinking tokens');
      assert.equal(serialized.includes('private_chain_of_thought'), false, 'Zero private reasoning');
      assert.equal(serialized.includes('system_prompt_leak'), false, 'Zero system prompt leak');
    });
  });
});

test('ifz-work-model: dry-run submission guard does not perform live network calls', () => {
  const model = createIfzWorkModel({ initialFixture: 'empty' });

  // Empty prompt rejection
  model.setDraft({ text: '   ' });
  const emptyRes = model.submitPrompt();
  assert.equal(emptyRes.success, false);
  assert.equal(emptyRes.reason, 'Empty prompt');

  // Valid prompt dry-run
  model.setDraft({ text: 'Design the unified prompt bar' });
  const res = model.submitPrompt();

  assert.equal(res.success, true);
  assert.equal(res.dryRun, true);
  assert.match(res.notice, /dry-run/i);
  assert.equal(res.envelope.target, 'IFZ');

  const snap = model.getSnapshot();
  assert.equal(snap.events.length, 2);
  assert.equal(snap.events[0].type, 'user_prompt');
  assert.equal(snap.events[0].content, 'Design the unified prompt bar');
  assert.equal(snap.events[1].type, 'ifz_plan');
  assert.match(snap.events[1].content, /DRY-RUN PREVIEW/);
});

test('ifz-work-model: stopActiveRun halts execution and appends cancellation event deterministically', () => {
  const fixedTime = 1776556900000;
  const customId = () => 'cancel-ev-1';

  const model = createIfzWorkModel({
    initialFixture: 'running',
    clock: () => fixedTime,
    idGenerator: customId
  });
  assert.equal(model.getSnapshot().status, 'running');

  const stopped = model.stopActiveRun();
  assert.equal(stopped, true);

  const snap = model.getSnapshot();
  assert.notEqual(snap.status, 'running');
  const lastEv = snap.events[snap.events.length - 1];
  assert.equal(lastEv.type, 'cancellation');
  assert.equal(lastEv.id, 'cancel-ev-1');
  assert.equal(lastEv.timestamp, new Date(fixedTime).toISOString());
  assert.match(lastEv.content, /Execution stopped by user/);
});
