import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermParser, TermDeclarationIndex } from '../src/index.js';
import { fixture } from './fixture.js';

const knowledgeSource = (knowledge: string, body: string) =>
  `@knowledge ${knowledge}\n@viewpoints spec\n${body}\n`;
const setup = async () => {
  const f = await fixture();
  await f.write(
    'docs/orders.trm',
    knowledgeSource(
      'orders',
      'concept _Order_ = {\n  Uses _Item_† and _catalog:Item_†.\n.relations\n  references _Item_\n  references _catalog:Item_\n}\nconcept _Item_ = { Local item. }',
    ),
  );
  await f.write(
    'shared/catalog.trm',
    knowledgeSource(
      'catalog',
      'concept _Item_ = { Catalog item. }\nconcept _Root_ = {\n  Read _orders:Order_†.\n.relations\n  references _orders:Order_\n}',
    ),
  );
  return f;
};

test('Knowledge header is mandatory, flat, unique and before other directives', () => {
  const parser = new AtermParser();
  for (const text of [
    '@viewpoints spec\nconcept _A_ = { A. }',
    '@knowledge Upper\n@viewpoints spec',
    '@knowledge a.b\n@viewpoints spec',
    '@knowledge a/b\n@viewpoints spec',
    '@knowledge a\n@knowledge a\n@viewpoints spec',
    '@viewpoints spec\n@knowledge a',
    'concept _A_ = { A. }\n@knowledge a',
    '@knowledge a\n@viewpoints spec\nconcept _a:A_ = { A. }',
  ])
    expect(parser.parse('a.trm', text).diagnostics.length).toBeGreaterThan(0);
  const one = parser.parse('one.trm', '@knowledge empty\n@viewpoints spec');
  const two = parser.parse('two.trm', '@knowledge empty\n@viewpoints spec');
  expect(new TermDeclarationIndex([one, two]).diagnostics).toMatchObject([
    { file: 'two.trm', line: 1, message: expect.stringContaining('Duplicate Knowledge empty') },
  ]);
});

test('canonical identity preserves authored spelling, columns, BOM and qualified required references', () => {
  const text =
    '﻿@knowledge orders\r\n@viewpoints spec\r\nconcept _A_ = { _A_ _catalog:Item_† \\_catalog:Escaped_ _bad:_Suffix_ }';
  const parsed = new AtermParser().parse('one.trm', text);
  expect(parsed.diagnostics).toEqual([]);
  const termDeclaration = parsed.termDeclarations[0]!;
  expect(termDeclaration).toMatchObject({
    knowledge: 'orders',
    name: '_A_',
    id: '_orders:A_',
    line: 3,
  });
  expect(termDeclaration.references.map((r) => [r.name, r.id, r.required])).toEqual([
    ['_A_', '_orders:A_', undefined],
    ['_catalog:Item_', '_catalog:Item_', true],
  ]);
  for (const ref of termDeclaration.references)
    expect(
      text.split('\r\n')[ref.line - 1]!.slice(ref.column! - 1, ref.column! - 1 + ref.name.length),
    ).toBe(ref.name);
});

test('local references never fall back to a uniquely named Term in another Knowledge', async () => {
  const f = await fixture();
  await f.write(
    'docs/a.trm',
    knowledgeSource('a', 'concept _Owner_ = {\n  Read _Only_.\n.relations\n  references _Only_\n}'),
  );
  await f.write('docs/b.trm', knowledgeSource('b', 'concept _Only_ = { Unique elsewhere. }'));
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('Unresolved reference _a:Only_'),
      }),
    ]),
  );
  await expect(f.read({ operation: 'list', knowledge: 'b' })).rejects.toThrow('Unresolved');
});

