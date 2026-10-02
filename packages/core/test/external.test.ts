import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { FileAccess } from '../src/file-module/index.js';
import { fixture } from './fixture.js';

const selection = { externalSources: { core: 'src/**/*.ts' } };
const setup = async () => {
  const f = await fixture();
  await f.write('docs/SPEC-one.trm', 'concept _Old_ = { Original. }\n');
  await f.write('src/main.ts', '// _docs_spec_one:Old_\n');
  return f;
};

test('external selection validates named globs and is accepted only by search, grep and rename', async () => {
  const f = await setup();
  expect(
    (await f.read({ operation: 'search', searchText: '_docs_spec_one:Old_' })).externalMatches,
  ).toBeUndefined();
  for (const extra of [
    { externalDirectories: ['src'] },
    { externalExtensions: ['ts'] },
    { externalSources: { 'bad.name': 'src/**/*.ts' } },
    { externalSources: { core: '' } },
    { externalSources: { core: '!src/**/*.ts' } },
  ] as Record<string, unknown>[])
    await expect(f.read({ operation: 'search', searchText: 'x', ...extra })).rejects.toThrow();
  await expect(f.read({ operation: 'list', ...selection })).rejects.toThrow('externalSources');
});

test('external search returns literal lines and positions, independent of corpus filters', async () => {
  const f = await setup();
  await f.write('src/main.ts', 'first\r\n  A+B a+b\rnext A+B');
  await f.write('src/nested/types.d.ts', 'A+B');
  await f.write('src/upper.TS', 'A+B');
  await f.write('src/ignored.js', 'A+B');
  await f.write('src/node_modules/pkg/a.ts', 'A+B');
  await f.write('src/.aterm-cache/a.ts', 'A+B');
  const result = await f.read({
    operation: 'search',
    searchText: 'a+b',
    excludeViewpoints: ['spec'],
    externalSources: { core: 'src/**/*.ts' },
  });
  expect(result.termDeclarations).toEqual([]);
  expect(result.externalMatches).toEqual([
    { source: 'core', file: 'src/main.ts', line: 2, column: 3, text: '  A+B a+b' },
    { source: 'core', file: 'src/main.ts', line: 3, column: 6, text: 'next A+B' },
    { source: 'core', file: 'src/nested/types.d.ts', line: 1, column: 1, text: 'A+B' },
  ]);
});

test('absolute external globs outside Workspace are supported without adding Term Declarations', async () => {
  const f = await setup();
  const other = await fixture();
  await other.write('refs/a.ts', '_docs_spec_one:Old_');
  const input = {
    externalSources: { other: join(other.workspace, 'refs/**/*.ts') },
  };
  expect(
    (await f.read({ operation: 'search', searchText: '_docs_spec_one:Old_', ...input }))
      .externalMatches,
  ).toHaveLength(1);
  await f.author({
    operation: 'rename',
    from: '_docs_spec_one:Old_',
    to: '_docs_spec_one:New_',
    ...input,
  });
  expect(await readFile(join(other.workspace, 'refs/a.ts'), 'utf8')).toBe('_docs_spec_one:New_');
  expect((await f.read({ operation: 'list' })).termDeclarations).toHaveLength(1);
});

