import { cp, mkdir, rm, access, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'dist');
const output = resolve(root, '.vercel', 'output');
await access(resolve(source, 'index.html'));
if (!output.startsWith(root + sep) || output !== resolve(root, '.vercel/output')) {
  throw new Error('Refusing an output directory outside this game');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, resolve(output, 'static'), { recursive: true });
await writeFile(resolve(output, 'config.json'), JSON.stringify({ version: 3 }, null, 2) + '\n');
console.log('Prepared .vercel/output from the production dist build.');
