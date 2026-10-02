import { readFile, rename, rm } from 'node:fs/promises';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { AtermScanner } from '../src/corpus-module/index.js';
import { FileAccess } from '../src/file-module/index.js';
import { AtermConfigReader } from '../src/home-module/index.js';
import { ExternalFiles } from '../src/external-module/index.js';
import { AtermSnapshot } from '../src/server-module/snapshot.js';
import { fixture, specViewpoint } from './fixture.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const poll: typeof expect.poll = (callback, options) =>
  expect.poll(callback, { timeout: 4000, ...options });

async function setup(extra = '') {
  const f = await fixture();
  await f.write('docs/SPEC-one.trm', 'concept _One_ = { First. }');
  const config =
    (await readFile(join(f.home, 'aterm.yaml'), 'utf8')) +
    '\nserver: { port: 43127, debounceMs: 50 }\n' +
    extra;
  await f.write('.aterm/aterm.yaml', config);
  const snapshot = new AtermSnapshot((await f.app()).home);
  return { f, config, snapshot };
}

test('idle monitoring and unrelated files do not reread configuration, corpus or external text', async () => {
  const { f, snapshot } = await setup('externalSources: { code: "src/**/*.ts" }\n');
  await f.write('src/ref.ts', '// _docs_spec_one:One_');
  await snapshot.start();
  const scan = vi.spyOn(AtermScanner.prototype, 'scan');
  const config = vi.spyOn(AtermConfigReader.prototype, 'read');
  const external = vi.spyOn(ExternalFiles.prototype, 'read');
  try {
    await f.write('.aterm/cache/progress.json', '{}');
    await f.write('unrelated/file.txt', 'unselected');
    await f.write('docs/.git/index', 'ignored');
    await pause(1300);
    await snapshot.query({ operation: 'list' });
    expect(scan).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    expect(snapshot.revision).toBe(1);
  } finally {
    await snapshot.close();
    vi.restoreAllMocks();
  }
});

test('native events discover missing roots and keep tracking recreated and replaced source directories', async () => {
  const { f, snapshot, config } = await setup();
  await f.write('.aterm/aterm.yaml', config.replace('[docs, shared]', '[future/deep/docs]'));
  await snapshot.start();
  const names = async () => {
    const result = await snapshot.query({ operation: 'list' });
    return 'termDeclarations' in result ? result.termDeclarations.map((term) => term.name) : [];
  };
  try {
    expect(await names()).toEqual([]);
    await f.write('future/deep/docs/SPEC-new.trm', 'concept _New_ = { Created. }');
    await poll(names).toEqual(['_New_']);
    await rename(join(f.workspace, 'future'), join(f.workspace, 'moved'));
    await poll(names).toEqual([]);
    await f.write('future/deep/docs/SPEC-again.trm', 'concept _Again_ = { Recreated. }');
    await poll(names).toEqual(['_Again_']);
    await f.write('replacement/SPEC-last.trm', 'concept _Last_ = { Replacement. }');
    await rm(join(f.workspace, 'future/deep/docs'), { recursive: true });
    await rename(join(f.workspace, 'replacement'), join(f.workspace, 'future/deep/docs'));
    await poll(names).toEqual(['_Last_']);
    await f.write('future/deep/docs/SPEC-last.trm', 'concept _Final_ = { Subsequent edit. }');
    await poll(names).toEqual(['_Final_']);
  } finally {
    await snapshot.close();
  }
});

test('new missing Viewpoint bindings are observed before loading and recover on file creation or atomic save', async () => {
  const { f, snapshot, config } = await setup();
  await snapshot.start();
  const rebound = config.replace('./viewpoint-spec.md', '../vocabulary/deep/spec.md');
  try {
    await f.write('.aterm/aterm.yaml', rebound);
    await poll(() => String(snapshot.error)).toContain('Missing Viewpoint');
    await f.write('vocabulary/deep/spec.md', specViewpoint('spec'));
    await poll(() => snapshot.error).toBeUndefined();
    await f.write('vocabulary/deep/spec.md', 'invalid');
    await poll(() => String(snapshot.error)).toContain('frontmatter');
    await f.write('vocabulary/replacement.md', specViewpoint('spec'));
    await rename(
      join(f.workspace, 'vocabulary/replacement.md'),
      join(f.workspace, 'vocabulary/deep/spec.md'),
    );
    await poll(() => snapshot.error).toBeUndefined();
    await f.write('.aterm/aterm.yaml.new', 'invalid: [');
    await rename(join(f.home, 'aterm.yaml.new'), join(f.home, 'aterm.yaml'));
    await poll(() => String(snapshot.error)).toContain('aterm.yaml');
    await f.write('.aterm/aterm.yaml.new', rebound);
    await rename(join(f.home, 'aterm.yaml.new'), join(f.home, 'aterm.yaml'));
    await poll(() => snapshot.error).toBeUndefined();
  } finally {
    await snapshot.close();
  }
});