test('exact selectors return all ambiguity candidates before filters; explicit contexts and globs select predictably', async () => {
  const f = await setup();
  const ambiguous = await f.read({
    operation: 'list',
    termPatterns: ['_Item_'],
    viewpoints: ['guide'],
  });
  expect(ambiguous.termDeclarations).toEqual([]);
  expect(ambiguous.ambiguity?.candidates.map((c) => c.id)).toEqual([
    '_catalog:Item_',
    '_orders:Item_',
  ]);
  expect(ambiguous.ambiguity?.hint).toContain('--knowledge');
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_Order_'] })).termDeclarations,
  ).toHaveLength(1);
  expect(
    (await f.read({ operation: 'search', searchText: '_Item_' })).termDeclarations,
  ).toHaveLength(3);
  expect(
    (await f.read({ operation: 'search', searchText: '_catalog:Item_' })).termDeclarations.map(
      (e) => e.id,
    ),
  ).toContain('_catalog:Item_');
  expect(
    (
      await f.read({ operation: 'show', termPatterns: ['_Item_'], knowledge: 'orders' })
    ).termDeclarations.map((e) => e.id),
  ).toEqual(['_orders:Item_']);
  expect(
    (await f.read({ operation: 'list', termPatterns: ['*Item*'] })).termDeclarations,
  ).toHaveLength(2);
  expect(
    (await f.read({ operation: 'list', termPatterns: ['_catalog:*_'] })).termDeclarations,
  ).toHaveLength(2);
  expect(
    (await f.read({ operation: 'list', knowledge: 'orders', termPatterns: ['*Missing*'] }))
      .termDeclarations,
  ).toEqual([]);
  await expect(
    f.read({ operation: 'show', knowledge: 'orders', termPatterns: ['_catalog:Item_'] }),
  ).rejects.toThrow('conflicts');
  await expect(f.read({ operation: 'list', knowledge: 'missing' })).rejects.toThrow(
    'Unknown Knowledge',
  );
  const context = await f.read({
    operation: 'view',
    knowledge: 'catalog',
    termPatterns: ['_Root_'],
  });
  expect(context.termDeclarations.map((e) => e.id)).toEqual([
    '_catalog:Root_',
    '_orders:Order_',
    '_orders:Item_',
    '_catalog:Item_',
  ]);
  expect(
    context.edges.some((e) => e.source === '_orders:Order_' && e.target === '_catalog:Item_'),
  ).toBe(true);
});

test('Term uniqueness is local to Knowledge, while duplicate Knowledge fails even with no Term Declarations', async () => {
  const f = await setup();
  const before = await readFile(join(f.docs, 'orders.trm'), 'utf8');
  await f.write('docs/orders.trm', before + '\nprocedure _Order_ = { Duplicate. }\n');
  const result = await f.read({ operation: 'check' });
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]!.message).toContain('_orders:Order_');
  await f.write('docs/orders.trm', knowledgeSource('orders', 'concept _Item_ = { Independent. }'));
  await f.write(
    'shared/catalog.trm',
    knowledgeSource('catalog', 'concept _Item_ = { Independent too. }'),
  );
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  await f.write('docs/duplicate.trm', knowledgeSource('orders', ''));
  expect((await f.read({ operation: 'check' })).diagnostics[0]!.message).toContain(
    'Duplicate Knowledge orders',
  );
});

