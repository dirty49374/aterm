import { expect, test, vi } from 'vitest';
import { builtInRelations } from '../../core/src/syntax-module/relation.js';
// @ts-expect-error Native browser module.
import { GraphModel, termNode } from '../public/graph-model.js';
// @ts-expect-error Native browser module.
import { ExploreGraphModel } from '../public/graph-explore-model.js';
// @ts-expect-error Native browser module.
import { defaultEdgeFilters } from '../public/graph-state.js';
// The served controller imports identity.js, copied by the standard pre-test build.
// @ts-expect-error Native browser module.
import { GraphExplorer } from '../../core/webapp/graph.js';

const id = (name: string) => `_one:${name}_`;
const termDeclarations = ['A', 'B', 'C'].map((name) => ({
  id: id(name),
  knowledge: 'one',
  termKind: 'concept',
  viewpoint: 'specification',
  file: 'one.trm',
  line: 1,
  endLine: 20,
}));
const relations = [
  ...Object.entries(builtInRelations),
  ['uses', { type: 'association', structural: false }] as const,
].map(([phrase, semantics]) => ({
  source: id('A'),
  target: id('B'),
  phrase,
  ...semantics,
  origin: 'relation',
  locations: [{ file: 'one.trm', line: 4 }],
}));
const relation = (phrase: string) => relations.find((r) => r.phrase === phrase)!;
const raw = {
  source: id('B'),
  target: id('C'),
  phrase: 'references',
  type: 'reference',
  structural: false,
  origin: 'reference',
  locations: [{ file: 'one.trm', line: 7 }],
};
const edges = [...relations, raw];
const display = (name: string) => termNode([id(name)]);

for (const Model of [GraphModel, ExploreGraphModel]) {
  test(`${Model.name} filters each category before bundling without changing Node state`, () => {
    const model = new Model(termDeclarations, [{ id: 'one' }], edges);
    if (model.mode === 'explore')
      model.applyMembership(new Map(termDeclarations.map((e) => [e.id, true])));
    else for (const e of termDeclarations) model.reveal(e.id);
    model.select(model.mode === 'explore' ? id('A') : display('A'));
    const before = structuredClone({
      nodes: model.nodes,
      selection: model.selection,
      history: model.history,
    });
    const assertions = (categories?: string[]) =>
      model
        .project(edges, categories ? { categories } : undefined)
        .edges.flatMap((edge: any) => edge.edges);
    expect(new Set(assertions())).toEqual(new Set(edges));
    expect(assertions([])).toEqual([]);
    expect(new Set(assertions(['reference']))).toEqual(new Set([relation('references'), raw]));
    expect(assertions(['generalization'])).toEqual([relation('is_a')]);
    expect(assertions(['parthood'])).toEqual([relation('has_part')]);
    expect(assertions(['membership'])).toEqual([relation('has_member')]);
    expect(assertions(['state_membership'])).toEqual([relation('has_state')]);
    expect(assertions(['other'])).toEqual([
      relation('instance_of'),
      relation('has_property'),
      relation('derived_from'),
      relation('depends_on'),
      relation('realizes'),
      relation('uses'),
    ]);
    expect(new Set(assertions(['reference', 'membership']))).toEqual(
      new Set([relation('references'), raw, relation('has_member')]),
    );
    expect({ nodes: model.nodes, selection: model.selection, history: model.history }).toEqual(
      before,
    );
  });
}

test('Reference neighbors, directed columns and placement honor the same filter as drawn Edges', () => {
  const model = new ExploreGraphModel(termDeclarations, [], edges);
  const filters = { categories: ['reference'] };
  const columns = model.candidateColumns({ origin: id('B'), filters });
  expect(columns.incoming.map((row: any) => row.id)).toEqual([id('A')]);
  expect(columns.incoming[0].edges).toEqual([relation('references')]);
  expect(columns.outgoing.map((row: any) => row.id)).toEqual([id('C')]);
  expect(columns.outgoing[0].edges).toEqual([raw]);
  expect(model.candidateColumns({ origin: id('B'), filters: { categories: [] } })).toEqual({
    incoming: [],
    outgoing: [],
  });
  model.applyMembership(new Map([[id('B'), true]]));
  model.applyMembership(new Map([[id('C'), true]]), { origin: id('B'), filters });
  expect(model.nodes.get(id('C')).x).toBeGreaterThan(model.nodes.get(id('B')).x);
  expect(model.project(edges, filters).edges[0].edges).toEqual([raw]);
});

test('Structure Hide neighbors follows Reference visibility without retaining other neighbors', () => {
  const model = new GraphModel(termDeclarations, [{ id: 'one' }], [relation('is_a'), raw]);
  model.expand('knowledge:one');
  model.setFocus('knowledge:one');
  model.select(display('B'));
  model.hideOthers('neighbors', { categories: ['reference'] });
  expect(model.hidden.has(display('A'))).toBe(true);
  expect(model.hidden.has(display('C'))).toBe(false);
});

test('has_state exploration preserves direction and counts only eligible missing states', () => {
  const edge = relation('has_state');
  const model = new ExploreGraphModel(termDeclarations, [], [edge]);
  const filters = { categories: ['state_membership'] };
  model.applyMembership(new Map([[id('A'), true]]));
  expect(model.candidateColumns({ origin: id('A'), filters }).outgoing[0].edges).toEqual([edge]);
  expect(model.candidateColumns({ origin: id('A'), filters }).incoming).toEqual([]);
  expect(model.candidateColumns({ origin: id('B'), filters }).incoming[0].edges).toEqual([edge]);
  expect(model.project([edge], filters).unshown.get(id('A'))).toEqual({
    incoming: 0,
    outgoing: 1,
    total: 1,
  });
  expect(model.project([edge], { categories: ['other'] }).unshown.size).toBe(0);
  model.applyMembership(new Map([[id('B'), true]]), { origin: id('A'), filters });
  expect(model.project([edge], filters).edges[0]).toMatchObject({
    from: id('A'),
    to: id('B'),
    edges: [edge],
  });
  expect(model.project([edge], filters).unshown.get(id('A')).total).toBe(0);
});

test('mode defaults have independent category selections', () => {
  const structure = defaultEdgeFilters(),
    explore = defaultEdgeFilters();
  structure.categories.splice(0);
  expect(explore.categories).toEqual([
    'reference',
    'generalization',
    'parthood',
    'membership',
    'state_membership',
    'other',
  ]);
});

test('checkbox activation finishes before redraw, coalesces latest filters, and cancels on leaving the Graph', () => {
  const frames = new Map<number, () => void>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  try {
    const graph = new GraphExplorer({});
    graph.root = { isConnected: true, querySelector: () => null };
    graph.layout = { cancel: vi.fn() };
    graph.syncRelationSelector = vi.fn();
    graph.panel = vi.fn();
    graph.caption = vi.fn();
    const drawn: string[][] = [];
    graph.draw = () => drawn.push([...graph.filters.categories]);
    graph.setEdgeCategories(['reference']);
    graph.setEdgeCategories(['parthood']);
    expect(graph.filters.categories).toEqual(['parthood']);
    expect(drawn).toEqual([]);
    expect(frames.size).toBe(1);
    const paint = [...frames.values()][0]!;
    frames.clear();
    paint();
    expect(drawn).toEqual([['parthood']]);
    graph.setEdgeCategories([]);
    graph.stop();
    expect(frames.size).toBe(0);
    expect(drawn).toEqual([['parthood']]);
  } finally {
    vi.unstubAllGlobals();
  }
});
