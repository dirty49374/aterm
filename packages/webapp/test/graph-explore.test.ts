import { expect, test } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
// @ts-expect-error Native browser module.
import { ExploreGraphModel } from '../public/graph-explore-model.js';
// @ts-expect-error Native browser module.
import { layoutInput, layoutComponents, applyLayout } from '../public/graph-layout.js';

const termDeclarations = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `_one:${name}_`,
  knowledge: 'one',
  termKind: 'concept',
  viewpoint: 'specification',
  group: `group${i}`,
}));
const id = (name: string) => `_one:${name}_`;
const edge = (source: string, target: string, phrase = 'uses', type = 'association') => ({
  source: id(source),
  target: id(target),
  phrase,
  type,
  origin: 'relation',
  structural: type === 'parthood',
  locations: [{ file: 'one.trm', line: 4 }],
});
const edges = [
  edge('A', 'B', 'has_part', 'parthood'),
  edge('A', 'C'),
  edge('B', 'C'),
  edge('C', 'D'),
  edge('B', 'A', 'returns'),
];
const membership = (...names: string[]) => new Map(names.map((name) => [id(name), true]));

test('Explore starts empty and gives one canonical Node to multiple Term Kinds without authored or part containers', () => {
  const other = { ...termDeclarations[0], knowledge: 'two', id: '_two:A_' };
  const m = new ExploreGraphModel(
    [
      ...termDeclarations,
      { ...termDeclarations[0], termKind: 'entity', viewpoint: 'domain' },
      other,
    ],
    [{ id: 'one' }, { id: 'two' }],
    edges,
  );
  expect(m.nodes.size).toBe(0);
  m.applyMembership(new Map([...membership('A', 'B'), [other.id, true]]));
  expect(m.nodes.size).toBe(3);
  expect(m.nodes.get(id('A')).termDeclarations).toHaveLength(2);
  for (const node of m.nodes.values())
    expect(node).toMatchObject({ parent: null, expandable: false });
  expect(m.project(edges).edges).toHaveLength(2);
  expect(m.project(edges).edges[0].edges[0]).toBe(edges[0]);
});

test('one-hop candidates deduplicate neighbors, retain direction and phrases, and do not recursively expand', () => {
  const m = new ExploreGraphModel(termDeclarations, [], [...edges, edge('A', 'B', 'reads')]);
  m.applyMembership(membership('A'));
  expect(m.candidates(id('A'), 'outgoing').map((r: any) => r.id)).toEqual([id('B'), id('C')]);
  expect(m.candidates(id('A'), 'incoming')[0].edges[0].phrase).toBe('returns');
  expect(m.candidates(id('A'), 'outgoing')[0].edges).toHaveLength(2);
  m.applyMembership(membership('B'), { origin: id('A'), direction: 'outgoing' });
  expect([...m.nodes.keys()]).toEqual([id('A'), id('B')]);
  expect(m.nodes.get(id('B')).x).toBeGreaterThan(m.nodes.get(id('A')).x);
});

test('all included endpoint pairs connect, including cross-branch edges, reverse assertions and self-relations', () => {
  const assertions = [...edges, edge('A', 'A'), edge('A', 'B', 'reads')];
  const m = new ExploreGraphModel(termDeclarations, [], assertions);
  m.applyMembership(membership('A', 'B', 'C'));
  const projected = m.project(assertions).edges;
  expect(projected.flatMap((r: any) => r.edges)).toHaveLength(6);
  expect(projected.find((r: any) => r.from === id('B') && r.to === id('C'))).toBeDefined();
  expect(projected.find((r: any) => r.from === id('A') && r.to === id('B')).edges).toHaveLength(2);
  expect(
    m.project(assertions, { categories: ['generalization', 'parthood', 'membership'] }).edges,
  ).toHaveLength(1);
});