test('Term rename rejects ambiguity and cross-Knowledge moves, preserves local spelling, and includes only qualified external tokens', async () => {
  const f = await setup();
  const path = join(f.docs, 'orders.trm');
  const original = await readFile(path, 'utf8');
  await f.write('src/refs.ts', '// _Item_ _orders:Item_ _catalog:Item_');
  const externalSources = { code: 'src/**/*.ts' };
  await expect(f.author({ operation: 'rename', from: '_Item_', to: '_Product_' })).rejects.toThrow(
    'Ambiguous',
  );
  await expect(
    f.author({ operation: 'rename', from: '_orders:Item_', to: '_catalog:Product_' }),
  ).rejects.toThrow('cannot move');
  const input = {
    operation: 'rename' as const,
    from: '_Item_',
    to: '_Product_',
    knowledge: 'orders',
    externalSources,
  };
  expect((await f.author({ ...input, dryRun: true })).files).toHaveLength(2);
  expect(await readFile(path, 'utf8')).toBe(original);
  await f.author(input);
  expect(await readFile(path, 'utf8')).toContain('Uses _Product_† and _catalog:Item_†');
  expect(await readFile(join(f.workspace, 'src/refs.ts'), 'utf8')).toBe(
    '// _Item_ _orders:Product_ _catalog:Item_',
  );
  expect(
    (await f.read({ operation: 'grep', referencePattern: '_orders:Product_', externalSources }))
      .externalOccurrences,
  ).toHaveLength(1);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('Knowledge rename updates header and qualified occurrences without touching local tokens, opaque code, file paths or permissions', async () => {
  const f = await setup();
  await f.write('docs/empty.trm', knowledgeSource('empty', ''));
  await f.write('src/refs.ts', '// _Order_ _orders:Order_ _catalog:Item_');
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  await f.write('.aterm/aterm.yaml', config + '\nexternalSources: { code: "src/**/*.ts" }\n');
  const input = { operation: 'rename-knowledge' as const, from: 'orders', to: 'sales' };
  const original = await readFile(join(f.docs, 'orders.trm'), 'utf8');
  expect((await f.author({ ...input, dryRun: true })).files).toHaveLength(3);
  expect(await readFile(join(f.docs, 'orders.trm'), 'utf8')).toBe(original);
  await expect(f.author({ ...input, to: 'catalog' })).rejects.toThrow('Duplicate Knowledge');
  await expect(f.author({ ...input, to: 'bad/id' })).rejects.toThrow('Invalid Knowledge');
  await f.author(input);
  expect(await readFile(join(f.docs, 'orders.trm'), 'utf8')).toBe(
    original.replace('@knowledge orders', '@knowledge sales'),
  );
  expect(await readFile(join(f.shared, 'catalog.trm'), 'utf8')).toContain('_sales:Order_†');
  expect(await readFile(join(f.workspace, 'src/refs.ts'), 'utf8')).toBe(
    '// _Order_ _sales:Order_ _catalog:Item_',
  );
  await f.author({ operation: 'rename-knowledge', from: 'empty', to: 'vacant' });
  await rename(join(f.docs, 'orders.trm'), join(f.docs, 'moved.trm'));
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_sales:Order_'] })).termDeclarations,
  ).toHaveLength(1);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('edit requires Knowledge before Term Kind and preserves identity', async () => {
  const f = await setup();
  const patch = (selector: string) =>
    `*** Begin Patch\n*** Update Term: ${selector}\n@@\n-concept _Item_ = { Local item. }\n+concept _Item_ = { Changed item. }\n*** End Patch`;
  await expect(f.author({ operation: 'edit', patch: patch('concept _Item_') })).rejects.toThrow(
    '--knowledge',
  );
  await f.author({ operation: 'edit', knowledge: 'orders', patch: patch('concept _Item_') });
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_orders:Item_'] })).termDeclarations[0]!
      .definition,
  ).toBe('Changed item.');
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_catalog:Item_'] })).termDeclarations[0]!
      .definition,
  ).toBe('Catalog item.');
});

test('Knowledge rename preserves header spelling, self-qualified references and opaque code with BOM/CRLF', async () => {
  const f = await fixture();
  const path = join(f.docs, 'header.trm');
  const source =
    '\uFEFF@knowledge knowledge  \r\n@viewpoints spec\r\nconcept _A_ = {\r\n  _A_ and _knowledge:A_†.\r\n  ```text\r\n  _knowledge:A_\r\n  ```\r\n}\r\n';
  await writeFile(path, source);
  await f.author({ operation: 'rename-knowledge', from: 'knowledge', to: 'next' });
  expect(await readFile(path, 'utf8')).toBe(
    source
      .replace('@knowledge knowledge', '@knowledge next')
      .replace('_knowledge:A_†', '_next:A_†'),
  );
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('Knowledge filters apply to file seeds and qualified globs without filtering required context', async () => {
  const f = await setup();
  const result = await f.read({
    operation: 'overview',
    files: ['docs/*.trm', 'shared/*.trm'],
    knowledge: 'catalog',
  });
  expect(result.conceptMap?.selected).toEqual(['_catalog:Item_', '_catalog:Root_']);
  expect(
    (
      await f.read({ operation: 'list', termPatterns: ['_*:Item_'], knowledge: 'catalog' })
    ).termDeclarations.map((e) => e.id),
  ).toEqual(['_catalog:Item_']);
});

test('read results expose every declared Knowledge including empty Knowledges independently of selected Term Declarations', async () => {
  const f = await setup();
  await f.write('docs/empty.trm', knowledgeSource('empty', ''));
  const result = await f.read({ operation: 'list', knowledge: 'orders' });
  expect(result.knowledges?.map((k) => [k.id, k.file.split('/').at(-1)])).toEqual([
    ['catalog', 'catalog.trm'],
    ['empty', 'empty.trm'],
    ['orders', 'orders.trm'],
  ]);
  expect(result.termDeclarations.every((e) => e.knowledge === 'orders')).toBe(true);
});
