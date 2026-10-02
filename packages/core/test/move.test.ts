import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './fixture.js';

const knowledgeSource = (knowledge: string, body = '') =>
  `@knowledge ${knowledge}\n@viewpoints spec\n${body}\n`;
async function setup() {
  const f = await fixture();
  await f.write(
    'docs/source.trm',
    knowledgeSource(
      'source',
      [
        'concept _Order_ in sales.entities = {',
        '  Uses _Item_ and _target:Item_.',
        '.relations',
        '  references _Item_',
        '  references _target:Item_',
        '.contract',
        '  _Item_.contract†',
        '.remarks',
        '  ```text',
        '  _source:Order_ remains opaque.',
        '  ```',
        '}',
        'concept _Item_ = {',
        '  Item.',
        '.contract',
        '  - Item content.',
        '}',
        'concept _Root_ = {',
        '  Read _Order_†.',
        '.relations',
        '  references _Order_',
        '}',
      ].join('\n'),
    ),
  );
  await f.write(
    'shared/target.trm',
    '\uFEFF' +
      knowledgeSource('target', 'concept _Item_ = { Other item. }').replaceAll('\n', '\r\n'),
  );
  await f.write(
    'docs/third.trm',
    knowledgeSource(
      'third',
      'concept _User_ = {\n  Read _source:Order_.\n.relations\n  references _source:Order_\n}',
    ),
  );
  await f.write('src/refs.ts', '// _source:Order_ _Order_ _target:Item_');
  return f;
}

test('move relocates the single Term Declaration, Group and sections while preserving reference identities across the new boundary', async () => {
  const f = await setup();
  const path = join(f.docs, 'source.trm');
  const before = await readFile(path, 'utf8');
  const input = {
    operation: 'move' as const,
    termPatterns: ['_source:Order_'],
    to: 'target',
    externalSources: { code: 'src/**/*.ts' },
  };
  const preview = await f.author({ ...input, dryRun: true });
  expect(preview.files).toHaveLength(4);
  expect(await readFile(path, 'utf8')).toBe(before);
  const saved = await f.author(input);
  expect(saved.files).toEqual(preview.files);
  const target = await readFile(join(f.shared, 'target.trm'), 'utf8');
  expect(target.startsWith('\uFEFF')).toBe(true);
  expect(target.replaceAll('\r\n', '')).not.toContain('\n');
  expect(target).toContain('concept _Order_ in sales.entities');
  expect(target).toContain('Uses _source:Item_ and _target:Item_.');
  expect(target).toContain('  _source:Item_.contract†');
  expect(target).toContain('_source:Order_ remains opaque.');
  expect(await readFile(path, 'utf8')).toContain('Read _target:Order_†.');
  expect(await readFile(join(f.docs, 'third.trm'), 'utf8')).toContain('Read _target:Order_.');
  expect(await readFile(join(f.workspace, 'src/refs.ts'), 'utf8')).toBe(
    '// _target:Order_ _Order_ _target:Item_',
  );
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  const result = await f.read({ operation: 'view', termPatterns: ['_target:Order_'] });
  expect(result.termDeclarations.filter((e) => e.id === '_target:Order_')).toHaveLength(1);
  expect(result.sectionContext?.some((e) => e.id === '_source:Item_')).toBe(true);
});

test('batch moves preserve local links among selected Terms and leave empty source Knowledge intact', async () => {
  const f = await fixture();
  await f.write(
    'docs/source.trm',
    knowledgeSource(
      'source',
      'concept _A_ = {\n  Read _B_ and _source:A_.\n.relations\n  references _B_\n}\nconcept _B_ = { B. }',
    ),
  );
  await f.write('docs/target.trm', knowledgeSource('target'));
  await f.author({ operation: 'move', termPatterns: ['*'], knowledge: 'source', to: 'target' });
  expect(await readFile(join(f.docs, 'target.trm'), 'utf8')).toContain('Read _B_ and _target:A_.');
  expect((await f.read({ operation: 'list', knowledge: 'source' })).termDeclarations).toEqual([]);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('move refuses collisions, ambiguous selectors, invalid sources and missing destinations before saving', async () => {
  const f = await setup();
  const path = join(f.docs, 'source.trm');
  const before = await readFile(path, 'utf8');
  for (const [termPatterns, to, message] of [
    [['_Item_'], 'target', 'Ambiguous'],
    [['_source:Item_'], 'target', 'merge distinct Terms'],
    [['_source:Order_'], 'absent', 'Unknown Knowledge'],
    [['_target:Item_'], 'target', 'already belongs'],
    [['*missing*'], 'target', 'No Terms match'],
    [[], 'target', 'at least one'],
  ] as const) {
    await expect(
      f.author({ operation: 'move', termPatterns: [...termPatterns], to }),
    ).rejects.toThrow(message);
    expect(await readFile(path, 'utf8')).toBe(before);
  }
  await f.write('docs/other.trm', knowledgeSource('other', 'concept _Order_ = { Different. }'));
  await expect(
    f.author({
      operation: 'move',
      termPatterns: ['_source:Order_', '_other:Order_'],
      to: 'target',
    }),
  ).rejects.toThrow('merge distinct Terms');
  await f.write('docs/broken.trm', knowledgeSource('broken', 'concept _Broken_ = { _Missing_. }'));
  await expect(
    f.author({ operation: 'move', termPatterns: ['_source:Order_'], to: 'target' }),
  ).rejects.toThrow('reference');
  expect(await readFile(path, 'utf8')).toBe(before);
});

test('move refuses a same-name Term Kind with a different schema and invalid external text before writes', async () => {
  const f = await fixture();
  await f.write('docs/source.trm', knowledgeSource('source', 'concept _A_ = { A. }'));
  await f.write(
    'docs/target.trm',
    knowledgeSource('target').replace('@viewpoints spec', '@viewpoints other'),
  );
  const view = await readFile(join(f.home, 'viewpoint-other.md'), 'utf8');
  await f.write('.aterm/viewpoint-other.md', view.replace('A thing.', 'Another meaning.'));
  const input = { operation: 'move' as const, termPatterns: ['_source:A_'], to: 'target' };
  await expect(f.author(input)).rejects.toThrow('no compatible Term Kind');
  await f.write('.aterm/viewpoint-other.md', view);
  await expect(f.author(input)).rejects.toThrow('no compatible Term Kind spec.concept');
  await f.write('docs/target.trm', knowledgeSource('target'));
  await f.write('src/binary.ts', 'prefix');
  await writeFile(join(f.workspace, 'src/binary.ts'), Buffer.from([0, 255]));
  await expect(f.author({ ...input, externalSources: { code: 'src/*.ts' } })).rejects.toThrow(
    'UTF-8',
  );
  expect(await readFile(join(f.docs, 'source.trm'), 'utf8')).toContain('concept _A_');
  expect(await readFile(join(f.docs, 'target.trm'), 'utf8')).not.toContain('concept _A_');
});
