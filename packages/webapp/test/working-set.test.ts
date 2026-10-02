import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import { WorkingSet } from '../public/working-set.js';
// @ts-expect-error Native browser module.
import { ExploreGraphModel } from '../public/graph-explore-model.js';

const termDeclarations = ['A', 'B', 'C'].map((name) => ({
  id: `_example:${name}_`,
  term: `_${name}_`,
  knowledge: 'example',
  termKind: 'concept',
  viewpoint: 'specification',
  file: 'example.trm',
  line: 1,
  sections: [],
}));
const [a, b, c] = termDeclarations.map((termDeclaration) => termDeclaration.id) as [
  string,
  string,
  string,
];
test('Working Set preserves order and distinguishes canonical identities', () => {
  const set = new WorkingSet([b, a, b]);
  set.apply([
    [a, true],
    [c, true],
  ]);
  expect(set.terms).toEqual([b, a, c]);
  expect(set.replace([b, a, c])).toBe(false);
  set.apply([
    [a, false],
    ['_another:A_', true],
  ]);
  expect(set.terms).toEqual([b, c, '_another:A_']);
  set.replace([]);
  expect(set.terms).toEqual([]);
});
test('Tree changes, Graph operations and Undo use the same membership', () => {
  const set = new WorkingSet([b, a]);
  const model = new ExploreGraphModel(termDeclarations, [], [], set);
  model.history = [];
  model.nodes.get(b).x = 500;
  model.select(b);
  set.apply([[c, true]]);
  expect([...model.nodes.keys()]).toEqual([b, a, c]);
  expect([...model.selection]).toEqual([b]);
  model.undo();
  expect(set.terms).toEqual([b, a]);
  expect([...model.nodes.keys()]).toEqual([b, a]);
  expect(model.nodes.get(b).x).toBe(500);
  model.applyMembership(new Map([[a, false]]));
  expect(set.terms).toEqual([b]);
  model.undo();
  expect(set.terms).toEqual([b, a]);
  set.replace([]);
  expect(model.nodes.size).toBe(0);
  model.undo();
  expect(set.terms).toEqual([b, a]);
});
test('Graph replacement preserves requested order and remains one Undo transaction', () => {
  const set = new WorkingSet([a]);
  const model = new ExploreGraphModel(termDeclarations, [], [], set);
  model.history = [];
  model.replaceMembership([c, b, a]);
  expect(set.terms).toEqual([c, b, a]);
  expect(model.history).toHaveLength(1);
  model.undo();
  expect(set.terms).toEqual([a]);
  model.replaceMembership([a, b]);
  model.history = [];
  model.replaceMembership([b, a]);
  expect(set.terms).toEqual([b, a]);
  expect(model.history).toHaveLength(1);
  model.undo();
  expect(set.terms).toEqual([a, b]);
});