test('unshown counts include absent endpoints per assertion and exclude filtered categories and rendered bundles', () => {
  const assertions = [
    edge('A', 'B'),
    edge('A', 'B', 'reads'),
    edge('C', 'A'),
    edge('A', 'D', 'has_part', 'parthood'),
    edge('A', 'A'),
    { ...edge('D', 'A', 'references', 'reference'), origin: 'reference' },
  ];
  const m = new ExploreGraphModel(termDeclarations, [], assertions);
  m.applyMembership(membership('A'));
  expect(m.project(assertions).unshown.get(id('A'))).toEqual({
    incoming: 2,
    outgoing: 3,
    total: 5,
  });
  expect(m.project(assertions, { categories: ['other'] }).unshown.get(id('A'))).toEqual({
    incoming: 1,
    outgoing: 2,
    total: 3,
  });
  expect(m.project(assertions, { categories: [] }).unshown.size).toBe(0);
  m.applyMembership(membership('B'));
  expect(m.project(assertions).unshown.get(id('A'))).toEqual({
    incoming: 2,
    outgoing: 1,
    total: 3,
  });
  m.applyMembership(membership('C', 'D'));
  for (const counts of m.project(assertions).unshown.values())
    expect(counts).toEqual({ incoming: 0, outgoing: 0, total: 0 });
  m.applyMembership(new Map([[id('B'), false]]));
  expect(m.project(assertions).unshown.get(id('A'))).toEqual({
    incoming: 0,
    outgoing: 2,
    total: 2,
  });
});

test('membership changes preserve previous positions and selection; removal never prunes downstream neighbors', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A'));
  m.select(id('A'));
  const before = { ...m.nodes.get(id('A')) };
  m.applyMembership(membership('B', 'C'), { origin: id('A'), direction: 'incoming' });
  expect(m.nodes.get(id('A'))).toEqual(before);
  expect([...m.selection]).toEqual([id('A')]);
  expect(m.nodes.get(id('B')).x).toBeLessThan(before.x);
  const c = { ...m.nodes.get(id('C')) };
  m.applyMembership(new Map([[id('B'), false]]));
  expect(m.nodes.get(id('C'))).toEqual(c);
  expect(m.nodes.size).toBe(2);
  m.undo();
  expect(m.nodes.size).toBe(3);
  expect(m.nodes.get(id('C'))).toEqual(c);
});

test('a batch has one Undo snapshot, no-op has none, and refresh cannot resurrect deleted Terms', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B', 'C'));
  expect(m.history).toHaveLength(1);
  m.applyMembership(membership('A', 'B'));
  expect(m.history).toHaveLength(1);
  const before = { ...m.nodes.get(id('C')) };
  m.select(id('A'));
  m.reconcile(termDeclarations.slice(1), [], edges.slice(2));
  expect(m.nodes.get(id('C'))).toEqual(before);
  expect(m.nodes.has(id('A'))).toBe(false);
  expect(m.selection.size).toBe(0);
  expect(m.history).toHaveLength(0);
  m.undo();
  expect(m.nodes.has(id('A'))).toBe(false);
});

test('starting from a Term set replaces Explore in one undoable transaction without adding neighbors', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('C', 'D'));
  m.select(id('D'));
  Object.assign(m.nodes.get(id('D')), { x: 123, y: 456 });
  const before = m.snapshot(),
    history = m.history.length;
  expect(m.replaceMembership([id('A'), id('B'), id('A'), id('Missing')])).toBe(true);
  expect([...m.nodes.keys()]).toEqual([id('A'), id('B')]);
  expect([...m.selection]).toEqual([id('A'), id('B')]);
  expect(m.project(edges).edges).toHaveLength(2);
  expect(m.history).toHaveLength(history + 1);
  m.undo();
  expect(m.snapshot()).toEqual(before);
});

test('empty and unchanged starts preserve history; selecting the same membership can be undone', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B'));
  m.select(id('A'));
  const before = m.snapshot(),
    history = m.history.length;
  expect(m.replaceMembership([])).toBe(false);
  expect(m.replaceMembership([id('Missing')])).toBe(false);
  expect(m.snapshot()).toEqual(before);
  expect(m.history).toHaveLength(history);
  expect(m.replaceMembership([id('A'), id('B')])).toBe(true);
  expect(m.history).toHaveLength(history + 1);
  const selected = m.snapshot();
  expect(m.replaceMembership([id('B'), id('A')])).toBe(false);
  expect(m.snapshot()).toEqual(selected);
  expect(m.history).toHaveLength(history + 1);
  m.undo();
  expect(m.snapshot()).toEqual(before);
});

