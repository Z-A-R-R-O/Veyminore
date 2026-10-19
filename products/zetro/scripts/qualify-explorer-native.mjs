import { runExplorerFolderTask } from '../packages/computer-agent/src/explorer-native-host.js';
import { createWindowsProcessRunner } from '../packages/computer-windows-provider/src/index.js';
import { readFileSync, writeFileSync, lstatSync, realpathSync, rmdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

if (!process.argv.includes('--allow-native')) throw new Error('Explicit --allow-native is required for this live disposable-folder test');
const runner = createWindowsProcessRunner({ helperPath: resolve('products/zetro/packages/computer-windows-provider/helper/ZetroWindowHelper.exe') });
const parent = realpathSync(await runner.downloadsPath());
const name = `zetro-qualification-${randomUUID().slice(0, 8)}`;
const folderPath = join(parent, name);
if (existsSync(folderPath)) throw new Error('Disposable fixture already exists');
const startedAt = Date.now();
const result = await runExplorerFolderTask({ prompt: `Open File Explorer and create a folder named "${name}" in Downloads`, inputEnabled: true, runner });
let independentDirectoryCheck = false;
let disposableFixtureCleaned = false;
if (existsSync(folderPath)) {
  const stat = lstatSync(folderPath);
  independentDirectoryCheck = stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(folderPath) === folderPath && stat.birthtimeMs >= startedAt - 1000;
  if (independentDirectoryCheck) {
    rmdirSync(folderPath); // Removes only this new, empty fixture. Never recursive.
    disposableFixtureCleaned = !existsSync(folderPath);
  }
}
const nativeNegativeChecks = [];
if (result.success) {
  const target = result.target;
  const common = { inputEnabled: true, sessionId: 'explorer-negative-proof', grantExpiry: Date.now() + 10000,
    hwnd: target.hwnd, expectedPid: target.processId, expectedStart: target.generation, keys: 'Shift' };
  const checks = [
    ['foreign_pid', 'IDENTITY_MISMATCH', () => runner.pressKeys({ ...common, expectedPid: target.processId + 1 })],
    ['expired_grant', 'GRANT_EXPIRED', () => runner.pressKeys({ ...common, grantExpiry: 1 })],
    ['wrong_location', 'IDENTITY_MISMATCH', () => runner.pressKeys({ ...common, expectedLocation: 'C:\\Windows' })],
    ['wrong_focus', 'FOREGROUND_VERIFICATION_FAILED', () => runner.typeFocusedText(target.hwnd, 'guard-probe', { ...common, expectedFocusClass: 'not-a-real-focus-class' })]
  ];
  for (const [name, expectedCode, call] of checks) {
    try { await call(); nativeNegativeChecks.push({ name, denied: false }); }
    catch (error) { nativeNegativeChecks.push({ name, denied: error.code === expectedCode, code: error.code }); }
  }
}
const sourceHashes = {};
for (const path of ['packages/computer-windows-provider/helper/ZetroWindowHelper.cs', 'packages/computer-windows-provider/helper/ZetroWindowHelper.exe',
  'packages/computer-agent/src/explorer-native-host.js', 'packages/computer-agent/src/universal/universal-loop.js']) {
  sourceHashes[path] = createHash('sha256').update(readFileSync(join('products/zetro', path))).digest('hex');
}
const receipt = { ...result, operator: 'Codex', startedAt, finishedAt: Date.now(), independentDirectoryCheck, disposableFixtureCleaned,
  helloPreexisted: existsSync(join(parent, 'hello')), nativeNegativeChecks, sourceHashes };
const receiptPath = `products/zetro/docs/verification/2026-10-18-native-explorer-${startedAt}.json`;
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: result.status, summary: result.summary, independentDirectoryCheck, disposableFixtureCleaned, nativeNegativeChecks, receiptPath }));
process.exitCode = result.success && independentDirectoryCheck && disposableFixtureCleaned && nativeNegativeChecks.every(check => check.denied) ? 0 : 1;
