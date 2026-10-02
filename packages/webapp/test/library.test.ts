import { expect, test } from 'vitest';
import {
  knowledgeCatalog,
  libraryGroups,
  scopedTermDeclarations,
  termDeclarationKey,
  termDeclarationTermKind,
  // @ts-expect-error Native browser module is tested directly.
} from '../public/library-model.js';

const termDeclarations = [
  {
    id: '_orders:Item_',
    name: '_Item_',
    knowledge: 'orders',
    termKind: 'concept',
    viewpoint: 'domain',
    definition: 'Order item.',
  },
  {
    id: '_orders:Process_Order_',
    name: '_Process_Order_',
    knowledge: 'orders',
    termKind: 'procedure',
    viewpoint: 'spec',
    definition: 'Process order.',
  },
  {
    id: '_catalog:Item_',
    name: '_Item_',
    knowledge: 'catalog',
    termKind: 'concept',
    viewpoint: 'spec',
    definition: 'Catalog item.',
  },
];

test('Knowledge grouping preserves same-named Terms and filters individual Term Declarations without shrinking the corpus', () => {
  expect(libraryGroups(termDeclarations).map(([id]: [string]) => id)).toEqual([
    '_catalog:Item_',
    '_orders:Item_',
    '_orders:Process_Order_',
  ]);
  expect(
    libraryGroups(termDeclarations, {
      knowledge: 'orders',
      termKind: 'concept',
      viewpoint: 'spec',
    }),
  ).toEqual([]);
  expect(
    libraryGroups(termDeclarations, {
      knowledge: 'orders',
      termKind: 'procedure',
      viewpoint: 'spec',
    })[0][1],
  ).toHaveLength(1);
  expect(scopedTermDeclarations(termDeclarations, 'missing')).toEqual([]);
  expect(termDeclarations).toHaveLength(3);
});

test('Knowledge catalog counts Terms independently of Term Kinds and preserves empty Knowledges', () => {
  expect(
    knowledgeCatalog(
      [
        {
          id: 'orders',
          file: 'orders.trm',
          description: { content: 'Order lifecycle.', line: 3, endLine: 5 },
        },
        { id: 'empty', file: 'empty.trm' },
      ],
      termDeclarations,
    ),
  ).toEqual([
    {
      id: 'orders',
      file: 'orders.trm',
      description: { content: 'Order lifecycle.', line: 3, endLine: 5 },
      terms: 2,
      termDeclarations: 2,
    },
    { id: 'empty', file: 'empty.trm', terms: 0, termDeclarations: 0 },
  ]);
});

test('body search results intersect Knowledge and Term Declaration filters rather than admitting foreign matches', () => {
  const matchNames = new Set(['_catalog:Item_', '_orders:Process_Order_']);
  expect(
    libraryGroups(termDeclarations, { knowledge: 'orders', q: 'process', matchNames })[0][1],
  ).toEqual([termDeclarations[1]]);
  expect(
    libraryGroups(termDeclarations, {
      knowledge: 'orders',
      q: 'process',
      termKind: 'concept',
      matchNames,
    }),
  ).toEqual([]);
});

test('authored outline uses prefix hierarchy with Term Declaration-level membership and exact Knowledge boundaries', async () => {
  // @ts-expect-error Native browser module.
  const { groupTree } = await import('../public/library-model.js');
  const source = [
    { ...termDeclarations[0], group: 'items.concepts' },
    { ...termDeclarations[1], group: 'items.procedures' },
    { ...termDeclarations[2], group: 'items.concepts' },
  ];
  const tree = groupTree(source);
  expect(tree.map((node: any) => node.knowledge)).toEqual(['catalog', 'orders']);
  expect(
    tree[1].children[0].children.map((node: any) => [
      node.group,
      node.termDeclarations[0].termKind,
    ]),
  ).toEqual([
    ['items.concepts', 'concept'],
    ['items.procedures', 'procedure'],
  ]);
  expect(
    groupTree(libraryGroups(source, { termKind: 'procedure' }).flatMap(([, es]: any) => es))[0]
      .children[0].children,
  ).toHaveLength(1);
  expect(source[0]!.group).toBe('items.concepts');
});

test('Term Kind filtering distinguishes owners while Term Declaration identity is independent of classification', () => {
  const short = { ...termDeclarations[1], termKind: 'procedure', viewpoint: 'skill' };
  const qualified = { ...short, termKind: 'skill.procedure' };
  const domain = { ...short, termKind: 'domain.procedure', viewpoint: 'domain' };
  const different = { ...domain, id: '_orders:Other_Procedure_' };
  expect(termDeclarationKey(short)).toBe(termDeclarationKey(qualified));
  expect(termDeclarationKey(short)).toBe(termDeclarationKey(domain));
  expect(termDeclarationTermKind(short)).toBe('skill.procedure');
  expect(libraryGroups([qualified, different], { termKind: 'procedure' })).toHaveLength(2);
  expect(libraryGroups([qualified, different], { termKind: 'skill.procedure' })[0][1]).toEqual([
    qualified,
  ]);
  expect(
    libraryGroups([qualified, different], { termKind: 'skill.procedure', viewpoint: 'domain' }),
  ).toEqual([]);
});
