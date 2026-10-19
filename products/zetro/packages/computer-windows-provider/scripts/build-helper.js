/**
 * @zetro/computer-windows-provider - Bounded Helper Build Script
 *
 * Compiles the C# helper and fixture sources using installed Windows .NET tools only.
 * No external downloads, no npm package additions, no elevation, no global settings changes.
 */

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const KNOWN_CSC_PATHS = Object.freeze([
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  'csc.exe'
]);

/**
 * Resolves an installed, verified C# compiler executable path on Windows.
 *
 * @returns {string} Absolute path or command for csc.exe.
 */
export function resolveCompilerPath() {
  for (const candidate of KNOWN_CSC_PATHS) {
    if (candidate === 'csc.exe' || existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('No installed Windows .NET C# compiler (csc.exe) could be found');
}

/**
 * Compiles a C# source file using the installed Windows csc.exe compiler.
 *
 * @param {object} options
 * @param {string} options.sourcePath Source .cs file path.
 * @param {string} options.outputPath Target .exe output file path.
 * @param {'exe'|'winexe'} [options.target='exe'] Compilation target.
 * @param {string[]} [options.references=[]] Assemblies to reference.
 * @param {number} [options.timeoutMs=30000] Execution timeout.
 * @returns {Promise<{
 *   ok: boolean,
 *   compilerPath: string,
 *   outputPath: string,
 *   sizeBytes: number,
 *   durationMs: number,
 *   stdout: string,
 *   stderr: string
 * }>}
 */
export async function compileSource({
  sourcePath,
  outputPath,
  target = 'exe',
  references = [],
  libDirs = [],
  timeoutMs = 30000
}) {
  const compilerPath = resolveCompilerPath();
  const absSource = resolve(sourcePath);
  const absOutput = resolve(outputPath);

  if (!existsSync(absSource)) {
    throw new Error(`Source file not found: ${absSource}`);
  }

  const args = [
    `/target:${target}`,
    '/nologo',
    '/optimize+',
    `/out:${absOutput}`
  ];

  const wpfDir = resolve(dirname(compilerPath), 'WPF');
  const allLibDirs = [...libDirs];
  if (existsSync(wpfDir) && !allLibDirs.includes(wpfDir)) {
    allLibDirs.push(wpfDir);
  }
  if (allLibDirs.length > 0) {
    args.push(`/lib:${allLibDirs.join(',')}`);
  }

  if (references.length > 0) {
    args.push(`/r:${references.join(',')}`);
  }

  args.push(absSource);

  const start = Date.now();
  const { stdout, stderr } = await execFileAsync(compilerPath, args, {
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
    encoding: 'utf8'
  });
  const durationMs = Date.now() - start;

  if (!existsSync(absOutput)) {
    throw new Error(`Compilation finished but output file was not produced: ${absOutput}`);
  }

  const sizeBytes = statSync(absOutput).size;

  return {
    ok: true,
    compilerPath,
    outputPath: absOutput,
    sizeBytes,
    durationMs,
    stdout: stdout ? stdout.trim() : '',
    stderr: stderr ? stderr.trim() : ''
  };
}

/**
 * Builds all native components for @zetro/computer-windows-provider:
 * 1. ZetroWindowHelper.exe (Win32 & UIAutomation helper)
 * 2. ZetroFixtureWindow.exe (disposable test fixture window)
 */
export async function buildAll() {
  const pkgRoot = resolve(__dirname, '..');

  const helperSrc = resolve(pkgRoot, 'helper/ZetroWindowHelper.cs');
  const helperOut = resolve(pkgRoot, 'helper/ZetroWindowHelper.exe');

  const fixtureSrc = resolve(pkgRoot, 'fixture/ZetroFixtureWindow.cs');
  const fixtureOut = resolve(pkgRoot, 'fixture/ZetroFixtureWindow.exe');

  const helperResult = await compileSource({
    sourcePath: helperSrc,
    outputPath: helperOut,
    target: 'exe',
    references: ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'Microsoft.CSharp.dll']
  });

  const fixtureResult = await compileSource({
    sourcePath: fixtureSrc,
    outputPath: fixtureOut,
    target: 'winexe',
    references: ['System.Windows.Forms.dll', 'System.Drawing.dll']
  });

  return {
    helper: helperResult,
    fixture: fixtureResult
  };
}

// CLI entrypoint
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  buildAll()
    .then((results) => {
      console.log('Build completed successfully:');
      console.log(`- Helper:  ${results.helper.outputPath} (${results.helper.sizeBytes} bytes, ${results.helper.durationMs}ms)`);
      console.log(`- Fixture: ${results.fixture.outputPath} (${results.fixture.sizeBytes} bytes, ${results.fixture.durationMs}ms)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Build failed:', err.message);
      process.exit(1);
    });
}
