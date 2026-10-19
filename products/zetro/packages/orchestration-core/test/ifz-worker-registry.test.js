/**
 * @file test/ifz-worker-registry.test.js
 * Comprehensive unit and adversarial tests for WorkerRegistry (IFZ Unified Architecture).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRegistry } from '../src/ifz/worker-registry.js';
import {
  IfzValidationError,
  IfzConflictError,
  WORKER_AVAILABILITY_STATUSES
} from '../src/ifz/contracts.js';

describe('WorkerRegistry', () => {
  let registry;

  const sampleWorkerA = {
    workerId: 'AGR-1',
    workerType: 'agent',
    adapterId: 'adapter-antigravity',
    projectId: 'zetro-core',
    workspaceId: 'ws-main-01',
    capabilities: {
      effects: ['read', 'write', 'execute'],
      actions: ['read_file', 'edit_file', 'run_tests'],
      contextTypes: ['project_context', 'task_package'],
      canDelegate: true,
      supportsCancellation: true,
      supportsResume: false
    },
    observation: {
      status: 'available',
      observedAt: 1713000000000
    },
    qualification: {
      roles: ['agent', 'core_builder'],
      certifications: ['ifz_level_1'],
      tags: ['primary', 'core', 'orchestrator'],
      level: 'senior'
    }
  };

  const sampleWorkerB = {
    workerId: 'COD-1',
    workerType: 'cli',
    adapterId: 'adapter-claude',
    projectId: 'zetro-core',
    workspaceId: 'ws-main-02',
    capabilities: {
      effects: ['read', 'inference'],
      actions: ['read_file', 'summarize'],
      contextTypes: ['project_context'],
      canDelegate: false,
      supportsCancellation: true,
      supportsResume: true
    },
    observation: {
      status: 'idle',
      observedAt: 1713000001000
    },
    qualification: {
      roles: ['cli_worker'],
      certifications: ['claude_v1'],
      tags: ['inference', 'summarizer'],
      level: 'standard'
    }
  };

  const sampleWorkerC = {
    workerId: 'REV-1',
    workerType: 'service',
    adapterId: 'adapter-github',
    projectId: 'zetro-other',
    workspaceId: 'ws-secondary',
    capabilities: {
      effects: ['read', 'external-send'],
      actions: ['read_file', 'post_review'],
      contextTypes: ['task_package'],
      canDelegate: false,
      supportsCancellation: false,
      supportsResume: false
    },
    observation: {
      status: 'busy',
      observedAt: 1713000002000
    },
    qualification: {
      roles: ['reviewer'],
      certifications: ['github_app'],
      tags: ['external', 'review'],
      level: 'verified'
    }
  };

  beforeEach(() => {
    registry = new WorkerRegistry();
  });

  describe('1. Registration', () => {
    it('registers a valid worker manifest and returns deeply frozen copy', () => {
      const registered = registry.register(sampleWorkerA);

      assert.equal(registered.workerId, 'AGR-1');
      assert.equal(registered.revision, 1);
      assert.ok(Object.isFrozen(registered));
      assert.ok(Object.isFrozen(registered.capabilities));
      assert.ok(Object.isFrozen(registered.capabilities.effects));
      assert.equal(registry.count(), 1);
      assert.equal(registry.has('AGR-1'), true);
    });

    it('rejects duplicate workerId registration with IfzConflictError', () => {
      registry.register(sampleWorkerA);

      assert.throws(
        () => registry.register(sampleWorkerA),
        (err) => {
          assert.ok(err instanceof IfzConflictError);
          assert.match(err.message, /already registered/);
          assert.equal(err.details.workerId, 'AGR-1');
          return true;
        }
      );
    });

    it('rejects invalid worker manifest with IfzValidationError', () => {
      assert.throws(
        () => registry.register({ workerId: '' }),
        IfzValidationError
      );

      assert.throws(
        () => registry.register({ ...sampleWorkerA, capabilities: { ...sampleWorkerA.capabilities, canDelegate: 'yes' } }),
        IfzValidationError
      );
    });
  });

  describe('2. Concurrency Control (replace by exact revision)', () => {
    it('replaces worker manifest when exactPreviousRevision matches', () => {
      registry.register(sampleWorkerA);

      const updatedWorker = {
        ...sampleWorkerA,
        revision: 2,
        capabilities: {
          ...sampleWorkerA.capabilities,
          effects: ['read', 'write', 'execute', 'computer']
        }
      };

      const replaced = registry.replace(updatedWorker, 1);
      assert.equal(replaced.workerId, 'AGR-1');
      assert.equal(replaced.revision, 2);
      assert.deepEqual(replaced.capabilities.effects, ['read', 'write', 'execute', 'computer']);

      const retrieved = registry.get('AGR-1');
      assert.equal(retrieved.revision, 2);
      assert.deepEqual(retrieved.capabilities.effects, ['read', 'write', 'execute', 'computer']);
    });

    it('rejects replacement when revision does not match exactPreviousRevision', () => {
      registry.register(sampleWorkerA);

      const updatedWorker = {
        ...sampleWorkerA,
        revision: 3
      };

      assert.throws(
        () => registry.replace(updatedWorker, 2),
        (err) => {
          assert.ok(err instanceof IfzConflictError);
          assert.match(err.message, /Revision conflict/);
          assert.equal(err.details.expectedRevision, 2);
          assert.equal(err.details.currentRevision, 1);
          return true;
        }
      );
    });

    it('rejects replacement when new revision is not strictly greater than previous revision', () => {
      registry.register(sampleWorkerA);

      const sameRevisionWorker = {
        ...sampleWorkerA,
        revision: 1
      };

      assert.throws(
        () => registry.replace(sameRevisionWorker, 1),
        (err) => {
          assert.ok(err instanceof IfzValidationError);
          assert.match(err.message, /must be strictly greater than previous revision/);
          return true;
        }
      );
    });

    it('rejects replacement for unregistered worker', () => {
      const updated = { ...sampleWorkerA, revision: 2 };
      assert.throws(
        () => registry.replace(updated, 1),
        (err) => {
          assert.ok(err instanceof IfzValidationError);
          assert.match(err.message, /not registered/);
          return true;
        }
      );
    });

    it('rejects invalid exactPreviousRevision parameter', () => {
      registry.register(sampleWorkerA);
      const updated = { ...sampleWorkerA, revision: 2 };

      assert.throws(
        () => registry.replace(updated, 0),
        IfzValidationError
      );
      assert.throws(
        () => registry.replace(updated, '1'),
        IfzValidationError
      );
    });
  });

  describe('3. Read and Lookup Operations', () => {
    it('get returns deep-frozen copy or null if absent', () => {
      registry.register(sampleWorkerA);

      const worker = registry.get('AGR-1');
      assert.ok(worker);
      assert.equal(worker.workerId, 'AGR-1');
      assert.ok(Object.isFrozen(worker));

      assert.equal(registry.get('NON_EXISTENT'), null);
      assert.equal(registry.get(null), null);
      assert.equal(registry.get(123), null);
    });

    it('has checks registration presence correctly', () => {
      registry.register(sampleWorkerA);

      assert.equal(registry.has('AGR-1'), true);
      assert.equal(registry.has('NON_EXISTENT'), false);
      assert.equal(registry.has(''), false);
      assert.equal(registry.has(null), false);
    });

    it('count returns exact number of registered workers', () => {
      assert.equal(registry.count(), 0);
      registry.register(sampleWorkerA);
      assert.equal(registry.count(), 1);
      registry.register(sampleWorkerB);
      assert.equal(registry.count(), 2);
    });

    it('unregister removes registered worker and adjusts count', () => {
      registry.register(sampleWorkerA);
      registry.register(sampleWorkerB);

      assert.equal(registry.unregister('AGR-1'), true);
      assert.equal(registry.has('AGR-1'), false);
      assert.equal(registry.count(), 1);
      assert.equal(registry.unregister('AGR-1'), false);
      assert.equal(registry.unregister(123), false);
    });
  });

  describe('4. List and Filtering', () => {
    beforeEach(() => {
      registry.register(sampleWorkerA);
      registry.register(sampleWorkerB);
      registry.register(sampleWorkerC);
    });

    it('lists all workers when no filter is provided', () => {
      const all = registry.list();
      assert.equal(all.length, 3);
      assert.deepEqual(all.map(w => w.workerId).sort(), ['AGR-1', 'COD-1', 'REV-1']);
      all.forEach(w => assert.ok(Object.isFrozen(w)));
    });

    it('filters by workerType and adapterId', () => {
      const agents = registry.list({ workerType: 'agent' });
      assert.equal(agents.length, 1);
      assert.equal(agents[0].workerId, 'AGR-1');

      const cli = registry.list({ workerType: 'cli' });
      assert.equal(cli.length, 1);
      assert.equal(cli[0].workerId, 'COD-1');

      const gh = registry.list({ adapterId: 'adapter-github' });
      assert.equal(gh.length, 1);
      assert.equal(gh[0].workerId, 'REV-1');
    });

    it('filters by projectId and workspaceId', () => {
      const projCore = registry.list({ projectId: 'zetro-core' });
      assert.equal(projCore.length, 2);

      const wsMain1 = registry.list({ workspaceId: 'ws-main-01' });
      assert.equal(wsMain1.length, 1);
      assert.equal(wsMain1[0].workerId, 'AGR-1');
    });

    it('filters by availabilityStatus', () => {
      const busy = registry.list({ availabilityStatus: 'busy' });
      assert.equal(busy.length, 1);
      assert.equal(busy[0].workerId, 'REV-1');

      const idle = registry.list({ availabilityStatus: 'idle' });
      assert.equal(idle.length, 1);
      assert.equal(idle[0].workerId, 'COD-1');
    });

    it('filters by hasEffect', () => {
      const writers = registry.list({ hasEffect: 'write' });
      assert.equal(writers.length, 1);
      assert.equal(writers[0].workerId, 'AGR-1');

      const readers = registry.list({ hasEffect: 'read' });
      assert.equal(readers.length, 3);

      const computers = registry.list({ hasEffect: 'computer' });
      assert.equal(computers.length, 0);
    });

    it('filters by qualification (string, array, and object)', () => {
      const senior = registry.list({ qualification: 'senior' });
      assert.equal(senior.length, 1);
      assert.equal(senior[0].workerId, 'AGR-1');

      const summarizer = registry.list({ qualification: 'summarizer' });
      assert.equal(summarizer.length, 1);
      assert.equal(summarizer[0].workerId, 'COD-1');

      const multiTag = registry.list({ qualification: ['primary', 'core'] });
      assert.equal(multiTag.length, 1);
      assert.equal(multiTag[0].workerId, 'AGR-1');

      const objFilter = registry.list({
        qualification: { roles: ['reviewer'], certifications: ['github_app'] }
      });
      assert.equal(objFilter.length, 1);
      assert.equal(objFilter[0].workerId, 'REV-1');
    });

    it('filters by observation freshness', () => {
      // sampleWorkerA observed at 1713000000000
      // sampleWorkerB observed at 1713000001000
      // sampleWorkerC observed at 1713000002000
      const testNow = 1713000002500;

      // Max age 1000ms: only REV-1 (500ms ago) should qualify
      const fresh1s = registry.list({ maxAgeMs: 1000, now: testNow });
      assert.equal(fresh1s.length, 1);
      assert.equal(fresh1s[0].workerId, 'REV-1');

      // Max age 2000ms: REV-1 (500ms ago) and COD-1 (1500ms ago) qualify
      const fresh2s = registry.list({ maxAgeMs: 2000, now: testNow });
      assert.equal(fresh2s.length, 2);
      assert.deepEqual(fresh2s.map(w => w.workerId).sort(), ['COD-1', 'REV-1']);

      // Max age 5000ms: all three qualify
      const fresh5s = registry.list({ maxAgeMs: 5000, now: testNow });
      assert.equal(fresh5s.length, 3);
    });
  });

  describe('5. Capability Querying with Project, Workspace, and Freshness', () => {
    beforeEach(() => {
      registry.register(sampleWorkerA);
      registry.register(sampleWorkerB);
      registry.register(sampleWorkerC);
    });

    it('queries by subset of effects, projectId, and workspaceId', () => {
      const readAndWrite = registry.queryCapabilities({
        projectId: 'zetro-core',
        workspaceId: 'ws-main-01',
        effects: ['read', 'write']
      });
      assert.equal(readAndWrite.length, 1);
      assert.equal(readAndWrite[0].workerId, 'AGR-1');

      const wrongWorkspace = registry.queryCapabilities({
        projectId: 'zetro-core',
        workspaceId: 'ws-other',
        effects: ['read']
      });
      assert.equal(wrongWorkspace.length, 0);
    });

    it('queries by actions, contextTypes, and delegation', () => {
      const summarize = registry.queryCapabilities({ actions: ['summarize'] });
      assert.equal(summarize.length, 1);
      assert.equal(summarize[0].workerId, 'COD-1');

      const taskPkg = registry.queryCapabilities({ contextTypes: ['task_package'] });
      assert.equal(taskPkg.length, 2);

      const delegates = registry.queryCapabilities({ canDelegate: true });
      assert.equal(delegates.length, 1);
      assert.equal(delegates[0].workerId, 'AGR-1');
    });

    it('enforces qualification and freshness in queryCapabilities', () => {
      const res = registry.queryCapabilities({
        effects: ['read'],
        qualification: 'senior',
        maxAgeMs: 3000,
        now: 1713000002000
      });
      assert.equal(res.length, 1);
      assert.equal(res[0].workerId, 'AGR-1');

      const staleRes = registry.queryCapabilities({
        effects: ['read'],
        qualification: 'senior',
        maxAgeMs: 500, // 2000ms ago is too stale
        now: 1713000002000
      });
      assert.equal(staleRes.length, 0);
    });
  });

  describe('6. Honest Availability Projections', () => {
    beforeEach(() => {
      registry.register(sampleWorkerA);
      registry.register(sampleWorkerB);
      registry.register(sampleWorkerC);
    });

    it('projects availability with observation timestamp and explicit impliesCompletion: false', () => {
      const avail = registry.getAvailability('AGR-1');

      assert.equal(avail.workerId, 'AGR-1');
      assert.equal(avail.status, 'available');
      assert.equal(avail.observedAt, 1713000000000);
      assert.equal(avail.isAvailable, true);
      assert.equal(avail.canAcceptTask, true);
      assert.equal(avail.impliesCompletion, false);
      assert.ok(Object.isFrozen(avail));
    });

    it('updates worker availability with timestamp and synchronizes observation', () => {
      const updated = registry.updateAvailability('AGR-1', {
        status: 'busy',
        observedAt: 1713000050000
      });

      assert.equal(updated.workerId, 'AGR-1');
      assert.equal(updated.status, 'busy');
      assert.equal(updated.observedAt, 1713000050000);
      assert.equal(updated.isAvailable, false);
      assert.equal(updated.canAcceptTask, false);
      assert.equal(updated.impliesCompletion, false);

      const worker = registry.get('AGR-1');
      assert.equal(worker.observation.status, 'busy');
      assert.equal(worker.observation.observedAt, 1713000050000);
      assert.equal(worker.availability.status, 'busy');
    });

    it('rejects status that implies task completion', () => {
      assert.throws(
        () => registry.updateAvailability('AGR-1', { status: 'completed' }),
        (err) => err instanceof IfzValidationError && err.message.includes('task completion cannot be implied')
      );

      assert.throws(
        () => registry.updateAvailability('AGR-1', { status: 'finished' }),
        IfzValidationError
      );
    });
  });

  describe('7. Adversarial Registrations & Immutability', () => {
    it('rejects registration of non-plain objects, accessors, or cycles', () => {
      class CustomWorker {
        workerId = 'CUST-1';
      }

      assert.throws(
        () => registry.register(new CustomWorker()),
        (err) => err instanceof IfzValidationError && err.message.includes('Non-plain object detected')
      );

      const accessorWorker = {
        ...sampleWorkerA,
        get workerId() {
          return 'TRICK';
        }
      };

      assert.throws(
        () => registry.register(accessorWorker),
        (err) => err instanceof IfzValidationError && err.message.includes('Property accessor')
      );

      const cyclicWorker = { ...sampleWorkerA };
      cyclicWorker.self = cyclicWorker;

      assert.throws(
        () => registry.register(cyclicWorker),
        (err) => err instanceof IfzValidationError && err.message.includes('Circular reference detected')
      );
    });

    it('mutating input manifest after registration does not alter registry state', () => {
      const input = {
        ...sampleWorkerA,
        capabilities: {
          ...sampleWorkerA.capabilities,
          effects: ['read', 'write']
        }
      };

      registry.register(input);

      input.capabilities.effects.push('computer');
      input.workerId = 'MUTATED';

      const fromRegistry = registry.get('AGR-1');
      assert.deepEqual(fromRegistry.capabilities.effects, ['read', 'write']);
      assert.equal(registry.has('MUTATED'), false);
    });

    it('returned manifests and availability projections are frozen', () => {
      const registered = registry.register(sampleWorkerA);

      assert.throws(() => {
        registered.workerId = 'MUTATED';
      }, TypeError);

      assert.throws(() => {
        registered.capabilities.effects.push('computer');
      }, TypeError);

      const avail = registry.getAvailability('AGR-1');
      assert.throws(() => {
        avail.status = 'busy';
      }, TypeError);
    });
  });
});