test('Term Kind and Viewpoint match one Term Declaration while Relation and search narrow only neighbor choices', () => {
  const m = new ExploreGraphModel(
    termDeclarations.map((termDeclaration, i) =>
      i === 1 ? { ...termDeclaration, termKind: 'entity', viewpoint: 'domain' } : termDeclaration,
    ),
    [],
    edges,
  );
  const options = { origin: id('A'), direction: 'outgoing', search: 'B' };
  expect(m.findCandidates({ ...options, termKind: 'entity', viewpoint: 'specification' })).toEqual(
    [],
  );
  expect(
    m.findCandidates({
      ...options,
      termKind: 'domain.entity',
      viewpoint: 'domain',
      phrase: 'has_part',
    }),
  ).toHaveLength(1);
  m.applyMembership(membership('A', 'B'));
  m.findCandidates({ ...options, phrase: 'nonexistent' });
  expect(m.nodes.size).toBe(2);
});

test('a large hub places only chosen neighbors without overlaps or moving existing Nodes', () => {
  const extra = Array.from({ length: 80 }, (_, i) => ({ ...termDeclarations[0], id: id(`N${i}`) }));
  const m = new ExploreGraphModel(
    [...termDeclarations, ...extra],
    [],
    extra.map((e) => ({ ...edge('A', 'B'), target: e.id })),
  );
  m.applyMembership(membership('A'));
  const before = { ...m.nodes.get(id('A')) };
  m.applyMembership(new Map(extra.slice(0, 30).map((e) => [e.id, true])), {
    origin: id('A'),
    direction: 'outgoing',
  });
  expect(m.nodes.size).toBe(31);
  expect(m.nodes.get(id('A'))).toEqual(before);
  expect(m.candidates(id('A'), 'outgoing')).toHaveLength(80);
  const nodes = [...m.nodes.values()] as any[];
  for (let i = 0; i < nodes.length; i++)
    for (const b of nodes.slice(i + 1)) {
      const a = nodes[i];
      expect(
        a.x >= b.x + b.width ||
          b.x >= a.x + a.width ||
          a.y >= b.y + b.height ||
          b.y >= a.y + a.height,
      ).toBe(true);
    }
});

test('explicit Layered arrangement uses directed horizontal flow for the flat graph', async () => {
  const m = new ExploreGraphModel(termDeclarations, [], [edge('A', 'B'), edge('B', 'C')]);
  m.applyMembership(membership('A', 'B', 'C'));
  const input = layoutInput(m, m.project(m.edges).edges);
  expect(input.layoutOptions['elk.direction']).toBe('RIGHT');
  const engine = new (ELK as any)();
  applyLayout(m, await layoutComponents(engine, input));
  expect(m.nodes.get(id('A')).x).toBeLessThan(m.nodes.get(id('B')).x);
  expect(m.nodes.get(id('B')).x).toBeLessThan(m.nodes.get(id('C')).x);
});

test('combined neighbor toggles synchronize duplicate Terms and preserve filtered-out choices until one Apply', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A'));
  const columns = m.candidateColumns({ origin: id('A') });
  expect(columns.incoming.map((r: any) => r.id)).toEqual([id('B')]);
  expect(columns.outgoing.map((r: any) => r.id)).toEqual([id('B'), id('C')]);
  const changes = new Map();
  m.toggleMembership(changes, Object.values(columns).flat());
  expect([...changes]).toEqual([
    [id('B'), true],
    [id('C'), true],
  ]);
  expect(m.nodes.size).toBe(1);
  m.toggleMembership(changes, columns.incoming);
  expect(m.includedAfter(changes, id('B'))).toBe(false);
  expect(m.includedAfter(changes, id('C'))).toBe(true);
  m.toggleMembership(changes, []);
  expect(changes.size).toBe(1);
  m.stageMembership(changes, id('B'), true);
  const history = m.history.length;
  m.applyMembership(changes, { origin: id('A') });
  expect(m.history.length).toBe(history + 1);
  expect(m.nodes.size).toBe(3);
  m.undo();
  expect([...m.nodes.keys()]).toEqual([id('A')]);
});

