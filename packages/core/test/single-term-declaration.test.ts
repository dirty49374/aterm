import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './fixture.js';

const source = (body: string, knowledge = 'orders') =>
  `@knowledge ${knowledge}\n@viewpoints spec other\n${body}\n`;
const patch = (target: string, before: string, after: string) =>
  `*** Begin Patch\n*** Update Term: ${target}\n@@\n-${before}\n+${after}\n*** End Patch`;

test.each([
  ['same Term Kind', 'spec.concept _Order_ = { Another. }'],
  ['different Term Kind', 'spec.procedure _Order_ = { Operate. }'],
  ['different Viewpoint', 'other.concept _Order_ = { Another perspective. }'],
  ['different Group', 'spec.concept _Order_ in other = { Another group. }'],
])('a Term cannot have a second Term Declaration with %s', async (_case, duplicate) => {
  const f = await fixture();
  await f.write(
    'docs/orders.trm',
    source('spec.concept _Order_ = { Order identity. }\n' + duplicate),
  );
  const checked = await f.read({ operation: 'check' });
  expect(checked.diagnostics).toHaveLength(1);
  expect(checked.diagnostics[0]!.message).toContain('Duplicate Term _orders:Order_');
  expect(checked.diagnostics[0]!.message).toContain('orders.trm:3');
  expect(checked.diagnostics[0]!.message).toContain('orders.trm:4');
  expect(checked.diagnostics[0]!.message).toContain('exactly one Term Declaration');
  for (const operation of ['list', 'show', 'view', 'overview'] as const)
    await expect(f.read({ operation, termPatterns: ['_Order_'] })).rejects.toThrow(
      'Duplicate Term',
    );
  const graphql = await (
    await f.app()
  ).query({ operation: 'graphql', graphql: { query: '{ terms { totalCount } }' } });
  if (!('response' in graphql)) throw new Error('Expected GraphQL result.');
  expect(graphql.response.data).toBeUndefined();
  expect(graphql.response.errors?.[0]?.message).toContain('Duplicate Term');
});

test('duplicate Terms stop semantic writes before changing corpus or external files', async () => {
  const f = await fixture();
  const body = source('spec.concept _Order_ = { Order. }\nother.procedure _Order_ = { Work. }');
  await f.write('docs/orders.trm', body);
  await f.write('docs/target.trm', source('', 'target'));
  await f.write('src/use.ts', '// _orders:Order_');
  for (const dryRun of [true, false])
    for (const query of [
      {
        operation: 'rename' as const,
        from: '_orders:Order_',
        to: '_Purchase_',
        externalSources: { code: 'src/**/*.ts' },
      },
      { operation: 'move' as const, termPatterns: ['_orders:Order_'], to: 'target' },
      { operation: 'format' as const },
      {
        operation: 'edit' as const,
        patch: patch(
          '_orders:Order_',
          'spec.concept _Order_ = { Order. }',
          'spec.concept _Order_ = { Changed. }',
        ),
      },
    ])
      await expect(f.author({ ...query, dryRun })).rejects.toThrow('Duplicate Term');
  expect(await readFile(join(f.docs, 'orders.trm'), 'utf8')).toBe(body);
  expect(await readFile(join(f.workspace, 'src/use.ts'), 'utf8')).toBe('// _orders:Order_');
});

test('Term Kind changes preserve Term Declaration identity and report derived guidance impacts', async () => {
  const f = await fixture();
  await f.write(
    'docs/orders.trm',
    source(
      'spec.concept _Order_ = { Order. }\nspec.concept _Guide_ = {\n  Explain.\n.relations\n  derived_from _Order_\n}',
    ),
  );
  const app = await f.app();
  const query = {
    operation: 'graphql' as const,
    graphql: {
      query:
        '{ term(id: "_orders:Order_") { id termDeclarations { id termKind { qualifiedName } } } }',
    },
  };
  const before = await app.query(query);
  const result = await f.author({
    operation: 'edit',
    patch: patch(
      '_orders:Order_',
      'spec.concept _Order_ = { Order. }',
      'other.procedure _Order_ = { Order. }',
    ),
  });
  expect(result.derivedImpacts.map((impact) => impact.term)).toContain('_orders:Guide_');
  const after = await (await f.app()).query(query);
  expect(JSON.stringify(before)).toContain('spec.concept');
  expect(JSON.stringify(after)).toContain('other.procedure');
  for (const result of [before, after]) {
    if (!('response' in result)) throw new Error('Expected GraphQL result.');
    const term = result.response.data!.term as { id: string; termDeclarations: { id: string }[] };
    expect(term.termDeclarations).toHaveLength(1);
    expect(term.termDeclarations[0]!.id).toBe(term.id);
  }
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test.each(['true', 'false', '"false"'])(
  'retired multiplicity setting %s is rejected',
  async (value) => {
    const f = await fixture();
    const path = join(f.home, 'aterm.yaml');
    await f.write(
      '.aterm/aterm.yaml',
      (await readFile(path, 'utf8')) + `\nallowMultipleEntriesPerTerm: ${value}\n`,
    );
    await expect(f.app()).rejects.toThrow('allowMultipleEntriesPerTerm');
  },
);

test('equal local names in different Knowledges and repeated references remain valid', async () => {
  const f = await fixture();
  await f.write(
    'docs/one.trm',
    source(
      'spec.concept _Order_ = {\n  Uses _other:Order_ twice: _other:Order_.\n.relations\n  references _other:Order_\n}',
      'one',
    ),
  );
  await f.write('docs/other.trm', source('other.procedure _Order_ = { Other identity. }', 'other'));
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  expect(
    (await f.read({ operation: 'list', termPatterns: ['*Order*'] })).termDeclarations,
  ).toHaveLength(2);
  await f.author({ operation: 'rename', from: '_other:Order_', to: '_Purchase_' });
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_one:Order_'] })).termDeclarations[0]!
      .definition,
  ).toBe('Uses _other:Purchase_ twice: _other:Purchase_.');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});
