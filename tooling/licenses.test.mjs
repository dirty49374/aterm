import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const workspaces = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0))
    await rm(workspace, { recursive: true, force: true });
});

async function fixture(withLicense) {
  const root = await mkdtemp(join(tmpdir(), 'aterm-licenses-'));
  workspaces.push(root);
  const dependency = join(root, 'node_modules/example/lib');
  await mkdir(dependency, { recursive: true });
  for (const target of ['packages/core', 'packages/cli'])
    await mkdir(join(root, target), { recursive: true });
  await writeFile(join(root, 'LICENSE'), 'Aterm License');
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'Source availability');
  await writeFile(
    join(root, 'node_modules/example/package.json'),
    JSON.stringify({ name: 'example', version: '1.0.0' }),
  );
  await writeFile(join(dependency, 'index.js'), 'export const value = 1;');
  await writeFile(join(root, 'node_modules/example/NOTICE'), 'Upstream attribution');
  if (withLicense) await writeFile(join(root, 'node_modules/example/license'), 'Upstream License');
  return root;
}

function publish(root) {
  const module = new URL('./licenses.ts', import.meta.url).href;
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {publishLicenses} from ${JSON.stringify(module)}; await publishLicenses(['node_modules/example/lib/index.js']);`,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

test('ships dependency attribution even without a manifest license field', async () => {
  const root = await fixture(true);
  publish(root);
  const base = join(root, 'packages/core/webapp/licenses');
  const inventory = JSON.parse(await readFile(join(base, 'packages.json'), 'utf8'));
  expect(inventory[0].license).toBe('See included license file');
  expect(await readFile(join(base, 'example@1.0.0/NOTICE'), 'utf8')).toBe('Upstream attribution');
  expect(await readFile(join(base, 'example@1.0.0/license'), 'utf8')).toBe('Upstream License');
  expect(await readFile(join(root, 'packages/cli/LICENSE'), 'utf8')).toBe('Aterm License');
  expect(await readFile(join(root, 'packages/core/THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(
    'Source availability',
  );
});

test('refuses a bundled dependency with only a notice and no license text', async () => {
  const root = await fixture(false);
  expect(() => publish(root)).toThrow(/Bundled package has no license file: example@1.0.0/);
});
