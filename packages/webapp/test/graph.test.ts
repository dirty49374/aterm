import { expect, test, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkEngine } from 'elkjs/lib/elk-api.js';
// @ts-expect-error Native browser module.
import { GraphModel, groupNode, termNode, authoredGroupNode } from '../public/graph-model.js';
// @ts-expect-error Native browser module.
import * as graphLayout from '../public/graph-layout.js';
const { layoutInput, applyLayout, LayoutScheduler, layoutComponents } = graphLayout;

const termDeclarations = ['Machine', 'Inventory', 'Payment', 'Slot', 'Credit', 'Purchase'].map(
  (name) => ({
    id: `_one:${name}_`,
    knowledge: 'one',
    termKind: 'concept',
    viewpoint: 'specification',
    file: 'test.trm',
    line: 1,
    endLine: 9,
  }),
);
const knowledges = [{ id: 'one' }, { id: 'empty' }];
const relation = (source: string, target: string, type = 'membership') => ({
  source: `_one:${source}_`,
  target: `_one:${target}_`,
  type,
  phrase: type === 'parthood' ? 'has_part' : type === 'membership' ? 'has_member' : 'uses',
  origin: 'relation',
  structural: type !== 'association',
  locations: [{ file: 'test.trm', line: 1 }],
});
const edges = [
  relation('Machine', 'Inventory', 'parthood'),
  relation('Machine', 'Payment', 'parthood'),
  relation('Machine', 'Purchase'),
  relation('Inventory', 'Slot', 'parthood'),
  relation('Payment', 'Credit', 'parthood'),
  relation('Purchase', 'Credit', 'association'),
];
const engine = new (ELK as unknown as { new (): ElkEngine })();
async function layout(model: any) {
  const result = await layoutComponents(
    engine,
    layoutInput(model, model.project(model.edges).edges),
  );
  return applyLayout(model, result);
}

const ids = (...names: string[]) => names.map((name) => `_one:${name}_`);
const g = (...names: string[]) => groupNode(ids(...names).map((id) => id));
const t = (...names: string[]) => termNode(ids(...names).map((id) => id));

test('Knowledge overview includes empty Knowledges and shows Groups distinct from Terms', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  expect([...m.nodes.keys()]).toEqual(['knowledge:one', 'knowledge:empty']);
  expect(m.owner('_one:Credit_')).toBe('knowledge:one');
  m.expand('knowledge:one');
  expect(m.nodes.has(g('Machine'))).toBe(true);
  expect(m.nodes.has(t('Credit'))).toBe(true);
  expect(m.owners('_one:Credit_')).toContain(g('Machine'));
  expect(m.nodes.has(t('Machine'))).toBe(false);
});

