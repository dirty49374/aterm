import { afterEach, expect, test, vi } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SourceAuthoring, WorkspaceFiles } from '../src/index.js';
import { fixture, specViewpoint } from './fixture.js';
import { FileAccess } from '../src/file-module/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const header = '@knowledge sample\n@viewpoints spec\n@description {\n  Before.\n}\n';
const body = 'concept _Probe_ = {\n  Before.\n.contract\n  Keep this exact body.\n}\n';
const patch = (hunk: string, name = 'sample') =>
  `*** Begin Patch\n*** Update Knowledge: ${name}\n${hunk}\n*** End Patch`;
async function setup(text = header + body) {
  const f = await fixture();
  roots.push(f.workspace);
  const path = join(f.docs, 'sample.trm');
  await writeFile(path, text);
  const app = await f.app();
  const author = new SourceAuthoring(app.home);
  return {
    ...f,
    path,
    author,
    edit: (text: string, extra = {}) =>
      author.execute({
        operation: 'knowledge-edit',
        name: 'sample',
        text,
        ...extra,
      }),
  };
}

test('Knowledge header patch previews and saves metadata without matching identical Term text', async () => {
  const f = await setup();
  const text = patch('@@\n-  Before.\n+  After.');
  const preview = await f.edit(text, { dryRun: true });
  expect(preview.saved).toBe(false);
  expect(await readFile(f.path, 'utf8')).toBe(header + body);
  const result = await f.edit(text);
  expect(result.saved).toBe(true);
  expect(await readFile(f.path, 'utf8')).toBe(header.replace('Before.', 'After.') + body);
  expect(result.derivedImpacts).toEqual([]);
});

test('Knowledge header patches add/remove optional headers, change Viewpoints and support an empty Knowledge', async () => {
  const f = await setup('@knowledge sample\n@viewpoints spec\n');
  await f.edit(
    patch('@@\n-@viewpoints spec\n+@viewpoints other\n+@scope {\n+  Only test subjects.\n+}'),
  );
  expect(await readFile(f.path, 'utf8')).toContain('@scope {\n  Only test subjects.\n}');
  await f.edit(patch('@@\n-@scope {\n-  Only test subjects.\n-}'));
  expect(await readFile(f.path, 'utf8')).toBe('@knowledge sample\n@viewpoints other\n');
});

test.each([
  patch('@@\n-  Before.\n+  After.', 'other'),
  patch('@@\n-@knowledge sample\n+@knowledge other'),
  patch('@@\n-@viewpoints spec\n+@viewpoints missing'),
  patch('@@\n-@viewpoints spec\n+@viewpoints'),
  patch('@@\n-  Keep this exact body.\n+  Changed.'),
  patch('@@\n @viewpoints spec\n+concept _Injected_ = { Sneak a Term into the header. }'),
  '*** Begin Patch\n*** Delete Knowledge: sample\n*** End Patch',
  '*** Begin Patch\n*** Update Term: _sample:Probe_\n@@\n-  Before.\n+  After.\n*** End Patch',
])(
  'Knowledge header patch refuses invalid or out-of-bound changes without writing: %s',
  async (text) => {
    const f = await setup();
    await expect(f.edit(text)).rejects.toThrow();
    expect(await readFile(f.path, 'utf8')).toBe(header + body);
  },
);

test('Knowledge header patch preserves BOM and exact Term bytes with mixed line endings', async () => {
  const original = '\uFEFF' + header.replaceAll('\n', '\r\n') + body;
  const f = await setup(original);
  await f.edit(patch('@@\n-  Before.\n+  After.'));
  expect(await readFile(f.path, 'utf8')).toBe(original.replace('Before.', 'After.'));
});

test('Knowledge header patch honors content versions and retains whole-source replacement', async () => {
  const f = await setup();
  const text = patch('@@\n-  Before.\n+  After.');
  await expect(f.edit(text, { ifMatch: 'stale' })).rejects.toThrow();
  const raw = new WorkspaceFiles((await f.app()).home);
  const current = await raw.read(f.path);
  await f.edit(text, { ifMatch: current.version });
  await expect(f.edit(text, { ifMatch: current.version })).rejects.toThrow();
  await f.edit(header + body.replace('Before.', 'A replacement.'));
  expect(await readFile(f.path, 'utf8')).toBe(header + body.replace('Before.', 'A replacement.'));
});

test('Knowledge header no-op preserves mixed header line endings and reports no files', async () => {
  const original = header.replace('@knowledge sample\n', '@knowledge sample\r\n') + body;
  const f = await setup(original);
  const result = await f.edit(patch('@@\n   Before.'));
  expect(result.files).toEqual([]);
  expect(await readFile(f.path, 'utf8')).toBe(original);
});

test('Knowledge header patches validate all blocks before saving', async () => {
  const f = await setup();
  const text = patch(
    '@@\n-  Before.\n+  After.\n*** Update Knowledge: sample\n@@\n-  Missing.\n+  Never saved.',
  );
  await expect(f.edit(text)).rejects.toThrow();
  expect(await readFile(f.path, 'utf8')).toBe(header + body);
});

test('Viewpoint creation preflights its config binding before writing the source', async () => {
  const f = await setup();
  const configPath = join(f.home, 'aterm.yaml');
  const target = join(f.home, 'viewpoints', 'fresh.md');
  const configBefore = await readFile(configPath, 'utf8');
  const outside = configBefore + '\n# External edit.\n';
  const originalRead = WorkspaceFiles.prototype.read;
  let injected = false;
  const spy = vi.spyOn(WorkspaceFiles.prototype, 'read').mockImplementation(async function (
    this: WorkspaceFiles,
    path,
  ) {
    const result = await originalRead.call(this, path);
    if (path === configPath && !injected) {
      injected = true;
      await writeFile(configPath, outside);
    }
    return result;
  });
  try {
    await expect(
      f.author.execute({
        operation: 'viewpoint-create',
        name: 'fresh',
        text: specViewpoint('fresh'),
      }),
    ).rejects.toThrow('saved files: none. Read these files before retrying.');
  } finally {
    spy.mockRestore();
  }
  expect(injected).toBe(true);
  await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(configPath, 'utf8')).toBe(outside);
  expect((await f.edit(header + body)).files).toEqual([]);
});

test('Viewpoint creation reports its saved source if the config changes during replacement', async () => {
  const f = await setup();
  const configPath = join(f.home, 'aterm.yaml');
  const target = join(f.home, 'viewpoints', 'fresh.md');
  const outside = (await readFile(configPath, 'utf8')) + '\n# External edit.\n';
  const source = specViewpoint('fresh');
  const originalWrite = FileAccess.prototype.write;
  const spy = vi.spyOn(FileAccess.prototype, 'write').mockImplementation(async function (
    this: FileAccess,
    ...args
  ) {
    await originalWrite.apply(this, args);
    if (args[0] === target) await writeFile(configPath, outside);
  });
  try {
    await expect(
      f.author.execute({ operation: 'viewpoint-create', name: 'fresh', text: source }),
    ).rejects.toThrow('saved files: .aterm/viewpoints/fresh.md. Read these files before retrying.');
  } finally {
    spy.mockRestore();
  }
  expect(await readFile(target, 'utf8')).toBe(source);
  expect(await readFile(configPath, 'utf8')).toBe(outside);
  expect((await f.edit(header + body)).files).toEqual([]);
});