test('cold startup observes invalid Viewpoints outside Home and repairs without config edits', async () => {
  const { f, snapshot, config } = await setup();
  await f.write(
    '.aterm/aterm.yaml',
    config.replace('./viewpoint-spec.md', '../vocabulary/spec.md'),
  );
  await snapshot.start();
  try {
    expect(String(snapshot.error)).toContain('Missing Viewpoint');
    await f.write('vocabulary/spec.md', specViewpoint('spec'));
    await poll(() => snapshot.revision).toBe(1);
    expect(snapshot.error).toBeUndefined();
  } finally {
    await snapshot.close();
  }
});

test('failed native watches expose failure and retry observation without polling the corpus', async () => {
  const { f, snapshot } = await setup();
  const original = FileAccess.prototype.watchDirectory;
  let unavailable = true;
  let sourceWatch: FSWatcher | undefined;
  const watch = vi.spyOn(FileAccess.prototype, 'watchDirectory').mockImplementation(function (
    this: FileAccess,
    path,
    changed,
    recursive,
  ) {
    if (path === f.docs && unavailable)
      throw Object.assign(new Error('watch limit'), { code: 'ENOSPC' });
    const watcher = original.call(this, path, changed, recursive);
    if (path === f.docs) sourceWatch = watcher;
    return watcher;
  });
  const scan = vi.spyOn(AtermScanner.prototype, 'scan');
  try {
    await snapshot.start();
    expect(snapshot.error).toMatchObject({ code: 'server.watch' });
    await pause(1200);
    expect(scan).not.toHaveBeenCalled();
    unavailable = false;
    await poll(() => snapshot.revision).toBe(1);
    expect(snapshot.error).toBeUndefined();
    unavailable = true;
    sourceWatch!.emit('error', new Error('watcher lost'));
    await poll(() => snapshot.error).toMatchObject({ code: 'server.watch' });
    scan.mockClear();
    await pause(1200);
    expect(scan).not.toHaveBeenCalled();
    unavailable = false;
    await poll(() => snapshot.error).toBeUndefined();
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Recovered. }');
    await poll(async () => JSON.stringify(await snapshot.query({ operation: 'show' }))).toContain(
      'Recovered.',
    );
  } finally {
    await snapshot.close();
    watch.mockRestore();
    scan.mockRestore();
  }
}, 10000);

test('disabled external watching ignores source events and close cancels pending debounce', async () => {
  const { f, snapshot, config } = await setup('externalSources: { code: "src/**/*.ts" }\n');
  await f.write(
    '.aterm/aterm.yaml',
    config.replace('debounceMs: 50', 'debounceMs: 200, watchExternal: false'),
  );
  await snapshot.start();
  const scan = vi.spyOn(AtermScanner.prototype, 'scan');
  try {
    await f.write('src/ref.ts', '// _docs_spec_one:One_');
    await pause(300);
    expect(scan).not.toHaveBeenCalled();
    const result = await snapshot.query({ operation: 'grep', referencePattern: '_One_' });
    expect('externalOccurrences' in result && result.externalOccurrences).toHaveLength(1);
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Pending. }');
    await pause(30);
    await snapshot.close();
    await pause(300);
    expect(scan).not.toHaveBeenCalled();
  } finally {
    await snapshot.close();
    scan.mockRestore();
  }
});

test('configuration can remove a failed watch without waiting for that directory to recover', async () => {
  const { f, snapshot, config } = await setup();
  await snapshot.start();
  const original = FileAccess.prototype.watchDirectory;
  const watch = vi.spyOn(FileAccess.prototype, 'watchDirectory').mockImplementation(function (
    this: FileAccess,
    path,
    changed,
    recursive,
  ) {
    if (path === join(f.workspace, 'blocked')) throw new Error('unavailable watcher');
    return original.call(this, path, changed, recursive);
  });
  try {
    await f.write('blocked/SPEC-two.trm', 'concept _Two_ = { Unavailable. }');
    await f.write('.aterm/aterm.yaml', config.replace('[docs, shared]', '[blocked]'));
    await poll(() => snapshot.error).toMatchObject({ code: 'server.watch' });
    await f.write('.aterm/aterm.yaml', config);
    await poll(() => snapshot.error).toBeUndefined();
    expect(JSON.stringify(await snapshot.query({ operation: 'list' }))).toContain('_One_');
  } finally {
    await snapshot.close();
    watch.mockRestore();
  }
});
