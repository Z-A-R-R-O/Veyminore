#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runLifecycleDemo } from './demo.js';
import { RctHost, DEFAULT_WORKER_ID, resolveDbPath } from './rct-host.js';
import { States } from './types.js';

/**
 * Robust zero-dependency argument parser supporting:
 * - Subcommands (e.g. run, status, events, cancel, worker-status, demo, reconcile)
 * - Flags with values (--data-dir <dir>, --data-dir=<dir>)
 * - Positional arguments
 * - Boolean flags (--json, --help, -h)
 *
 * @param {string[]} argv
 * @returns {{ command: string|null, positionals: string[], flags: Record<string, any> }}
 */
export function parseArgs(argv) {
  const result = {
    command: null,
    positionals: [],
    flags: {}
  };

  const booleanFlags = new Set(['json', 'help', 'h']);

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.flags.help = true;
    } else if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        result.flags[key] = val;
      } else {
        const key = arg.slice(2);
        if (booleanFlags.has(key)) {
          result.flags[key] = true;
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          result.flags[key] = argv[i + 1];
          i++;
        } else {
          result.flags[key] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (key === 'h') {
        result.flags.help = true;
      } else {
        result.flags[key] = true;
      }
    } else {
      if (!result.command) {
        result.command = arg;
      } else {
        result.positionals.push(arg);
      }
    }
    i++;
  }
  return result;
}

