import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import { GraphModel, termNode, authoredGroupNode, hiddenGroupNode } from '../public/graph-model.js';

const termDeclarations = ['A', 'B', 'C', 'D', 'E'].map((name) => ({
  id: `_one:${name}_`,
  knowledge: 'one',
  termKind: 'concept',
  viewpoint: 'specification',
  file: 'one.trm',
  line: 1,
  endLine: 9,
}));
const t = (name: string) => termNode([`_one:${name}_`]);
const g = (path: string) => authoredGroupNode('one', path);
const root = 'knowledge:one';
const h = (parent: string | null) => hiddenGroupNode(parent);
const relation = (from: string, to: string, structural = false) => ({
  source: `_one:${from}_`,
  target: `_one:${to}_`,
  phrase: structural ? 'is_a' : 'uses',
  origin: 'relation',
  type: structural ? 'generalization' : 'association',
  structural,
  locations: [{ file: 'one.trm', line: 2 }],
});
const edges = [relation('A', 'B'), relation('C', 'A', true), relation('B', 'D')];
function flat() {
  const m = new GraphModel(termDeclarations, [{ id: 'one' }], edges);
  m.expand(root);
  m.setFocus(root);
  return m;
}
function nested() {
  const data = termDeclarations.map((e, i) => ({
    ...e,
    group: i < 2 ? 'alpha' : i < 4 ? 'beta' : undefined,
  }));
  const m = new GraphModel(data, [{ id: 'one' }], edges);
  m.expand(root);
  m.expand(g('alpha'));
  m.setFocus(root);
  return m;
}

test('selection toggles individual instances without expansion, focus, hiding or geometry changes', () => {
  const m = flat();
  const before = {
    expanded: new Set(m.expanded),
    focus: m.focus,
    history: m.history.length,
    nodes: m.nodes,
  };
  m.select(t('A'));
  m.select(t('B'), true);
  expect([...m.selection]).toEqual([t('A'), t('B')]);
  m.select(t('A'), true);
  expect([...m.selection]).toEqual([t('B')]);
  m.select(t('C'));
  expect([...m.selection]).toEqual([t('C')]);
  expect(m.expanded).toEqual(before.expanded);
  expect(m.focus).toBe(before.focus);
  expect(m.nodes).toBe(before.nodes);
  expect(m.hidden.size).toBe(0);
  expect(m.history.length).toBe(before.history);
  m.select(null);
  expect(m.selection.size).toBe(0);
});

test('Hide selected-only and direct-neighbor modes differ by exactly one incoming/outgoing hop', () => {
  const m = flat();
  m.select(t('A'));
  m.hideOthers('selected');
  expect([...m.hidden].sort()).toEqual(['B', 'C', 'D', 'E'].map(t).sort());
  expect(m.nodes.get(h(root))).toMatchObject({ open: false, origin: 'hidden', parent: root });
  m.hideOthers('neighbors');
  expect([...m.hidden].sort()).toEqual(['D', 'E'].map(t).sort());
  expect(['A', 'B', 'C'].every((name) => m.nodes.has(t(name)))).toBe(true);
  // D is adjacent to B, not to the original Selection.
  expect(m.nodes.has(t('D'))).toBe(false);
  m.undo();
  expect([...m.hidden].sort()).toEqual(['B', 'C', 'D', 'E'].map(t).sort());
});

test('neighbors honor Relation visibility and union the original multiple Selection', () => {
  const m = flat();
  m.select(t('A'));
  m.hideOthers('neighbors', { categories: ['generalization', 'parthood', 'membership'] });
  expect([...m.hidden].sort()).toEqual(['B', 'D', 'E'].map(t).sort());
  m.showAll();
  m.select(t('A'));
  m.select(t('D'), true);
  m.hideOthers('neighbors');
  expect([...m.hidden]).toEqual([t('E')]);
});

test('empty Selection refuses hiding without a history or visibility change', () => {
  const m = flat();
  const count = m.history.length;
  m.hideOthers('selected');
  expect(m.hidden.size).toBe(0);
  expect(m.history.length).toBe(count);
});