test('selected Terms flatten collapsed containers and deduplicate occurrences and Term Kinds without changing Structure', () => {
  const m = new GraphModel(
    [...termDeclarations, { ...termDeclarations[4], termKind: 'entity', viewpoint: 'domain' }],
    knowledges,
    edges,
  );
  m.select('knowledge:empty');
  expect(m.selectedTerms()).toEqual([]);
  m.select('knowledge:one');
  expect(m.selectedTerms()).toEqual(
    termDeclarations.map((termDeclaration) => termDeclaration.id).sort(),
  );
  m.expand('knowledge:one');
  m.select(g('Payment'));
  m.select(t('Credit'), true);
  const selection = new Set(m.selection),
    expanded = new Set(m.expanded),
    history = m.history.length;
  expect(m.selectedTerms()).toEqual(ids('Credit', 'Payment'));
  expect(m.selection).toEqual(selection);
  expect(m.expanded).toEqual(expanded);
  expect(m.history).toHaveLength(history);
  m.select(g('Machine'));
  expect(m.selectedTerms()).toEqual(ids('Credit', 'Inventory', 'Machine', 'Payment', 'Slot'));
  m.select(t('Purchase'));
  expect(m.selectedTerms()).toEqual(ids('Purchase'));
  m.collapse('knowledge:one');
  expect(m.selectedTerms()).toEqual([]);
});
test('expanding a Group reveals its root Term; collapsing preserves Group identity and deeper state', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.expand('knowledge:one');
  const groupId = g('Machine');
  m.setFocus(groupId);
  const members = m.members(groupId);
  m.expand(groupId);
  expect(m.nodes.get(groupId).type).toBe('group');
  expect(m.nodes.get(t('Machine'))).toMatchObject({
    type: 'term',
    term: '_one:Machine_',
    parent: groupId,
    expandable: false,
  });
  expect(m.nodes.has(g('Machine', 'Payment'))).toBe(true);
  expect(m.nodes.has(t('Machine', 'Payment', 'Credit'))).toBe(false);
  m.expand(g('Machine', 'Payment'));
  expect(m.nodes.has(t('Machine', 'Payment'))).toBe(true);
  expect(m.nodes.has(t('Machine', 'Payment', 'Credit'))).toBe(true);
  m.collapse(groupId);
  expect(m.nodes.get(groupId).open).toBe(false);
  expect(m.nodes.has(t('Machine'))).toBe(false);
  expect(m.owner('_one:Credit_')).toBe(groupId);
  expect(m.members(groupId)).toEqual(members);
  m.expand(groupId);
  expect(m.nodes.has(t('Machine', 'Payment', 'Credit'))).toBe(true);
});
test('shared parts have distinct display instances while reading the same canonical Term', () => {
  const shared = [
    relation('Inventory', 'Slot', 'parthood'),
    relation('Payment', 'Slot', 'parthood'),
  ];
  const m = new GraphModel(termDeclarations, knowledges, shared);
  m.expand('knowledge:one');
  m.expand(g('Inventory'));
  m.expand(g('Payment'));
  expect(m.nodes.get(t('Inventory', 'Slot')).term).toBe('_one:Slot_');
  expect(m.nodes.get(t('Payment', 'Slot')).term).toBe('_one:Slot_');
  expect(m.owners('_one:Slot_')).toHaveLength(3); // Authored placement plus two derived occurrences.
  const links = m.project(shared).edges;
  const unshown = m.project(shared).unshown;
  expect(unshown.get(t('Slot'))).toEqual({ incoming: 2, outgoing: 0, total: 2 });
  expect(unshown.get(t('Inventory', 'Slot'))).toEqual({ incoming: 1, outgoing: 0, total: 1 });
  expect(links.map((e: any) => [e.from, e.to])).toEqual([
    [t('Inventory'), t('Inventory', 'Slot')],
    [t('Payment'), t('Payment', 'Slot')],
  ]);
  m.setFocus(g('Payment'));
  m.collapse(g('Payment'));
  m.reveal('_one:Slot_');
  expect(m.focus).toBe(g('Payment'));
  expect(m.selection.has(t('Payment', 'Slot'))).toBe(true);
});
test('cycles remain finite and terminal ancestor occurrences retain their assertions', () => {
  const cycle = [
    relation('Inventory', 'Payment', 'parthood'),
    relation('Payment', 'Inventory', 'parthood'),
  ];
  const m = new GraphModel(termDeclarations, knowledges, cycle);
  m.expand('knowledge:one');
  m.expand(g('Inventory'));
  m.expand(g('Inventory', 'Payment'));
  const repeated = t('Inventory', 'Payment', 'Inventory');
  expect(m.nodes.get(repeated)).toMatchObject({ type: 'term', expandable: false });
  expect(m.describe(g('Inventory', 'Payment', 'Inventory'))).toBeUndefined();
  m.expand(repeated);
  expect(m.expanded.has(repeated)).toBe(false);
  expect(m.project(cycle).edges.some((e: any) => e.to === repeated)).toBe(true);
  m.setFocus(g('Inventory', 'Payment'));
  expect(m.members(m.focus)).toEqual(ids('Inventory', 'Payment'));
});
test('Membership, state membership, Generalization, self relations and cross-Knowledge parts remain edges', () => {
  const foreign = { id: '_two:Other_', knowledge: 'two', termKind: 'concept' };
  const input = [
    relation('Machine', 'Inventory', 'generalization'),
    relation('Payment', 'Credit'),
    { ...relation('Payment', 'Slot', 'state_membership'), phrase: 'has_state' },
    relation('Payment', 'Payment', 'parthood'),
    { ...relation('Machine', 'Other', 'parthood'), target: foreign.id },
  ];
  const m = new GraphModel([...termDeclarations, foreign], [...knowledges, { id: 'two' }], input);
  m.expand('knowledge:one');
  expect([...m.nodes.values()].filter((n: any) => n.type === 'group')).toHaveLength(0);
  expect(m.project(input).edges).toHaveLength(5);
});
test('a Term has one Term Declaration while parthood can create multiple display locations', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.setFocus(g('Machine', 'Inventory'));
  m.expand(g('Machine', 'Inventory'));
  expect(m.terms.get('_one:Slot_')).toHaveLength(1);
  expect(
    [...m.nodes.values()].filter((n: any) => n.type === 'term' && n.term === '_one:Slot_'),
  ).toHaveLength(1);
});
test('expanded parthood remains an edge between the root Term and its visible parts', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.setFocus(g('Machine'));
  m.reveal('_one:Machine_');
  const link = m.project(edges).edges.find((e: any) => e.edges[0] === edges[0]);
  expect(link).toMatchObject({ from: t('Machine'), to: g('Machine', 'Inventory') });
  m.expand(g('Machine', 'Inventory'));
  expect(m.project(edges).edges.find((e: any) => e.edges[0] === edges[0])).toMatchObject({
    from: t('Machine'),
    to: t('Machine', 'Inventory'),
    bundle: false,
  });
  expect(m.project(edges).edges.some((e: any) => e.from === g('Machine'))).toBe(false);
  const before = [...m.nodes.keys()];
  expect(
    m
      .project(edges, { categories: ['generalization', 'parthood', 'membership'] })
      .edges.some((e: any) => e.edges[0].phrase === 'uses'),
  ).toBe(false);
  expect([...m.nodes.keys()]).toEqual(before);
});
test('Find reveals the Term leaf and its Group, preserving focus and Undo behavior', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.setFocus(g('Machine', 'Inventory'));
  m.reveal('_one:Credit_');
  expect(m.focus).toBe('knowledge:one');
  expect(m.nodes.has(t('Credit'))).toBe(true);
  expect(m.expanded.has(g('Machine', 'Inventory'))).toBe(false);
  m.undo();
  expect(m.focus).toBe(g('Machine', 'Inventory'));
  m.reveal('_one:Inventory_');
  expect(m.focus).toBe(g('Machine', 'Inventory'));
  expect(m.selection.has(t('Machine', 'Inventory'))).toBe(true);
  m.setFocus(null);
  expect(m.nodes.has('knowledge:empty')).toBe(true);
});
test('refresh preserves surviving Groups but clears removed Groups and invalid occurrence paths', () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.setFocus(g('Machine', 'Payment'));
  m.expand(g('Machine', 'Payment'));
  m.reconcile(termDeclarations, knowledges, edges);
  expect(m.focus).toBe(g('Machine', 'Payment'));
  expect(m.expanded.has(g('Machine', 'Payment'))).toBe(true);
  const withoutCredit = termDeclarations.filter((e) => e.id !== '_one:Credit_');
  m.reconcile(
    withoutCredit,
    knowledges,
    edges.filter((e) => e.target !== '_one:Credit_'),
  );
  expect(m.focus).toBe(null);
  expect(m.expanded.has(g('Machine', 'Payment'))).toBe(false);
  m.undo();
  expect([...m.nodes.values()].some((n: any) => n.term === '_one:Credit_')).toBe(false);
  m.setFocus(g('Machine', 'Inventory'));
  m.reconcile(
    termDeclarations,
    knowledges,
    edges.filter((e) => e !== edges[0]),
  );
  expect(m.focus).toBe(null);
});
test('real ELK nests Group frames and Term leaves with valid dimensions', async () => {
  const m = new GraphModel(termDeclarations, knowledges, edges);
  m.expand('knowledge:one');
  m.expand(g('Machine'));
  m.expand(g('Machine', 'Payment'));
  m.expand(g('Machine', 'Inventory'));
  await layout(m);
  expect(new Set(m.project(edges).edges.flatMap((e: any) => e.edges)).size).toBe(edges.length);
  for (const n of m.nodes.values()) {
    expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    if (n.parent) {
      const p = m.nodes.get(n.parent);
      expect(n.x).toBeGreaterThanOrEqual(p.x);
      expect(n.y).toBeGreaterThan(p.y);
      expect(n.x + n.width).toBeLessThanOrEqual(p.x + p.width);
      expect(n.y + n.height).toBeLessThanOrEqual(p.y + p.height);
    }
  }
});
test('large part structures can be expanded without node count refusal', async () => {
  const many = Array.from({ length: 75 }, (_, i) => ({
    id: `_one:T${i}_`,
    knowledge: 'one',
    termKind: 'concept',
    viewpoint: 'specification',
  }));
  const relations = many.map((e) => ({ ...relation('Inventory', 'X', 'parthood'), target: e.id }));
  const m = new GraphModel([...termDeclarations, ...many], knowledges, [...edges, ...relations]);
  m.reveal('_one:Inventory_');
  await layout(m);
  expect(m.members(g('Inventory'))).toHaveLength(77);
  expect(m.nodes.has(t('Inventory', 'T74'))).toBe(true);
});
test('collapsed connections aggregate without losing assertion identity or locations', () => {
  const foreign = { id: '_two:Other_', knowledge: 'two', termKind: 'concept' };
  const links = [
    { ...relation('Slot', 'Other', 'association'), target: foreign.id },
    { ...relation('Credit', 'Other', 'association'), target: foreign.id, phrase: 'reads' },
  ];
  const m = new GraphModel(
    [...termDeclarations, foreign],
    [...knowledges, { id: 'two' }],
    [...edges, ...links],
  );
  const projected = m.project([...edges, ...links]);
  expect(projected.edges).toHaveLength(1);
  expect(projected.edges[0].edges).toHaveLength(2);
  expect(projected.edges[0].edges[0].locations[0].line).toBe(1);
  expect(projected.internal.get('knowledge:one')).toBe(edges.length);
});
test('stale Worker results and failures cannot replace the latest layout', async () => {
  const pending: Array<{ resolve: (v: any) => void; reject: (e: Error) => void }> = [];
  const scheduler = new LayoutScheduler({
    layout: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  });
  const input = { children: [{ id: 'n' }], edges: [] };
  const first = scheduler.run(input),
    second = scheduler.run(input);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!.resolve({ children: [], width: 0, height: 0 });
  expect(await second).not.toBe(null);
  pending[0]!.reject(new Error('obsolete'));
  expect(await first).toBe(null);
  const canceled = scheduler.run(input);
  scheduler.cancel();
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  pending[2]!.resolve({ children: [], width: 0, height: 0 });
  expect(await canceled).toBe(null);
});

