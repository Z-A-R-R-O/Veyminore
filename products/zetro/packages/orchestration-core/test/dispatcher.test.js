import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dispatcher } from '../src/dispatcher.js';
import { States, Bounds } from '../src/types.js';

async function createTestJournal(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zetro-dispatch-test-'));
  const journalPath = join(dir, 'test-journal.jsonl');
  if (t && typeof t.after === 'function') {
    t.after(async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  }
  return { dir, journalPath };
}

function createDummyAdapter(delayMs, receiptState = States.COMPLETED) {
  return {
    execute: async (envelope, signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            id: envelope.id, agent: envelope.agent, state: receiptState,
            changedFiles: [], checks: [], evidenceRefs: [],
            summary: 'Done', uncertainty: 'None'
          });
        }, delayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  };
}

function validEnvelope(id) {
  return {
    id, agent: 'agent1', objective: 'test',
    contextRefs: [], allowedPaths: [], acceptance: '', verification: '',
    deadlineMs: 1000,
    budget: { maxContextChars: 100, maxReplyChars: 100 }
  };
}

test('Validation failure: budget bounds', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();

  const badEnv = validEnvelope('bad');
  badEnv.budget.maxContextChars = -1;
  await assert.rejects(d.submit(badEnv), /invalid bounds/);

  const zeroEnv = validEnvelope('zero');
  zeroEnv.budget.maxReplyChars = 0;
  await assert.rejects(d.submit(zeroEnv), /invalid bounds/);

  const infEnv = validEnvelope('inf');
  infEnv.budget.maxContextChars = Infinity;
  await assert.rejects(d.submit(infEnv), /invalid bounds/);

  const hugeEnv = validEnvelope('huge');
  hugeEnv.budget.maxContextChars = Bounds.MAX_BUDGET_CHARS + 1;
  await assert.rejects(d.submit(hugeEnv), /invalid bounds/);
});

test('Validation failure: invalid or unbounded deadline values', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();

  const envZero = validEnvelope('env_zero');
  envZero.deadlineMs = 0;
  await assert.rejects(d.submit(envZero), /deadlineMs missing or invalid bounds/);

  const envNeg = validEnvelope('env_neg');
  envNeg.deadlineMs = -50;
  await assert.rejects(d.submit(envNeg), /deadlineMs missing or invalid bounds/);

  const envInf = validEnvelope('env_inf');
  envInf.deadlineMs = Infinity;
  await assert.rejects(d.submit(envInf), /deadlineMs missing or invalid bounds/);

  const envNaN = validEnvelope('env_nan');
  envNaN.deadlineMs = NaN;
  await assert.rejects(d.submit(envNaN), /deadlineMs missing or invalid bounds/);

  const envFloat = validEnvelope('env_float');
  envFloat.deadlineMs = 50.5;
  await assert.rejects(d.submit(envFloat), /deadlineMs missing or invalid bounds/);

  const envUnbounded = validEnvelope('env_unbounded');
  envUnbounded.deadlineMs = Bounds.MAX_DEADLINE_MS + 1;
  await assert.rejects(d.submit(envUnbounded), /deadlineMs missing or invalid bounds/);

  const envString = validEnvelope('env_str');
  envString.deadlineMs = '1000';
  await assert.rejects(d.submit(envString), /missing required fields/);
});

test('Validation failure: envelope bounds and types', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();

  await assert.rejects(d.submit(null), /missing required fields/);
  await assert.rejects(d.submit([]), /missing required fields/);
  await assert.rejects(d.submit('not an envelope'), /missing required fields/);

  const envEmptyId = validEnvelope('');
  await assert.rejects(d.submit(envEmptyId), /missing required fields/);

  const envWhitespaceId = validEnvelope('   ');
  await assert.rejects(d.submit(envWhitespaceId), /missing required fields/);

  const envLongId = validEnvelope('x'.repeat(Bounds.MAX_ID_CHARS + 1));
  await assert.rejects(d.submit(envLongId), /field length exceeds allowed bounds/);

  const envLongAgent = validEnvelope('agent_long');
  envLongAgent.agent = 'a'.repeat(Bounds.MAX_STRING_CHARS + 1);
  await assert.rejects(d.submit(envLongAgent), /field length exceeds allowed bounds/);

  const envLongObj = validEnvelope('obj_long');
  envLongObj.objective = 'o'.repeat(Bounds.MAX_OBJECTIVE_CHARS + 1);
  await assert.rejects(d.submit(envLongObj), /field length exceeds allowed bounds/);

  const envBadContext = validEnvelope('bad_context');
  envBadContext.contextRefs = 'not-an-array';
  await assert.rejects(d.submit(envBadContext), /contextRefs\/allowedPaths must be arrays/);

  const envBadContextItems = validEnvelope('bad_context_items');
  envBadContextItems.contextRefs = [123];
  await assert.rejects(d.submit(envBadContextItems), /contextRef items must be strings/);

  const envBadPaths = validEnvelope('bad_paths');
  envBadPaths.allowedPaths = [null];
  await assert.rejects(d.submit(envBadPaths), /allowedPath items must be strings/);

  const envBadAcceptance = validEnvelope('bad_acc');
  envBadAcceptance.acceptance = 123;
  await assert.rejects(d.submit(envBadAcceptance), /acceptance\/verification must be strings/);
});

