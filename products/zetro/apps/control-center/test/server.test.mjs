import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlCenter } from '../server.mjs';

test('local preview protects its read-only projection and exposes only declared evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zetro-control-test-'));
  await mkdir(join(root, 'docs/execution/ocr'), { recursive:true });
  await writeFile(join(root, 'docs/execution/DISPATCH.json'), JSON.stringify({ agents:{ 'AGR-1':{
    status:'independent_review_in_progress', privateKey:'synthetic-secret-not-public',
    assignment:{ taskId:'task-1', objective:'Verify a scoped change', ownedPaths:['packages/example'] }
  } } }));
  const server = createControlCenter(root, {live:{snapshot:async () => ({observedAt:new Date().toISOString(),workers:{'AGR-1':{state:'busy',source:'synthetic observation'}},sources:[]})}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/status')).status, 401);
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const response = await fetch(base + '/api/status', { headers:{cookie} });
    const data = await response.json();
    assert.equal(data.workers[0].taskId, 'task-1');
    assert.equal(data.workers.filter(w => w.group === 'RCT').length, 5);
    assert.equal(data.workers.find(w => w.name === 'RCT-1').live.state, 'not_connected');
    assert.equal(data.workers[0].live.state, 'busy');
    assert.equal(data.sourceMode, 'saved-evidence');
    assert.equal(data.boundaries.readOnly, true);
    assert.equal(data.sources.filter(source => !source.available).length, 3);
    assert.equal(JSON.stringify(data).includes('synthetic-secret-not-public'), false);
    assert.equal((await fetch(base + '/api/status', {headers:{cookie,origin:'https://unrelated.example'}})).status, 403);
    assert.equal((await fetch(base + '/api/status', {method:'POST',headers:{cookie}})).status, 403);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/fonts/Satoshi-Variable.ttf')).status, 200);
    const preview = await fetch(base + '/computer-preview/');
    assert.equal(preview.status, 200);
    const orbJs = await fetch(base + '/computer-preview/orb.js');
    assert.equal(orbJs.status, 200);
    assert.match(orbJs.headers.get('content-type'), /text\/javascript/);
    const orbCss = await fetch(base + '/computer-preview/orb.css');
    assert.equal(orbCss.status, 200);
    assert.match(orbCss.headers.get('content-type'), /text\/css/);
    const dockJs = await fetch(base + '/dock.js');
    assert.equal(dockJs.status, 200);
    assert.match(dockJs.headers.get('content-type'), /text\/javascript/);
    const dockCss = await fetch(base + '/dock.css');
    assert.equal(dockCss.status, 200);
    assert.match(dockCss.headers.get('content-type'), /text\/css/);
    const productShellJs = await fetch(base + '/product-shell.js');
    assert.equal(productShellJs.status, 200);
    assert.match(productShellJs.headers.get('content-type'), /text\/javascript/);
    const productShellCss = await fetch(base + '/product-shell.css');
    assert.equal(productShellCss.status, 200);
    assert.match(productShellCss.headers.get('content-type'), /text\/css/);
    const ifzWorkCss = await fetch(base + '/ifz-work.css');
    assert.equal(ifzWorkCss.status, 200);
    assert.match(ifzWorkCss.headers.get('content-type'), /text\/css/);
    const pageHtml = await page.text();
    assert.match(pageHtml, /id="app-root"/);
    assert.match(pageHtml, /src="\/product-shell\.js"/);
    assert.match(pageHtml, /href="\/product-shell\.css"/);
    assert.match(pageHtml, /href="\/ifz-work\.css"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive:true, force:true });
  }
});
