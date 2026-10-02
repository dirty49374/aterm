import { cp, mkdir, readdir } from 'node:fs/promises';
import { build as esbuild, type BuildOptions } from 'esbuild';
import { createRequire } from 'node:module';
import { publishLicenses } from './licenses.js';

const bundledInputs = new Set<string>();
async function build(options: BuildOptions) {
  const result = await esbuild({ ...options, metafile: true });
  for (const input of Object.keys(result.metafile!.inputs)) bundledInputs.add(input);
  return result;
}
// Ship the browser alongside core so standalone deployment needs no workspace sibling.
await mkdir('packages/core/webapp', { recursive: true });
await cp('packages/webapp/public', 'packages/core/webapp', { recursive: true });
// Parse every browser module, including native modules kept external to the app bundle.
await build({
  entryPoints: (await readdir('packages/webapp/public'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `packages/webapp/public/${file}`),
  outdir: 'packages/core/webapp',
  platform: 'browser',
  format: 'esm',
});

// Share authored Group derivation with the CLI without exposing workspace paths to the browser.
for (const [name, entry] of [
  ['identity', 'packages/core/src/syntax-module/identity.ts'],
  ['library-model', 'packages/webapp/public/library-model.js'],
  ['routes', 'packages/webapp/public/routes.js'],
])
  await build({
    entryPoints: [entry!],
    outfile: `packages/core/webapp/${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'esm',
  });

// Keep diagrams lazy while shipping every renderer in the standalone package.
for (const name of ['markdown', 'mermaid']) {
  await build({
    entryPoints: [`packages/webapp/src/${name}.js`],
    outfile: `packages/core/webapp/${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    legalComments: 'linked',
    external: name === 'markdown' ? ['./mermaid.js'] : [],
  });
}
for (const name of ['markdown-it', 'markdown-it-task-lists', 'highlight.js', 'mermaid'])
  await cp(`node_modules/${name}/LICENSE`, `packages/core/webapp/${name}-LICENSE`);

// Package both halves: layout executes off the UI thread and never needs a CDN.
for (const file of ['elk-api.js', 'elk-worker.min.js']) {
  await cp('node_modules/elkjs/lib/' + file, 'packages/core/webapp/' + file);
}
await cp('node_modules/elkjs/LICENSE.md', 'packages/core/webapp/elk-LICENSE.md');

await build({
  entryPoints: ['packages/webapp/src/layout-worker.js'],
  outfile: 'packages/core/webapp/force-layout-worker.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minify: true,
  legalComments: 'linked',
});
for (const name of ['cytoscape', 'cytoscape-fcose', 'cytoscape-cise']) {
  await cp(`node_modules/${name}/LICENSE`, `packages/core/webapp/${name}-LICENSE`);
}
const layoutRequire = createRequire(import.meta.resolve('cytoscape-cise'));
for (const name of ['cose-base', 'avsdf-base']) {
  await cp(layoutRequire.resolve(`${name}/LICENSE`), `packages/core/webapp/${name}-LICENSE`);
}
const baseRequire = createRequire(layoutRequire.resolve('cose-base'));
await cp(baseRequire.resolve('layout-base/LICENSE'), 'packages/core/webapp/layout-base-LICENSE');

await build({
  entryPoints: ['packages/webapp/src/app.jsx'],
  outfile: 'packages/core/webapp/app.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['./graph.js', './library-model.js', './identity.js', './markdown.js', './routes.js'],
});
for (const [name, license] of [
  ['react', 'LICENSE'],
  ['react-dom', 'LICENSE'],
  ['react-router', 'LICENSE.md'],
])
  await cp(`node_modules/${name}/${license}`, `packages/core/webapp/${name}-LICENSE`);

// ELK files are copied rather than bundled; account for their package explicitly.
bundledInputs.add('node_modules/elkjs/lib/elk-api.js');
await publishLicenses(bundledInputs);
