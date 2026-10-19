import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000,cwd:'C:/'});
test('global launcher resolves its workspace independently of current directory',()=>{
  const result=run('status','--json');assert.equal(result.status,0);
  const data=JSON.parse(result.stdout);assert.equal(data.products[0].id,'zetro');assert.equal(data.boundaries.workerDispatch,false);
  assert.equal(data.boundaries.providerCalls,0);assert(!result.stdout.includes('\x1b'));
});
test('unknown commands fail without printing misleading status',()=>{
  const result=run('start-everything');assert.equal(result.status,2);assert.match(result.stderr,/Unknown command/);assert.equal(result.stdout,'');
});
test('help and version do not depend on services',()=>{
  assert.match(run('help').stdout,/vym doctor/);assert.equal(JSON.parse(run('--version','--json').stdout).version,'0.1.0');
});
