import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentTools } from '../src/index.js';

const mockAdapter = {
    verifyAll: async () => ([{ agent: 'AGR-1', connected: true, csrfToken: 'secret123', prompt: 'hello', error: 'A'.repeat(500) }]),
    verify: async (id) => ({ id, status: 'active', workspace: 'E:\\Veyminore' }),
    send: async (id, msg) => ({ delivery: 'submitted', verification: 'not_requested' }),
    observe: async (id) => ({ id, state: 'idle', stepCount: 2 }),
    observeAll: async () => ([
        { agent: 'AGR-1', connected: true, state: 'idle', stepCount: 5, workspace: '/a/b', conversationId: 'uuid1' },
        { agent: 'AGR-2', connected: false, state: 'unknown', stepCount: 0, error: 'connection refused' }
    ])
};

const failingAdapter = {
    verifyAll: async () => { throw new Error('adapter network down'); },
    verify: async () => { throw new Error('adapter network down'); },
    send: async () => { throw new Error('adapter network down'); },
    observe: async () => { throw new Error('adapter network down'); },
    observeAll: async () => { throw new Error('adapter network down'); }
};

async function run() {
    console.log('Running unit tests...');
    const tools = new AgentTools(mockAdapter, { maxOutputChar: 5000 });

    // 1. statusCompact
    let res = JSON.parse(await tools.statusCompact());
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.data[0].workspace, undefined, 'Workspace must be stripped');
    assert.strictEqual(res.data[0].conversationId, undefined, 'ConversationId must be stripped');
    assert.strictEqual(res.data[0].agent, 'AGR-1');
    assert.strictEqual(res.data[0].stepCount, 5);
    assert.strictEqual(res.data[1].connected, false);

    // 2. verifyAll
    let vRes = JSON.parse(await tools.verifyAll());
    assert.strictEqual(vRes.status, 'success');
    assert.strictEqual(vRes.data[0].agent, 'AGR-1');
    assert.strictEqual(vRes.data[0].csrfToken, '[REDACTED]', 'Sensitive tokens must be redacted');

    // 3. inspect
    let insRes = JSON.parse(await tools.inspect('AGR-1'));
    assert.strictEqual(insRes.status, 'success');
    assert.strictEqual(insRes.data.id, 'AGR-1');

    // 4. poll
    let pollRes = JSON.parse(await tools.poll('AGR-1'));
    assert.strictEqual(pollRes.status, 'success');
    assert.strictEqual(pollRes.data.state, 'idle');

    // 5. statusAll
    let statusAllRes = JSON.parse(await tools.statusAll());
    assert.strictEqual(statusAllRes.status, 'success');
    assert.strictEqual(statusAllRes.data.length, 2);

    // 6. send dryRun
    let sendDry = JSON.parse(await tools.send('AGR-1', 'hello', true));
    assert.strictEqual(sendDry.status, 'not_attempted');

    // 7. send actual (mocked adapter)
    let sendAct = JSON.parse(await tools.send('AGR-1', 'hello', false));
    assert.strictEqual(sendAct.status, 'submitted');

    // 8. Error handling with failing adapter
    const failTools = new AgentTools(failingAdapter, { maxOutputChar: 5000 });
    let failRes = JSON.parse(await failTools.verifyAll());
    assert.strictEqual(failRes.status, 'error');
    assert.match(failRes.message, /adapter network down/);

    // 9. Mock sendPacked tests
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-test-'));
    try {
        const taskJson = path.join(tmpDir, 'task.json');
        fs.writeFileSync(taskJson, JSON.stringify({
            objective: 'test packed',
            acceptance: 'pass',
            permissions: 'none',
            blockers: 'none',
            context: { big: 'A'.repeat(5000) }
        }));
        const storeDir = path.join(tmpDir, 'store');

        // Normal dry-run
        const sPackRes = await tools.sendPacked('AGR-1', taskJson, storeDir, '2000', true);
        const parsedPack = JSON.parse(sPackRes);
        if (parsedPack.status === 'error') console.error(parsedPack);
        assert.strictEqual(parsedPack.status, 'not_attempted');
        assert.ok(parsedPack.metrics.savedChars > 800, 'Must compress context');

        // Strict integer requirement test
        const sPackJunk = await tools.sendPacked('AGR-1', taskJson, storeDir, '200junk', true);
        assert.strictEqual(JSON.parse(sPackJunk).status, 'error');
        assert.ok(JSON.parse(sPackJunk).message.includes('exact positive integer'));
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('Unit tests passed.');
}
run().catch(e => { console.error(e); process.exit(1); });
