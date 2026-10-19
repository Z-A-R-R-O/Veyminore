#!/usr/bin/env node
import { TESTED_CAPABILITY_MATRIX, COMPUTER_AGENT_TOOLS } from './index.js';
import { runExplorerFolderTask } from './explorer-native-host.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { printHelp(); return; }
  if (options.matrix) {
    const matrix = { qualifiedNative: ['Downloads folder creation'], remainingNativeWorkflows: 'Not qualified by this CLI', declaredOfflineCoverage: TESTED_CAPABILITY_MATRIX };
    console.log(JSON.stringify(matrix, null, 2));
    return;
  }
  if (options.tools) { console.log(JSON.stringify(COMPUTER_AGENT_TOOLS, null, 2)); return; }
  if (!options.prompt) throw new Error('--prompt is required');
  if (!options.native || options.universal) {
    throw new Error('A qualified native host is required. Use --native for Downloads folder creation. Other workflows require explicitly composed trusted ports.');
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Stopped by operator'));
  process.once('SIGINT', stop);
  try {
    const result = await runExplorerFolderTask({ prompt: options.prompt, inputEnabled: options.allowInput, signal: controller.signal });
    console.log(options.json ? JSON.stringify(result) : result.summary);
    process.exitCode = result.success ? 0 : 1;
  } finally { process.removeListener('SIGINT', stop); }
}

function parseArgs(args) {
  const options = { allowInput: false };
  const flags = { '--native': 'native', '--universal': 'universal', '--matrix': 'matrix', '--tools': 'tools', '--json': 'json', '--help': 'help', '-h': 'help' };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--prompt') {
      if (!args[i + 1]) throw new Error('--prompt needs a value');
      options.prompt = args[++i];
    } else if (argument === '--allow-input') options.allowInput = true;
    else if (argument === '--no-input') options.allowInput = false;
    else if (flags[argument]) options[flags[argument]] = true;
    else throw new Error(`Unsupported option: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`ZETRO Computing

Usage:
  node products/zetro/packages/computer-agent/src/cli.js --native --allow-input --prompt 'Create a folder named "hello" in Downloads'

Options:
  --native             Use the qualified Downloads folder host
  --prompt <text>      Describe the folder to create in Downloads
  --allow-input        Explicitly enable native input for this run
  --no-input           Keep native input disabled (default)
  --json               Print the structured result
  --matrix             Show qualified native and declared offline coverage
  --tools              Show the public planner tool schemas
  --help, -h           Show this help

Ctrl+C stops the run. Unknown effects are never replayed automatically.
Other applications require a qualified host. Use the public reactive skill API to compose trusted ports.`);
}

main().catch(error => {
  console.error('Computer task failed:', error.message);
  process.exitCode = 2;
});
