import esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));

export async function buildOrb() {
  const result = await esbuild.build({
    entryPoints: [resolve(appDir, 'src/orb-island.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    outfile: resolve(appDir, 'public/computer-preview/orb.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    metafile: true
  });
  return result;
}

export async function buildDock() {
  const result = await esbuild.build({
    entryPoints: [resolve(appDir, 'src/dock-island.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    outfile: resolve(appDir, 'public/dock.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    metafile: true
  });
  return result;
}

export async function buildBento() {
  const result = await esbuild.build({
    entryPoints: [resolve(appDir, 'src/bento-island.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    outfile: resolve(appDir, 'public/bento.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    metafile: true
  });
  return result;
}

export async function buildWork() {
  const result = await esbuild.build({
    entryPoints: [resolve(appDir, 'src/work-island.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    outfile: resolve(appDir, 'public/work.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    metafile: true
  });
  return result;
}

export async function buildBackground() {
  return esbuild.build({
    entryPoints: [resolve(appDir, 'src/background-island.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    outfile: resolve(appDir, 'public/background.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
}

export async function buildProductShell() {
  const result = await esbuild.build({
    entryPoints: [resolve(appDir, 'src/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    outfile: resolve(appDir, 'public/product-shell.js'),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    metafile: true
  });
  return result;
}

export async function buildAll() {
  await Promise.all([buildOrb(), buildDock(), buildBento(), buildWork(), buildBackground(), buildProductShell()]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAll()
    .then(() => console.log('Control center islands and Product Shell built successfully.'))
    .catch(err => {
      console.error('Build failed:', err);
      process.exit(1);
    });
}