test('selection transfer includes authored and Hidden Group members without unhiding them', () => {
  const m = nested();
  m.select(g('alpha'));
  expect(m.selectedTerms()).toEqual(['_one:A_', '_one:B_']);
  m.select(t('A'));
  m.hideOthers('selected');
  m.select(h(g('alpha')));
  expect(m.selectedTerms()).toEqual(['_one:B_']);
  m.select(h(root));
  expect(m.selectedTerms()).toEqual(['_one:C_', '_one:D_', '_one:E_']);
  expect(m.hidden.size).toBeGreaterThan(0);
});

test('unshown counts follow focus, collapsed internal assertions, Hidden boundaries and category filters', () => {
  const m = flat();
  expect(m.project(edges).unshown.get(t('A'))).toEqual({ incoming: 0, outgoing: 0, total: 0 });
  m.select(t('A'));
  m.hideOthers('selected');
  expect(m.project(edges).unshown.get(t('A'))).toEqual({ incoming: 1, outgoing: 1, total: 2 });
  expect(m.project(edges).unshown.get(h(root))).toEqual({ incoming: 2, outgoing: 2, total: 3 });
  m.expand(h(root));
  expect(m.project(edges).unshown.get(t('B'))).toEqual({ incoming: 1, outgoing: 0, total: 1 });
  expect(m.project(edges).unshown.get(t('D'))).toEqual({ incoming: 0, outgoing: 0, total: 0 });
  expect(m.project(edges, { categories: ['other'] }).unshown.get(t('A'))).toEqual({
    incoming: 0,
    outgoing: 1,
    total: 1,
  });
  expect(m.project(edges, { categories: [] }).unshown.size).toBe(0);
  m.showAll();
  m.setFocus(t('A'));
  expect(m.project(edges).unshown.get(t('A'))).toEqual({ incoming: 1, outgoing: 1, total: 2 });
  m.setFocus(null);
  m.collapse(root);
  expect(m.project(edges).unshown.get(root)).toEqual({ incoming: 3, outgoing: 3, total: 3 });
});

test('top-down hiding preserves ancestor paths and creates only necessary sibling Groups', () => {
  const m = nested();
  m.select(t('A'));
  m.hideOthers();
  expect([...m.hidden].sort()).toEqual([t('B'), g('beta'), t('E')].sort());
  expect([...m.hiddenGroups.keys()].sort()).toEqual([h(root), h(g('alpha'))].sort());
  expect(m.hiddenGroups.has(h(g('beta')))).toBe(false);
  expect(m.nodes.has(t('A'))).toBe(true);
  expect(m.nodes.has(g('alpha'))).toBe(true);
  m.showAll();
  m.select(g('alpha'));
  m.hideOthers();
  // Selecting an ordinary Group never implicitly retains its children.
  expect(m.hidden.has(t('A'))).toBe(true);
  expect(m.hidden.has(t('B'))).toBe(true);
  expect(m.hidden.has(g('alpha'))).toBe(false);
});

test('Hidden Group opens for selection; deep Unhide splits hidden branches without changing authored membership', () => {
  const m = nested();
  m.select(t('A'));
  m.hideOthers();
  const hidden = new Set(m.hidden);
  m.expand(h(root));
  m.expand(g('beta'));
  expect(m.nodes.get(t('C')).hiddenBy).toBe(h(root));
  m.select(t('C'));
  expect(m.hidden).toEqual(hidden);
  m.unhideSelected();
  expect(m.nodes.get(g('beta')).parent).toBe(root);
  expect(m.nodes.get(t('C'))).toMatchObject({ parent: g('beta'), hiddenBy: null });
  expect(m.hidden.has(t('D'))).toBe(true);
  expect(m.hidden.has(g('beta'))).toBe(false);
  expect(m.nodes.has(t('A'))).toBe(true); // A change of Selection does not reapply Hide.
  expect(m.termDeclarationMap.get('_one:C_').group).toBe('beta');
  m.undo();
  expect(m.hidden).toEqual(hidden);
  m.showAll();
  expect(m.hiddenGroups.size).toBe(0);
  expect(m.expanded.has(g('beta'))).toBe(true);
  expect(m.nodes.get(t('C')).parent).toBe(g('beta'));
});