test('Duplicate Task ID: sequential and concurrent', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(20), journalPath);
  await d.init();

  await d.submit(validEnvelope('dup1'));
  await assert.rejects(d.submit(validEnvelope('dup1')), /Duplicate Task ID: dup1/);
  await d.drain();

  // Even after completion, cannot submit task with same ID
  await assert.rejects(d.submit(validEnvelope('dup1')), /Duplicate Task ID: dup1/);

  // Concurrent submission with same ID
  const results = await Promise.allSettled([
    d.submit(validEnvelope('concurrent_dup')),
    d.submit(validEnvelope('concurrent_dup'))
  ]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Exactly one concurrent submission succeeds');
  assert.equal(rejected.length, 1, 'Exactly one concurrent submission is rejected');
  assert.match(rejected[0].reason.message, /Duplicate Task ID: concurrent_dup/);

  await d.drain();
});

test('Dispatcher basic flow', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();
  await d.submit(validEnvelope('task1'));
  await d.drain();
  assert.equal(d.getState('task1'), States.COMPLETED);
});

test('Cancellation of queued task', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(100), journalPath);
  await d.init();
  await d.submit(validEnvelope('cancel_me'));
  const cancelled = await d.cancel('cancel_me');
  assert.equal(cancelled, true);
  await d.drain();
  assert.equal(d.getState('cancel_me'), States.CANCELLED);
});

test('Cancellation during active execution', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let adapterStarted;
  const startedPromise = new Promise(r => { adapterStarted = r; });
  let abortFired = false;
  const adapter = {
    execute: async (env, signal) => {
      adapterStarted();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ id: env.id, agent: env.agent, state: States.COMPLETED });
        }, 100);
        signal.addEventListener('abort', () => {
          abortFired = true;
          clearTimeout(timer);
          reject(new Error('AbortError'));
        });
      });
    }
  };

  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('active_cancel'));

  await startedPromise;
  assert.equal(d.getState('active_cancel'), States.RUNNING);

  const cancelled = await d.cancel('active_cancel');
  assert.equal(cancelled, true);
  assert.equal(d.getState('active_cancel'), States.CANCELLED);

  await d.drain();
  assert.equal(abortFired, true);
  assert.equal(d.getState('active_cancel'), States.CANCELLED);
});

test('Late successful adapter return after cancellation never overwrites CANCELLED', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let adapterStarted;
  const startedPromise = new Promise(r => { adapterStarted = r; });
  let adapterFinished = false;
  const adapter = {
    execute: async (env, signal) => {
      adapterStarted();
      // Intentionally ignore abort signal and complete after a delay
      return new Promise((resolve) => {
        setTimeout(() => {
          adapterFinished = true;
          resolve({
            id: env.id,
            agent: env.agent,
            state: States.COMPLETED,
            changedFiles: ['file.txt'],
            checks: ['pass'],
            evidenceRefs: [],
            summary: 'Late success',
            uncertainty: 'None'
          });
        }, 30);
      });
    }
  };

  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('late_success'));

  await startedPromise;
  assert.equal(d.getState('late_success'), States.RUNNING);

  // Cancel while adapter is running
  const cancelled = await d.cancel('late_success');
  assert.equal(cancelled, true);
  assert.equal(d.getState('late_success'), States.CANCELLED);

  // Drain and wait for adapter to finish its late resolution
  await d.drain();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(adapterFinished, true);

  // State MUST remain CANCELLED, not overwritten by COMPLETED!
  assert.equal(d.getState('late_success'), States.CANCELLED);

  // Verify journal does not contain a COMPLETED transition
  const journalContent = await readFile(journalPath, 'utf8');
  assert.doesNotMatch(journalContent, /"state":"COMPLETED"/);
  assert.match(journalContent, /"state":"CANCELLED"/);
});