export function printHelp() {
  console.log(`
ZETRO Orchestration Core CLI - Single-Worker Offline RCT Host

Commands:
  run [envelope]             Execute TaskEnvelope offline on dedicated worker slot (default: RCT-1)
  status [taskId]            Strictly read-only query of task execution state
  events [taskId]            Strictly read-only query of audit event trail
  evidence [taskId]          Strictly read-only query of task evidence and verifier artifacts
  worker-status [workerId]   Strictly read-only query of worker status projection (default: RCT-1)
  cancel [taskId]            Cancel an active or queued task
  reconcile                  Reconcile interrupted in-flight attempts to UNKNOWN
  status-snapshot            Strictly read-only frontend persistence bridge snapshot (--db required)
  demo                       Run complete offline lifecycle demo with derived invariant assertions
                             (supports --data-dir <dir> or --db <path> to retain database upon completion)
  help                       Display this help documentation

Options:
  --data-dir <dir>           Directory storing tasks.db (persistent database retained on exit)
  --db <path>                Direct path to SQLite tasks.db file
  --envelope <path|json>     Task envelope JSON file path or raw JSON string
  --task <id>                Task identifier
  --worker <id>              Worker identifier (default: RCT-1)
  --source-root <path>       Canonical workspace source root
  --patches <json>           JSON array of synthetic patches for offline provider
  --reason <string>          Reason for task cancellation
  --fault=<name>             Inject fault for demo ('corrupt_source' | 'late_snapshot_mutation')
  --json                     Output result in machine-readable JSON format
  -h, --help                 Display this help documentation
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positionals, flags } = parseArgs(argv);

  if (flags.help || command === 'help') {
    printHelp();
    return;
  }

  const effectiveCmd = command || (flags.fault !== undefined || Object.keys(flags).length === 0 ? 'demo' : null);

  if (!effectiveCmd) {
    printHelp();
    process.exit(1);
  }

  switch (effectiveCmd) {
    case 'demo': {
      const injectFault = flags.fault || (typeof flags.fault === 'string' ? flags.fault : null);
      const dataDir = flags['data-dir'] || null;
      const dbPath = flags.db || null;
      const retainDb = Boolean(dataDir || dbPath || flags.retain || flags.persistent);
      try {
        const demoResult = await runLifecycleDemo({
          injectFault,
          dataDir,
          dbPath,
          retainDb,
          silent: Boolean(flags.json)
        });
        if (flags.json) {
          console.log(JSON.stringify(demoResult, null, 2));
        }
      } catch (err) {
        console.error('\n[DEMO INVARIANT FAILURE]');
        console.error(err.message || err);
        process.exit(1);
      }
      break;
    }

    case 'run': {
      const envelopeArg = flags.envelope || positionals[0];
      if (!envelopeArg) {
        throw new Error("TaskEnvelope is required for 'run' (use --envelope <path|json> or pass as argument)");
      }

      let patches;
      if (flags.patches) {
        patches = typeof flags.patches === 'string' ? JSON.parse(flags.patches) : flags.patches;
      }

      const host = new RctHost({
        dataDir: flags['data-dir'],
        dbPath: flags.db,
        workerId: flags.worker,
        sourceRoot: flags['source-root']
      });

      try {
        await host.init();
        const result = await host.runTask(envelopeArg, { patches });
        if (flags.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Task: ${result.id}`);
          console.log(`State: ${result.state}`);
          if (result.error) console.log(`Error: ${result.error}`);
          if (result.uncertainty) console.log(`Uncertainty: ${result.uncertainty}`);
        }
        host.close();
        if (result.state === States.FAILED) {
          process.exit(1);
        }
      } catch (err) {
        host.close();
        throw err;
      }
      break;
    }

    case 'status': {
      const taskId = flags.task || positionals[0];
      if (!taskId) {
        throw new Error("Task ID is required for 'status' (use --task <id> or pass as argument)");
      }
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      const status = await RctHost.getStatus(dbPath, taskId);
      if (!status) {
        if (flags.json) {
          console.error(JSON.stringify({ error: `Task '${taskId}' not found`, found: false }));
        } else {
          console.error(`Task '${taskId}' not found`);
        }
        process.exit(1);
      }
      if (flags.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Task: ${status.id}`);
        console.log(`State: ${status.state}`);
        console.log(`Agent: ${status.agent || 'N/A'}`);
        console.log(`Objective: ${status.objective || 'N/A'}`);
        if (status.latestAttempt) {
          console.log(`Attempt: ${status.latestAttempt.attemptId} (${status.latestAttempt.state})`);
        }
        if (status.uncertainty) console.log(`Uncertainty: ${status.uncertainty}`);
        if (status.error) console.log(`Error: ${status.error}`);
      }
      break;
    }

    case 'events': {
      const taskId = flags.task || positionals[0];
      if (!taskId) {
        throw new Error("Task ID is required for 'events' (use --task <id> or pass as argument)");
      }
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      const events = await RctHost.getEvents(dbPath, taskId);
      if (flags.json) {
        console.log(JSON.stringify(events, null, 2));
      } else {
        console.log(`Audit Events for Task '${taskId}' (${events.length} events):`);
        for (const ev of events) {
          console.log(`  [${ev.timestamp}] ${ev.eventType} (Attempt: ${ev.attemptId || 'N/A'}): ${JSON.stringify(ev.payload)}`);
        }
      }
      break;
    }

    case 'evidence': {
      const taskId = flags.task || positionals[0];
      if (!taskId) {
        throw new Error("Task ID is required for 'evidence' (use --task <id> or pass as argument)");
      }
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      const evidence = await RctHost.getEvidence(dbPath, taskId);
      if (!evidence) {
        if (flags.json) {
          console.error(JSON.stringify({ error: `Task '${taskId}' not found`, found: false }));
        } else {
          console.error(`Task '${taskId}' not found`);
        }
        process.exit(1);
      }
      if (flags.json) {
        console.log(JSON.stringify(evidence, null, 2));
      } else {
        console.log(`Evidence for Task '${taskId}':`);
        console.log(`State: ${evidence.state}`);
        console.log(`Artifacts (${evidence.artifacts.length}):`);
        for (const a of evidence.artifacts) {
          console.log(`  - [${a.artifactType}] ${a.uri || a.hash || ''}`);
        }
      }
      break;
    }

    case 'worker-status': {
      const workerId = flags.worker || positionals[0] || DEFAULT_WORKER_ID;
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      const workerStatus = await RctHost.getWorkerStatus(dbPath, workerId);
      if (flags.json) {
        console.log(JSON.stringify(workerStatus, null, 2));
      } else {
        console.log(`Worker: ${workerStatus.workerId}`);
        console.log(`State: ${workerStatus.state}`);
        console.log(`Task ID: ${workerStatus.taskId || 'None'}`);
        console.log(`Attempt ID: ${workerStatus.attemptId || 'None'}`);
        console.log(`Last Active: ${workerStatus.lastActiveAt || 'None'}`);
      }
      break;
    }

    case 'cancel': {
      const taskId = flags.task || positionals[0];
      if (!taskId) {
        throw new Error("Task ID is required for 'cancel' (use --task <id> or pass as argument)");
      }
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      if (!existsSync(dbPath)) {
        throw new Error(`Database file does not exist: '${dbPath}'`);
      }
      const reason = flags.reason || 'Operator cancellation via CLI';
      const result = await RctHost.cancelTask(dbPath, taskId, { reason });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.cancelled) {
          console.log(`Task '${taskId}' cancelled successfully.`);
        } else {
          console.log(`Task '${taskId}' could not be cancelled: ${result.reason || 'unknown'}`);
        }
      }
      if (!result.cancelled) {
        process.exit(1);
      }
      break;
    }

    case 'reconcile': {
      const dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      if (!existsSync(dbPath)) {
        throw new Error(`Database file does not exist: '${dbPath}'`);
      }
      const host = new RctHost({
        dataDir: flags['data-dir'],
        dbPath: flags.db,
        workerId: flags.worker
      });
      try {
        const { reconciledTaskIds } = await host.reconcile({ force: Boolean(flags.force) });
        host.close();
        if (flags.json) {
          console.log(JSON.stringify({ reconciledTaskIds }, null, 2));
        } else {
          console.log(`Reconciled ${reconciledTaskIds.length} interrupted task(s): ${reconciledTaskIds.join(', ') || 'none'}`);
        }
      } catch (err) {
        host.close();
        throw err;
      }
      break;
    }

    case 'status-snapshot': {
      let dbPath;
      try {
        dbPath = resolveDbPath({ dataDir: flags['data-dir'], dbPath: flags.db });
      } catch (err) {
        const errorPayload = {
          schemaVersion: 1,
          observedAt: new Date().toISOString(),
          databasePath: null,
          connected: false,
          status: 'disconnected',
          error: err.message,
          workers: [],
          recentEvents: [],
          artifacts: []
        };
        console.log(JSON.stringify(errorPayload, null, 2));
        process.exit(1);
      }

      const limit = flags.limit ? Number(flags.limit) : 50;
      const snapshot = await RctHost.getStatusSnapshot(dbPath, {
        eventLimit: limit,
        artifactLimit: limit
      });

      console.log(JSON.stringify(snapshot, null, 2));

      if (!snapshot.connected) {
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${effectiveCmd}. Use 'help' to see available commands.`);
      process.exit(1);
  }
}

// Auto-run if executed as main CLI entrypoint
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch(err => {
    const isJson = process.argv.includes('--json');
    if (isJson) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(`CLI Error: ${err.message}`);
    }
    process.exit(1);
  });
}
