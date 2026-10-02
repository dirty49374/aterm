import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import { readRoute, routeUrl } from '../public/routes.js';
const read = (value: string) => readRoute(new URL(value, 'http://localhost'));
test('Term routes retain qualified identity and independent library filters', () => {
  const state = read(
    '/terms/other/Term/references?knowledge=local&termKind=skill.procedure&q=some+words',
  );
  expect(state).toMatchObject({
    selected: '_other:Term_',
    tab: 'references',
    knowledge: 'local',
    termKind: 'skill.procedure',
    q: 'some words',
  });
  expect(read(routeUrl(state))).toEqual(state);
});
test('legacy Graph links migrate without losing scope or reading target', () => {
  const state = read('/#term=_aterm%3AGraph_View_&view=graph&knowledge=aterm&q=graph');
  expect(routeUrl(state)).toBe('/graph/explore?q=graph&knowledge=aterm&term=_aterm%3AGraph_View_');
  expect(read(routeUrl(state))).toEqual(state);
  expect(read('/graph/structure').mode).toBe('structure');
});
test('diagnostics and empty Graph routes preserve their view without inventing a selected Term', () => {
  expect(routeUrl(read('/graph/explore'))).toBe('/graph/explore');
  expect(routeUrl(read('/diagnostics?term=_one%3AA_'))).toBe('/diagnostics?term=_one%3AA_');
});
test('Working Set routes preserve order, empty state and an independent Context target', () => {
  for (const path of ['term-declarations', 'references', 'graph/explore', 'graph/structure']) {
    const state = read(`/${path}?set=_one%3AA_&set=_two%3AA_&term=_one%3AB_`);
    expect(state.terms).toEqual(['_one:A_', '_two:A_']);
    expect(state.selected).toBe('_one:B_');
    expect(read(routeUrl(state))).toEqual(state);
  }
  expect(read('/term-declarations?set=').terms).toEqual([]);
  expect(read('/terms/one/A').terms).toEqual(['_one:A_']);
});
test('large Working Sets stay in history state without exceeding protocol URL limits', () => {
  const terms = Array.from({ length: 1000 }, (_, i) => `_one:Term_${i}_`);
  const state = { ...read('/term-declarations'), terms, selected: terms[0] };
  const url = routeUrl(state);
  expect(url.length).toBeLessThan(8192);
  const location = new URL(url, 'http://localhost');
  expect(
    readRoute({ pathname: location.pathname, search: location.search, state: { terms } }).terms,
  ).toEqual(terms);
});

test('GraphQL workspace routes preserve the Explorer Working Set', () => {
  const state = read('/queries?set=_one%3AA_&set=_two%3AB_&term=_one%3AC_');
  expect(state.page).toBe('graphql');
  expect(read(routeUrl(state))).toEqual(state);
});