test('Late failed adapter return after cancellation never overwrites CANCELLED', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let adapterStarted;
  const startedPromise = new Promise(r => { adapterStarted = r; });
  let adapterFailed = false;
  const adapter = {
    execute: async (env) => {
      adapterStarted();
      return new Promise((_, reject) => {
        setTimeout(() => {
          adapterFailed = true;
          reject(new Error('Late network drop'));
        }, 30);
      });
    }
  };

  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('late_fail'));

  await startedPromise;
  assert.equal(d.getState('late_fail'), States.RUNNING);

  const cancelled = await d.cancel('late_fail');
  assert.equal(cancelled, true);
  assert.equal(d.getState('late_fail'), States.CANCELLED);

  await d.drain();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(adapterFailed, true);

  assert.equal(d.getState('late_fail'), States.CANCELLED);
});

test('Terminal state immutability: cancel returns false on terminal states', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();

  await d.submit(validEnvelope('term1'));
  await d.drain();
  assert.equal(d.getState('term1'), States.COMPLETED);

  // Attempting to cancel an already completed task must return false
  const cancelResult = await d.cancel('term1');
  assert.equal(cancelResult, false);
  assert.equal(d.getState('term1'), States.COMPLETED);

  // Cancel non-existent task
  assert.equal(await d.cancel('non_existent'), false);
});

test('Deadline exceeded is UNKNOWN', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(200), journalPath);
  await d.init();
  const env = validEnvelope('timeout');
  env.deadlineMs = 50;
  await d.submit(env);
  await d.drain();
  assert.equal(d.getState('timeout'), States.UNKNOWN);
});

test('Deadline race: adapter completes right after deadline fires does not overwrite UNKNOWN', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let adapterCompleted = false;
  const adapter = {
    execute: async (env) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          adapterCompleted = true;
          resolve({
            id: env.id,
            agent: env.agent,
            state: States.COMPLETED,
            changedFiles: [],
            checks: [],
            evidenceRefs: [],
            summary: 'Too late',
            uncertainty: 'None'
          });
        }, 50);
      });
    }
  };

  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  const env = validEnvelope('deadline_race');
  env.deadlineMs = 20;
  await d.submit(env);
  await d.drain();

  assert.equal(d.getState('deadline_race'), States.UNKNOWN);

  // Wait for late adapter resolution
  await new Promise(r => setTimeout(r, 40));
  assert.equal(adapterCompleted, true);

  // Outcome must remain UNKNOWN
  assert.equal(d.getState('deadline_race'), States.UNKNOWN);
});

test('Crash-after-send replay', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let d = new Dispatcher(createDummyAdapter(100), journalPath);
  await d.init();
  await d.submit(validEnvelope('persist1'));
  await new Promise(r => setTimeout(r, 20));

  let d2 = new Dispatcher(createDummyAdapter(10), journalPath);
  await d2.init();
  assert.equal(d2.getState('persist1'), States.UNKNOWN);
});

test('Preserve unknown outcomes and never automatically resend uncertain work', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let d1 = new Dispatcher(createDummyAdapter(100), journalPath);
  await d1.init();
  await d1.submit(validEnvelope('crash_task'));
  // Let it start running
  await new Promise(r => setTimeout(r, 15));
  assert.equal(d1.getState('crash_task'), States.RUNNING);

  // Simulate process crash and restart
  let executionsCount = 0;
  const countingAdapter = {
    execute: async (env) => {
      executionsCount++;
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };

  let d2 = new Dispatcher(countingAdapter, journalPath);
  await d2.init();

  // Task MUST be reconciled to UNKNOWN
  assert.equal(d2.getState('crash_task'), States.UNKNOWN);

  // Queue MUST be empty - UNKNOWN tasks are never automatically resent!
  assert.equal(d2.queue.length, 0);

  // Draining d2 should not trigger any execution
  await d2.drain();
  assert.equal(executionsCount, 0, 'No automatic re-send of uncertain work');

  // Attempting to resubmit the same ID should be rejected as duplicate
  await assert.rejects(d2.submit(validEnvelope('crash_task')), /Duplicate Task ID/);
});

test('Submitted != Completed', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10, States.SUBMITTED), journalPath);
  await d.init();
  await d.submit(validEnvelope('sub1'));
  await d.drain();
  assert.equal(d.getState('sub1'), States.SUBMITTED);
});

test('Race condition: Cancel immediately after submit', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let executed = false;
  const adapter = {
    execute: async (env) => {
      executed = true;
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();

  const env = validEnvelope('race');
  await d.submit(env);
  await d.cancel('race');
  await d.drain();

  assert.equal(d.getState('race'), States.CANCELLED);
  assert.equal(executed, false, 'Adapter should not execute');
});

test('Invalid receipt identity/state', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const adapter = {
    execute: async (env) => ({ id: 'wrong_id', agent: env.agent, state: States.COMPLETED })
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('bad_rec_id'));
  await d.drain();
  assert.equal(d.getState('bad_rec_id'), States.FAILED);
});