test('authored Groups are Knowledge-scoped prefixes and preserve different-Term Kind membership', () => {
  const data = [
    { ...termDeclarations[0], group: 'test.concepts' },
    {
      ...termDeclarations[0],
      id: '_one:Operate_Machine_',
      termKind: 'procedure',
      group: 'test.procedures',
    },
    { ...termDeclarations[1] },
  ];
  const m = new GraphModel(data, knowledges, []);
  const root = authoredGroupNode('one', 'test');
  const concepts = authoredGroupNode('one', 'test.concepts');
  const procedures = authoredGroupNode('one', 'test.procedures');
  const procedure = '_one:Operate_Machine_';
  expect(m.path('knowledge:one')).toEqual(['knowledge:one']);
  expect(m.path(concepts)).toEqual(['knowledge:one', root, concepts]);
  expect(m.path(t('Inventory'))).toEqual(['knowledge:one', t('Inventory')]);
  m.expand('knowledge:one');
  expect(m.nodes.has(root)).toBe(true);
  expect(m.nodes.has(t('Inventory'))).toBe(true);
  expect(m.nodes.has(concepts)).toBe(false);
  m.expand(root);
  m.expand(concepts);
  m.expand(procedures);
  expect(m.nodes.get(t('Machine')).parent).toBe(concepts);
  expect(m.nodes.get(termNode([procedure])).parent).toBe(procedures);
  m.collapse(procedures);
  m.setFocus(procedures);
  m.reveal('_one:Operate_Machine_', procedure);
  expect(m.focus).toBe(procedures);
  expect(m.selection.has(termNode([procedure]))).toBe(true);
  expect(m.terms.size).toBe(3);
});

