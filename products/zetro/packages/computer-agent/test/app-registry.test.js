import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  APPLICATION_CATALOG,
  TESTED_CAPABILITY_MATRIX,
  resolveApplication,
  createApplicationRegistryPort
} from '../src/app-registry.js';
import { AgentErrorCode, ComputerAgentError } from '../src/types.js';

describe('Application Catalog & Resolution', () => {
  it('exposes declared supported applications', () => {
    assert.ok(APPLICATION_CATALOG.notepad);
    assert.ok(APPLICATION_CATALOG.chrome);
    assert.ok(APPLICATION_CATALOG.windows_search);
    assert.ok(APPLICATION_CATALOG.whatsapp);
  });

  it('resolves exact canonical names and aliases', () => {
    const r1 = resolveApplication('notepad');
    assert.strictEqual(r1.resolved, true);
    assert.strictEqual(r1.application.appId, 'notepad');

    const r2 = resolveApplication('Google Chrome');
    assert.strictEqual(r2.resolved, true);
    assert.strictEqual(r2.application.appId, 'chrome');

    const r3 = resolveApplication('Windows Search');
    assert.strictEqual(r3.resolved, true);
    assert.strictEqual(r3.application.appId, 'windows_search');

    const r4 = resolveApplication('WhatsApp Desktop');
    assert.strictEqual(r4.resolved, true);
    assert.strictEqual(r4.application.appId, 'whatsapp');
  });

  it('rejects unsupported applications fail-closed', () => {
    const res = resolveApplication('MaliciousGame');
    assert.strictEqual(res.resolved, false);
    assert.strictEqual(res.reason, AgentErrorCode.UNSUPPORTED_APPLICATION);
    assert.match(res.error, /Unsupported application/);
  });

  it('rejects empty or whitespace application names', () => {
    const res = resolveApplication('   ');
    assert.strictEqual(res.resolved, false);
    assert.strictEqual(res.reason, AgentErrorCode.APPLICATION_AMBIGUOUS);
  });

  it('rejects shell metacharacters and path traversal in application query', () => {
    const probes = [
      'notepad.exe; rm -rf /',
      'notepad | calc',
      'notepad & whoami',
      '`calc`',
      '$(calc)',
      '../notepad',
      '-flag',
      'notepad > out.txt'
    ];

    for (const probe of probes) {
      const res = resolveApplication(probe);
      assert.strictEqual(res.resolved, false, `Probe '${probe}' should have been rejected`);
      assert.strictEqual(res.reason, AgentErrorCode.MALICIOUS_ARGUMENTS);
      assert.match(res.error, /Security violation/);
    }
  });

  it('publishes honest capability matrix with limitations', () => {
    const matrix = TESTED_CAPABILITY_MATRIX;
    assert.ok(Array.isArray(matrix.supportedApplications));
    assert.strictEqual(matrix.supportedApplications.length, 4);
    assert.ok(Array.isArray(matrix.generalLimitations));
    assert.ok(matrix.generalLimitations.some(l => l.includes('No universal application support')));
  });
});

describe('Safe Process Launcher Port', () => {
  it('launches application with shell: false and clean arguments array', async () => {
    let capturedCmd = null;
    let capturedArgs = null;
    let capturedOpts = null;

    const mockSpawn = (cmd, args, opts) => {
      capturedCmd = cmd;
      capturedArgs = args;
      capturedOpts = opts;
      return {
        pid: 4321,
        unref() {}
      };
    };

    const port = createApplicationRegistryPort({ spawnProcess: mockSpawn });
    const app = APPLICATION_CATALOG.notepad;
    const result = await port.launchApp(app, { extraArgs: [] });

    assert.strictEqual(capturedCmd, 'notepad.exe');
    assert.deepStrictEqual(capturedArgs, []);
    assert.strictEqual(capturedOpts.shell, false);
    assert.strictEqual(result.pid, 4321);
    assert.strictEqual(result.appId, 'notepad');
  });

  it('rejects malicious shell metacharacters in extra launch arguments', async () => {
    const port = createApplicationRegistryPort();
    const app = APPLICATION_CATALOG.chrome;

    await assert.rejects(
      async () => {
        await port.launchApp(app, { extraArgs: ['https://example.com; calc.exe'] });
      },
      (err) => {
        assert.ok(err instanceof ComputerAgentError);
        assert.strictEqual(err.code, AgentErrorCode.MALICIOUS_ARGUMENTS);
        return true;
      }
    );
  });
});