test('Invalid receipt agent', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const adapter = {
    execute: async (env) => ({ id: env.id, agent: 'wrong_agent', state: States.COMPLETED })
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('bad_rec_agent'));
  await d.drain();
  assert.equal(d.getState('bad_rec_agent'), States.FAILED);
});

test('processQueue error handling leaves safe state', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const adapter = {
    execute: async () => { throw new Error('Adapter crash'); }
  };
  const d = new Dispatcher(adapter, journalPath);
  await d.init();
  await d.submit(validEnvelope('crash'));
  await d.drain();
  assert.equal(d.getState('crash'), States.FAILED);
  assert.equal(d.isProcessing, false);
});

test('Cancellation during delayed RUNNING append', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(50), journalPath);
  await d.init();

  const origAppend = d.journal.append.bind(d.journal);
  d.journal.append = async (event) => {
    if (event.payload?.state === States.RUNNING) {
      await new Promise(r => setTimeout(r, 30));
    }
    return origAppend(event);
  };

  await d.submit(validEnvelope('delay_cancel'));
  await new Promise(r => setTimeout(r, 5));

  await d.cancel('delay_cancel');
  await d.drain();

  assert.equal(d.getState('delay_cancel'), States.CANCELLED);
});

test('Journal durability: corrupt and truncated lines recovered safely', async (t) => {
  const { journalPath } = await createTestJournal(t);
  // 1. Create a journal with valid events followed by a truncated crash artifact
  const d1 = new Dispatcher(createDummyAdapter(10), journalPath);
  await d1.init();
  await d1.submit(validEnvelope('valid1'));
  await d1.drain();
  assert.equal(d1.getState('valid1'), States.COMPLETED);

  // Append a corrupt/truncated JSON line simulating crash during append
  await appendFile(journalPath, '{"type":"SUBMIT","payload":{"id":"truncated_task"\n');

  // 2. Restart and initialize Dispatcher
  const d2 = new Dispatcher(createDummyAdapter(10), journalPath);
  await d2.init();

  // Valid prior task must be fully recovered
  assert.equal(d2.getState('valid1'), States.COMPLETED);

  // Corrupt record must be captured in corruptLines without crashing init
  assert.equal(d2.journal.corruptLines.length, 1);
  assert.match(d2.journal.corruptLines[0].raw, /truncated_task/);
});

test('Journal durability: unavailable storage on submit cleans up pending reservation', async (t) => {
  const { journalPath } = await createTestJournal(t);
  const d = new Dispatcher(createDummyAdapter(10), journalPath);
  await d.init();

  // Simulate storage failure
  const originalAppend = d.journal.append.bind(d.journal);
  d.journal.append = async () => {
    throw new Error('ENOSPC: no space left on device');
  };

  await assert.rejects(
    d.submit(validEnvelope('storage_fail')),
    /no space left on device/
  );

  // Verify task ID was not left in stateMap
  assert.equal(d.getState('storage_fail'), undefined);

  // Restore storage and retry submission
  d.journal.append = originalAppend;
  await d.submit(validEnvelope('storage_fail'));
  await d.drain();
  assert.equal(d.getState('storage_fail'), States.COMPLETED);
});

// REWORK FOCUSED REGRESSION TESTS: W1R-AGR3-recovery

test('valid-SUBMIT/corrupt-RUNNING', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let executionCount = 0;
  const adapter = {
    execute: async (env) => {
      executionCount++;
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };

  // 1. Manually write a valid SUBMIT followed by a corrupt RUNNING transition
  const validSubmit = JSON.stringify({
    type: 'SUBMIT',
    payload: validEnvelope('task_corrupt_running'),
    timestamp: Date.now()
  });
  // Corrupt line representing an interrupted/torn write of a RUNNING transition
  const corruptRunning = '{"type":"TRANSITION","payload":{"id":"task_corrupt_running","state":"RUN';

  await appendFile(journalPath, validSubmit + '\n' + corruptRunning + '\n');

  // 2. Initialize Dispatcher
  const d = new Dispatcher(adapter, journalPath);
  await d.init();

  // The task MUST NOT be left as PENDING; it must be reconciled to UNKNOWN
  assert.equal(d.getState('task_corrupt_running'), States.UNKNOWN);

  // Queue must be empty - must NEVER replay this submission
  assert.equal(d.queue.length, 0);

  // Draining should result in 0 adapter executions
  await d.drain();
  assert.equal(executionCount, 0, 'Must never automatically resend task after corrupt RUNNING transition');

  // Verify diagnostic evidence preserved
  assert.equal(d.journal.corruptLines.length, 1);
  assert.ok(d.journal.quarantinePath, 'Quarantine snapshot must be recorded');
});