test('rename changes exact tokens in any text, preserves bytes around them and previews all files', async () => {
  const f = await setup();
  const path = join(f.workspace, 'src/main.ts');
  const before =
    '\uFEFF// _docs_spec_one:Old_\r\n"_docs_spec_one:Old_"; _docs_spec_one:Old_; \\_docs_spec_one:Old_\r\nOld _old_ x_docs_spec_one:Old_ _docs_spec_one:Old_x 한_docs_spec_one:Old_ _docs_spec_one:Old_한 $_docs_spec_one:Old_ _docs_spec_one:Old_$\r\n';
  await writeFile(path, before);
  await chmod(path, 0o640);
  const input = {
    operation: 'rename' as const,
    from: '_docs_spec_one:Old_',
    to: '_docs_spec_one:New_',
    ...selection,
  };
  const preview = await f.author({ ...input, dryRun: true });
  expect(preview.files).toHaveLength(2);
  expect(await readFile(path, 'utf8')).toBe(before);
  expect(await readFile(join(f.docs, 'SPEC-one.trm'), 'utf8')).toContain('_Old_');
  await f.author(input);
  expect(await readFile(path, 'utf8')).toBe(
    before.replaceAll(
      /(?<![\p{ID_Continue}$])_docs_spec_one:Old_(?![\p{ID_Continue}$])/gu,
      '_docs_spec_one:New_',
    ),
  );
  expect((await stat(path)).mode & 0o777).toBe(0o640);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('external read failures and invalid rename plans cannot write corpus files', async () => {
  const f = await setup();
  const corpus = join(f.docs, 'SPEC-one.trm');
  const original = await readFile(corpus, 'utf8');
  for (const bytes of [Buffer.from([0xff]), Buffer.from('text\0')]) {
    await writeFile(join(f.workspace, 'src/main.ts'), bytes);
    await expect(
      f.author({
        operation: 'rename',
        from: '_docs_spec_one:Old_',
        to: '_docs_spec_one:New_',
        ...selection,
      }),
    ).rejects.toThrow('UTF-8');
    expect(await readFile(corpus, 'utf8')).toBe(original);
  }
  await expect(
    f.author({
      operation: 'rename',
      from: '_docs_spec_one:Old_',
      to: '_docs_spec_one:New_',
      ...selection,
      externalSources: { core: 'src/main.ts/*.ts' },
    }),
  ).rejects.toThrow();
  expect(await readFile(corpus, 'utf8')).toBe(original);
  await f.write('src/main.ts', '_docs_spec_one:Old_');
  await expect(
    f.author({ operation: 'rename', from: '_Missing_', to: '_docs_spec_one:New_', ...selection }),
  ).rejects.toThrow();
  expect(await readFile(join(f.workspace, 'src/main.ts'), 'utf8')).toBe('_docs_spec_one:Old_');
});

test('external symlinks are skipped with warnings, and symlink roots are refused', async () => {
  const f = await setup();
  await f.write('target.ts', '_docs_spec_one:Old_');
  await symlink(join(f.workspace, 'target.ts'), join(f.workspace, 'src/link.ts'));
  await symlink(join(f.workspace, 'src'), join(f.workspace, 'alias'));
  const result = await f.author({
    operation: 'rename',
    from: '_docs_spec_one:Old_',
    to: '_docs_spec_one:New_',
    ...selection,
  });
  expect(result.warnings.some((w) => w.includes('symlink'))).toBe(true);
  expect(await readFile(join(f.workspace, 'target.ts'), 'utf8')).toBe('_docs_spec_one:Old_');
  await expect(
    f.read({
      operation: 'search',
      searchText: 'x',
      ...selection,
      externalSources: { core: 'alias/**/*.ts' },
    }),
  ).rejects.toThrow('symlink');
});

test('a stale external snapshot is detected before the first corpus write', async () => {
  const f = await setup();
  const path = join(f.workspace, 'src/main.ts');
  const original = FileAccess.prototype.readBytes;
  let reads = 0;
  const spy = vi.spyOn(FileAccess.prototype, 'readBytes').mockImplementation(async function (
    this: FileAccess,
    file,
  ) {
    const bytes = await original.call(this, file);
    if (file === path && ++reads === 1) await writeFile(path, '// concurrent change');
    return bytes;
  });
  try {
    await expect(
      f.author({
        operation: 'rename',
        from: '_docs_spec_one:Old_',
        to: '_docs_spec_one:New_',
        ...selection,
      }),
    ).rejects.toThrow();
    expect(await readFile(join(f.docs, 'SPEC-one.trm'), 'utf8')).toContain('_Old_');
    expect(await readFile(path, 'utf8')).toBe('// concurrent change');
  } finally {
    spy.mockRestore();
  }
});

test('external wildcard rename uses the original map without cascading replacements', async () => {
  const f = await setup();
  await f.write('docs/SPEC-one.trm', 'concept _A_ = { One. }\nconcept _AA_ = { Two. }\n');
  await f.write('src/main.ts', '_docs_spec_one:A_ _docs_spec_one:AA_ _Unknown_');
  await f.author({
    operation: 'rename',
    from: '_docs_spec_one:A*_',
    to: '_docs_spec_one:AA*_',
    ...selection,
  });
  expect(await readFile(join(f.workspace, 'src/main.ts'), 'utf8')).toBe(
    '_docs_spec_one:AA_ _docs_spec_one:AAA_ _Unknown_',
  );
});

test('configured named globs work without server configuration and participate in rename', async () => {
  const f = await setup();
  const path = join(f.home, 'aterm.yaml');
  await writeFile(
    path,
    (await readFile(path, 'utf8')) + '\nexternalSources:\n  core: src/**/*.ts\n',
  );
  const app = await f.app();
  expect(app.config.server).toBeUndefined();
  expect(
    (await f.read({ operation: 'search', searchText: '_docs_spec_one:Old_' })).externalMatches,
  ).toEqual([
    { source: 'core', file: 'src/main.ts', line: 1, column: 4, text: '// _docs_spec_one:Old_' },
  ]);
  expect(
    (await f.read({ operation: 'grep', referencePattern: '_docs_spec_one:Old_' }))
      .externalOccurrences?.[0],
  ).toMatchObject({ source: 'core', term: '_docs_spec_one:Old_' });
  expect(
    (await f.read({ operation: 'search', searchText: '_docs_spec_one:Old_', externalSources: {} }))
      .externalMatches,
  ).toEqual([]);
  await f.author({ operation: 'rename', from: '_docs_spec_one:Old_', to: '_docs_spec_one:New_' });
  expect(await readFile(join(f.workspace, 'src/main.ts'), 'utf8')).toBe('// _docs_spec_one:New_\n');
});

test('glob alternatives, exact paths, missing roots and overlapping sources retain provenance with one write', async () => {
  const f = await setup();
  await f.write('src/nested/view.tsx', '_docs_spec_one:Old_');
  await f.write('src/skip.js', '_docs_spec_one:Old_');
  await f.write('src/SPEC-skip.trm', 'concept _Old_ = { Skipped. }');
  const selection = {
    externalSources: {
      nested: 'src/nested/*.tsx',
      core: 'src/**/*.{ts,tsx}',
      absent: 'missing/**/*.ts',
      exact: 'src/main.ts',
      trmFiles: 'src/**/*.trm',
    },
  };
  const matches = (
    await f.read({ operation: 'search', searchText: '_docs_spec_one:Old_', ...selection })
  ).externalMatches!;
  expect(matches.map((m) => [m.source, m.file])).toEqual([
    ['core', 'src/main.ts'],
    ['core', 'src/nested/view.tsx'],
    ['exact', 'src/main.ts'],
    ['nested', 'src/nested/view.tsx'],
  ]);
  const saved = await f.author({
    operation: 'rename',
    from: '_docs_spec_one:Old_',
    to: '_docs_spec_one:New_',
    ...selection,
  });
  expect(saved.files).toHaveLength(3); // One corpus file and two physical source files.
  expect(await readFile(join(f.workspace, 'src/skip.js'), 'utf8')).toBe('_docs_spec_one:Old_');
  expect(await readFile(join(f.workspace, 'src/nested/view.tsx'), 'utf8')).toBe(
    '_docs_spec_one:New_',
  );
});

test('configuration and query use the same named glob validation', async () => {
  const f = await setup();
  const path = join(f.home, 'aterm.yaml');
  const original = await readFile(path, 'utf8');
  for (const value of [
    '{ core: "" }',
    '{ "bad.name": "src/*.ts" }',
    '{ core: [src] }',
    '{ core: "!src/*.ts" }',
  ]) {
    await writeFile(path, original + '\nexternalSources: ' + value);
    await expect(f.app()).rejects.toThrow('externalSources');
  }
});