test('combined expansion places incoming-only neighbors left and outgoing or bidirectional neighbors right', () => {
  const m = new ExploreGraphModel(termDeclarations, [], [...edges, edge('D', 'A')]);
  m.applyMembership(membership('A'));
  const x = m.nodes.get(id('A')).x;
  m.applyMembership(membership('B', 'C', 'D'), { origin: id('A') });
  expect(m.nodes.get(id('D')).x).toBeLessThan(x);
  expect(m.nodes.get(id('B')).x).toBeGreaterThan(x);
  expect(m.nodes.get(id('C')).x).toBeGreaterThan(x);
});

test('Box selection intersects cards in any direction and uses the gesture-start additive set', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B', 'C'));
  for (const [i, node] of [...m.nodes.values()].entries())
    Object.assign(node, { x: i * 200, y: 100, width: 100, height: 50 });
  m.selectBox({ x: 290, y: 140 }, { x: -10, y: 80 });
  expect([...m.selection]).toEqual([id('A'), id('B')]);
  m.selectBox({ x: 420, y: 130 }, { x: 430, y: 135 }, [id('A')]);
  expect([...m.selection]).toEqual([id('A'), id('C')]);
  m.selectBox({ x: 800, y: 0 }, { x: 900, y: 10 }, [id('A')]);
  expect([...m.selection]).toEqual([id('A')]);
});

test('group move keeps relative positions, leaves other Nodes fixed and commits exactly one undoable snapshot', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B', 'C'));
  m.select(id('A'));
  m.select(id('B'), true);
  const before = m.snapshot(),
    history = m.history.length;
  const move = m.startMove(id('A'));
  m.previewMove(move, 20, -10);
  m.previewMove(move, 45, -30);
  expect(m.history.length).toBe(history);
  for (const name of ['A', 'B']) {
    expect(m.nodes.get(id(name)).x).toBe(before.nodes.get(id(name)).x + 45);
    expect(m.nodes.get(id(name)).y).toBe(before.nodes.get(id(name)).y - 30);
  }
  expect(m.nodes.get(id('C'))).toEqual(before.nodes.get(id('C')));
  m.finishMove(move);
  expect(m.history.length).toBe(history + 1);
  m.undo();
  expect(m.snapshot()).toEqual(before);
});

test('moving an unselected Node is independent; canceled and zero-displacement moves add no history', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B'));
  m.select(id('A'));
  const before = m.snapshot(),
    history = m.history.length;
  const canceled = m.startMove(id('B'));
  m.previewMove(canceled, -100, 60);
  expect([...m.selection]).toEqual([id('B')]);
  expect(m.nodes.get(id('A'))).toEqual(before.nodes.get(id('A')));
  m.finishMove(canceled, false);
  expect(m.snapshot()).toEqual(before);
  expect(m.history.length).toBe(history);
  const zero = m.startMove(id('A'));
  m.previewMove(zero, 50, 40);
  m.previewMove(zero, 0, 0);
  m.finishMove(zero);
  expect(m.history.length).toBe(history);
  expect(m.snapshot()).toEqual(before);
});

test('clearing all included Terms is one Undo transaction and restores their positions and Selection', () => {
  const m = new ExploreGraphModel(termDeclarations, [], edges);
  m.applyMembership(membership('A', 'B'));
  m.select(id('A'));
  const before = m.snapshot();
  const history = m.history.length;
  m.applyMembership(new Map([...m.nodes.keys()].map((key) => [key, false])));
  expect(m.nodes.size).toBe(0);
  expect(m.selection.size).toBe(0);
  expect(m.history.length).toBe(history + 1);
  m.undo();
  expect(m.snapshot()).toEqual(before);
});