test('derived Groups use only their Term Declaration declarations and retain target authored placement', () => {
  const concept = { ...termDeclarations[0], group: 'machine', line: 1, endLine: 5 };
  const procedure = {
    ...termDeclarations[0],
    id: '_one:Operate_Machine_',
    termKind: 'procedure',
    group: 'actions',
    line: 10,
    endLine: 15,
  };
  const target = { ...termDeclarations[1], group: 'inventory', line: 20, endLine: 25 };
  const m = new GraphModel([concept, procedure, target], knowledges, [edges[0]]);
  m.expand('knowledge:one');
  for (const group of ['machine', 'actions', 'inventory'])
    m.expand(authoredGroupNode('one', group));
  const procedureKey = procedure.id;
  expect(m.nodes.has(g('Machine'))).toBe(true);
  expect(m.nodes.has(groupNode([procedureKey]))).toBe(false);
  expect(m.nodes.has(termNode([procedureKey]))).toBe(true);
  m.expand(g('Machine'));
  expect(m.nodes.get(t('Inventory')).parent).toBe(authoredGroupNode('one', 'inventory'));
  expect(m.nodes.get(t('Machine', 'Inventory')).parent).toBe(g('Machine'));
  expect(
    m.project([edges[0]]).edges.every((edge: any) => edge.from !== termNode([procedureKey])),
  ).toBe(true);
  expect(m.termDeclarationMap.get(target.id).group).toBe('inventory');
});