test('corrupted-middle-record', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let executedIds = [];
  const adapter = {
    execute: async (env) => {
      executedIds.push(env.id);
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };

  // Journal with valid task1, a corrupt middle record, and valid task2 that already completed
  const event1 = JSON.stringify({ type: 'SUBMIT', payload: validEnvelope('t1'), timestamp: Date.now() });
  const event2 = JSON.stringify({ type: 'TRANSITION', payload: { id: 't1', state: States.COMPLETED }, timestamp: Date.now() });
  const corruptMiddle = '{"CORRUPTED_MIDDLE_RECORD_GARBAGE';
  const event3 = JSON.stringify({ type: 'SUBMIT', payload: validEnvelope('t2'), timestamp: Date.now() });
  const event4 = JSON.stringify({ type: 'TRANSITION', payload: { id: 't2', state: States.COMPLETED }, timestamp: Date.now() });

  await appendFile(journalPath, [event1, event2, corruptMiddle, event3, event4].join('\n') + '\n');

  const d = new Dispatcher(adapter, journalPath);
  await d.init();

  // Completed tasks remain completed
  assert.equal(d.getState('t1'), States.COMPLETED);
  assert.equal(d.getState('t2'), States.COMPLETED);

  // Corrupted middle line diagnostic evidence preserved and quarantined
  assert.equal(d.journal.corruptLines.length, 1);
  assert.equal(d.journal.corruptLines[0].lineIndex, 2);
  assert.ok(d.journal.quarantinePath, 'Corrupted middle record triggers quarantine');

  // No pending work to execute
  await d.drain();
  assert.equal(executedIds.length, 0);
});

test('truncated-tail/append/second-restart', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let executedIds = [];
  const adapter = {
    execute: async (env) => {
      executedIds.push(env.id);
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };

  // Write a valid task, then an unterminated/truncated fragment without trailing newline
  const validEvent = JSON.stringify({
    type: 'SUBMIT',
    payload: validEnvelope('t_init'),
    timestamp: Date.now()
  }) + '\n';
  const truncatedFragment = '{"type":"TRANSITION","payload":{"id":"t_init","state":"RUN'; // NO newline!

  await appendFile(journalPath, validEvent + truncatedFragment);

  // 1. First initialization: framing must be repaired before any append
  const d1 = new Dispatcher(adapter, journalPath);
  await d1.init();

  // Append new task while previous truncated fragment was on disk
  await d1.submit(validEnvelope('t_new'));
  await d1.drain();

  assert.equal(d1.getState('t_new'), States.COMPLETED);
  assert.ok(executedIds.includes('t_new'));

  // 2. Second restart: read the journal again from scratch
  const d2 = new Dispatcher(adapter, journalPath);
  await d2.init();

  // t_new must be cleanly parsed and resolved to COMPLETED, NOT corrupted by t_init's tail
  assert.equal(d2.getState('t_new'), States.COMPLETED);
  assert.equal(d2.getState('t_init'), States.UNKNOWN);
});

test('no-resend', async (t) => {
  const { journalPath } = await createTestJournal(t);
  let sendCount = 0;
  const adapter = {
    execute: async (env) => {
      sendCount++;
      return { id: env.id, agent: env.agent, state: States.COMPLETED };
    }
  };

  // Multiple tasks: one clean SUBMIT, but followed by corruption
  const sub1 = JSON.stringify({ type: 'SUBMIT', payload: validEnvelope('no_resend_1'), timestamp: Date.now() });
  const sub2 = JSON.stringify({ type: 'SUBMIT', payload: validEnvelope('no_resend_2'), timestamp: Date.now() });
  const corruptRecord = '{"type":"TRANSITION","incomplete';

  await appendFile(journalPath, [sub1, sub2, corruptRecord].join('\n') + '\n');

  const d = new Dispatcher(adapter, journalPath);
  await d.init();

  // All submissions affected by corruption must transition to UNKNOWN, never remain PENDING
  assert.equal(d.getState('no_resend_1'), States.UNKNOWN);
  assert.equal(d.getState('no_resend_2'), States.UNKNOWN);

  // Queue must be completely empty
  assert.equal(d.queue.length, 0);

  // Drain must not trigger any send calls
  await d.drain();
  assert.equal(sendCount, 0, 'Resend count must be zero after corruption recovery');
});