test('unhiding all remaining siblings removes the empty Hidden Group and its expansion state', () => {
  const m = flat();
  m.select(t('A'));
  m.hideOthers();
  m.expand(h(root));
  m.select(h(root));
  m.unhideSelected();
  expect(m.hidden.size).toBe(0);
  expect(m.hiddenGroups.size).toBe(0);
  expect(m.expanded.has(h(root))).toBe(false);
  expect(['B', 'C', 'D', 'E'].every((name) => m.nodes.get(t(name)).parent === root)).toBe(true);
});

test('Unhide preserves selected visible Nodes alongside the selected hidden inputs', () => {
  const m = flat();
  m.select(t('A'));
  m.hideOthers();
  m.expand(h(root));
  m.select(t('B'), true);
  m.unhideSelected();
  expect(m.selection).toEqual(new Set([t('A'), t('B')]));
  expect(m.nodes.get(t('B')).hiddenBy).toBe(null);
  expect(m.hidden.has(t('C'))).toBe(true);
});

test('regrouping during refresh removes redundant omissions beneath a wholly hidden branch', () => {
  const m = nested();
  m.select(t('A'));
  m.hideOthers();
  m.reconcile(
    m.termDeclarations.map((termDeclaration: any) =>
      termDeclaration.id === '_one:B_' ? { ...termDeclaration, group: 'beta' } : termDeclaration,
    ),
    [{ id: 'one' }],
    edges,
  );
  expect(m.hidden.has(g('beta'))).toBe(true);
  expect(m.hidden.has(t('B'))).toBe(false);
  expect(m.hiddenGroups.has(h(g('beta')))).toBe(false);
});

test('hidden boundary Edges require preview even when selected, but interior Edges stay visible', () => {
  const m = flat();
  m.select(t('A'));
  m.hideOthers();
  const boundary = m.project(edges).edges.find((edge: any) => edge.from === t('A'));
  expect(boundary.concealedBy).toEqual([h(root)]);
  expect(m.edgeFeedback(boundary)).toEqual({ selected: true, highlighted: false, concealed: true });
  expect(m.edgeFeedback(boundary, [t('A')]).concealed).toBe(true);
  expect(m.edgeFeedback(boundary, [h(root)])).toEqual({
    selected: true,
    highlighted: true,
    concealed: false,
  });
  expect(m.edgeFeedback(boundary, [], true).concealed).toBe(false);
  m.expand(h(root));
  const links = m.project(edges).edges;
  const interior = links.find((edge: any) => edge.from === t('B'));
  expect(interior.to).toBe(t('D'));
  expect(interior.concealedBy).toEqual([]);
  expect(m.edgeFeedback(interior).concealed).toBe(false);
  const expandedBoundary = links.find((edge: any) => edge.from === t('A'));
  expect(m.edgeFeedback(expandedBoundary, [t('B')]).concealed).toBe(false);
});

test('refresh removes obsolete omissions; Reveal exposes a hidden path and Reset clears hiding', () => {
  const m = nested();
  m.select(t('A'));
  m.hideOthers();
  m.expand(h(root));
  const data = m.termDeclarations.filter(
    (termDeclaration: any) => termDeclaration.id !== '_one:E_',
  );
  m.reconcile(data, [{ id: 'one' }], edges);
  expect(m.hidden.has(t('E'))).toBe(false);
  expect(m.hidden.has(g('beta'))).toBe(true);
  expect(m.history).toEqual([]);
  m.reveal('_one:C_');
  expect(m.nodes.get(t('C'))).toMatchObject({ hiddenBy: null, parent: g('beta') });
  expect(m.hidden.has(t('D'))).toBe(true);
  m.reset();
  expect(m.hidden.size).toBe(0);
  expect(m.hiddenGroups.size).toBe(0);
  expect([...m.nodes.keys()]).toEqual([root]);
});
