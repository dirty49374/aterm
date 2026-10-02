import { expect, test } from 'vitest';
import {
  queryParameters,
  parseVariables,
  queryResultTerms,
  incompleteQueryResults,
  queryExamples,
// @ts-expect-error Native browser module.
} from '../src/query-model.js';
// @ts-expect-error Native browser module.
import { QueryStore } from '../src/query-store.js';
class Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(n: number) {
    return [...this.data.keys()][n] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const record = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Trip',
  query: queryExamples[1].query,
  variables: JSON.stringify(queryExamples[1].variables),
  operationName: '',
  updatedAt: '2026-10-01T12:00:00Z',
};
test('saved queries preserve exact documents and variables across reloads and isolate Homes', () => {
  const storage = new Storage(),
    store = new QueryStore('/one', () => storage);
  store.save(record);
  expect(new QueryStore('/one', () => storage).list()).toEqual([record]);
  expect(new QueryStore('/two', () => storage).list()).toEqual([]);
  const changed = { ...record, name: 'Changed', updatedAt: '2026-10-01T12:00:01Z' };
  store.save(changed, record.updatedAt);
  expect(() => store.save(record, record.updatedAt)).toThrow('another tab');
  expect(() => store.remove(record.id, record.updatedAt)).toThrow('another tab');
  store.remove(record.id, changed.updatedAt);
  expect(() => store.save(changed, changed.updatedAt)).toThrow('deleted');
  expect(store.list()).toEqual([]);
});
test('quota failures and malformed records never erase saved queries', () => {
  const storage = new Storage(),
    store = new QueryStore('/one', () => storage);
  store.save(record);
  storage.setItem(store.prefix + 'invalid', '{');
  expect(store.list()).toEqual([record]);
  storage.setItem = () => {
    throw Error('QuotaExceeded');
  };
  expect(() => store.save({ ...record, name: 'New' }, record.updatedAt)).toThrow('not saved');
  expect(store.list()).toEqual([record]);
});
test('parameter discovery distinguishes omission, defaults, lists and operation selection', () => {
  const query =
    'query A($date:String!, $limit:Int=10, $ids:[ID!], $enabled:Boolean!, $options:JSON){terms{totalCount}} query B {terms{totalCount}}';
  expect(() => queryParameters(query)).toThrow('operation');
  expect(queryParameters(query, 'A')).toMatchObject([
    { name: 'date', scalar: 'String', required: true },
    { name: 'limit', scalar: 'Int', required: false, defaultValue: 10 },
    { name: 'ids', type: '[ID!]', required: false },
    { name: 'enabled', scalar: 'Boolean', required: true },
    { name: 'options', scalar: 'JSON' },
  ]);
  expect(() => queryParameters('mutation { x }')).toThrow('read-only');
  for (const example of queryExamples) expect(queryParameters(example.query)).not.toHaveLength(0);
  expect(parseVariables('{"date":null}')).toEqual({ date: null });
  for (const invalid of ['null', '[]', '"x"'])
    expect(() => parseVariables(invalid)).toThrow('object');
});
test('Term results deduplicate canonical IDs and warn about unfinished collections', () => {
  const data = {
    terms: {
      nodes: [{ id: '_a:A_', definition: '_a:B_' }, { id: '_a:A_' }, { id: '_unknown:X_' }],
      pageInfo: { hasNextPage: true },
    },
    relations: { nodes: [{ target: { id: '_a:B_' } }] },
    jq: [{ '@term': '_a:C_' }],
  };
  expect(queryResultTerms(data, new Set(['_a:A_', '_a:B_', '_a:C_']))).toEqual([
    '_a:A_',
    '_a:B_',
    '_a:C_',
  ]);
  expect(incompleteQueryResults(data)).toBe(1);
});
