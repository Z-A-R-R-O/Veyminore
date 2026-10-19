#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RctHost } from '../rct-host.js';
import { parseArgs } from '../cli.js';

async function run() {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const dbPath = flags.db || (flags['data-dir'] ? join(flags['data-dir'], 'tasks.db') : null);
  const workerId = flags.worker || 'RCT-1';
  const taskId = flags.task || positionals[0] || 'test-task';
  const sourceRoot = flags['source-root'] || null;
  const barrierDir = flags['barrier-dir'] || null;
  const leaseTtlMs = flags['lease-ttl-ms'] ? Number(flags['lease-ttl-ms']) : 30000;
  const filePath = flags['file-path'] || 'src/calc.js';
  const initialHash = flags['initial-hash'] || 'a'.repeat(64);

  if (!dbPath) {
    throw new Error('dbPath is required');
  }

  let providerCalls = 0;
  const provider = {
    name: `subprocess-provider-${taskId}`,
    async next() {
      providerCalls++;
      if (providerCalls === 1) {
        if (barrierDir) {
          // Record entered signal file
          writeFileSync(join(barrierDir, `${taskId}.entered`), JSON.stringify({ pid: process.pid, time: Date.now() }));
          if (process.send) {
            process.send({ type: 'PROVIDER_ENTERED', taskId, pid: process.pid });
          }

          // Wait for release signal file or abort
          const releaseFile = join(barrierDir, `${taskId}.release`);
          const abortFile = join(barrierDir, `${taskId}.abort`);
          const start = Date.now();
          while (!existsSync(releaseFile) && !existsSync(abortFile)) {
            await new Promise(r => setTimeout(r, 30));
            if (Date.now() - start > 12000) {
              throw new Error(`Barrier wait timeout for task ${taskId}`);
            }
          }

          if (existsSync(abortFile)) {
            throw new Error(`Execution aborted via barrier for task ${taskId}`);
          }
        }

        return {
          toolCalls: [
            {
              name: 'propose_patch',
              args: {
                path: filePath,
                expectedSha256: initialHash,
                content: 'export function add(a, b) {\n  return a + b;\n}\n'
              }
            }
          ],
          usage: { inputTokens: 50, outputTokens: 20 }
        };
      }

      return {
        toolCalls: [
          {
            name: 'submit_receipt',
            args: { summary: `Subprocess task ${taskId} completed` }
          }
        ],
        usage: { inputTokens: 50, outputTokens: 20 }
      };
    }
  };

  const host = new RctHost({
    dbPath,
    workerId,
    sourceRoot,
    leaseTtlMs,
    provider
  });

  const envelope = {
    id: taskId,
    agent: workerId,
    objective: 'Implement addition function in isolated snapshot',
    allowedPaths: [filePath],
    contextRefs: ['README.md'],
    acceptance: 'calc.js exports add(a, b) returning a + b',
    verification: filePath,
    declaredChecks: [filePath],
    workspaceRoot: sourceRoot,
    sourceHash: initialHash,
    sourceHashes: { [filePath]: initialHash },
    assignmentDigest: 'd'.repeat(64),
    deadlineMs: 30000,
    budget: { maxContextChars: 10000, maxReplyChars: 5000 },
    checks: [
      {
        type: 'contains',
        path: filePath,
        text: 'return a + b;'
      }
    ]
  };

  try {
    await host.init();
    const result = await host.runTask(envelope);
    if (barrierDir) {
      writeFileSync(join(barrierDir, `${taskId}.result`), JSON.stringify(result));
    }
    if (process.send) {
      process.send({ type: 'TASK_COMPLETED', result });
    }
    host.close();
    process.exit(0);
  } catch (err) {
    if (barrierDir) {
      writeFileSync(join(barrierDir, `${taskId}.error`), JSON.stringify({
        message: err.message,
        providerCalls
      }));
    }
    if (process.send) {
      process.send({ type: 'TASK_ERROR', error: err.message, providerCalls });
    }
    host.close();
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(2);
});