test('moving a Term Declaration prunes unused authored Groups while preserving Term Declaration identity and references', () => {
  const m = new GraphModel([{ ...termDeclarations[0], group: 'old.deep' }], knowledges, []);
  m.setFocus(authoredGroupNode('one', 'old.deep'));
  m.expand(authoredGroupNode('one', 'old.deep'));
  m.reconcile([{ ...termDeclarations[0], group: 'new.deep' }], knowledges, []);
  expect(m.focus).toBe(null);
  expect(m.describe(authoredGroupNode('one', 'old'))).toBeUndefined();
  m.reveal('_one:Machine_');
  expect(m.nodes.get(t('Machine')).parent).toBe(authoredGroupNode('one', 'new.deep'));
});

test('all assertion types share a directed display Edge for Term Declarations and containers, with provenance and reverse direction retained', () => {
  const termDeclarations = ['A', 'B'].map((name) => ({
    id: `_one:${name}_`,
    termKind: 'concept',
    viewpoint: 'specification',
    knowledge: 'one',
    group: name.toLowerCase(),
    file: 'one.trm',
    line: 1,
    endLine: 10,
  }));
  const relations = ['creates', 'reads', 'references', 'is_a'].map((phrase, i) => ({
    source: termDeclarations[0]!.id,
    target: termDeclarations[1]!.id,
    phrase,
    origin: 'relation',
    type: i === 3 ? 'generalization' : 'association',
    structural: i === 3,
    locations: [{ file: 'one.trm', line: i + 1 }],
  }));
  const reverse = {
    ...relations[0]!,
    source: termDeclarations[1]!.id,
    target: termDeclarations[0]!.id,
    phrase: 'returns',
  };
  const model = new GraphModel(termDeclarations, [{ id: 'one' }], [...relations, reverse]);
  model.expand('knowledge:one');
  for (const expanded of [false, true]) {
    if (expanded) {
      model.reveal(termDeclarations[0]!.id);
      model.reveal(termDeclarations[1]!.id);
    }
    const projected = model.project(model.edges).edges;
    expect(projected).toHaveLength(2);
    const forward = projected.find((edge: any) => edge.edges.includes(relations[0]));
    const backward = projected.find((edge: any) => edge.edges.includes(reverse));
    expect(forward.edges).toEqual(relations);
    expect(backward.from).toBe(forward.to);
    expect(backward.to).toBe(forward.from);
    expect(forward.edges.map((edge: any) => edge.locations[0].line)).toEqual([1, 2, 3, 4]);
    expect(
      model.project(model.edges, { categories: ['generalization', 'parthood', 'membership'] })
        .edges[0].edges,
    ).toEqual([relations[3]]);
    if (expanded) expect(forward.from).toBe(termNode([termDeclarations[0]!.id]));
  }
});

test('Graph identity and selection survive Term Kind changes without another Term Declaration', () => {
  const source = { ...termDeclarations[0], group: 'first' };
  const model = new GraphModel([source], knowledges, []);
  const key = source.id;
  model.reveal(source.id, key);
  const selection = [...model.selection];
  expect(model.termDeclarationMap.size).toBe(1);
  model.reconcile([{ ...source, termKind: 'other.procedure', viewpoint: 'other' }], knowledges, []);
  expect([...model.selection]).toEqual(selection);
  expect(model.termDeclarationMap.has(key)).toBe(true);
  expect(model.termDeclarationMap.get(key).termKind).toBe('other.procedure');
});
