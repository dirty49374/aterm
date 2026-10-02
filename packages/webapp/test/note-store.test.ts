import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import { NoteStore } from '../src/note-store.js';

class MemoryStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const id = (n: number) => `${n.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const command = (n: number) => ({ id: id(n), markdown: `# Note ${n}\n\n_aterm:UI_Session_\n` });
const context = { location: '/graph/explore', terms: ['_aterm:UI_Session_'] };
const time = (n: number) => new Date(Date.UTC(2026, 8, 23, 12, 0, n)).toISOString();

test('Notes survive a new reader, retain exact Markdown/context and bound shared history to the latest ten', () => {
  const storage = new MemoryStorage();
  const a = new NoteStore('/one/.aterm', () => storage);
  const b = new NoteStore('/one/.aterm', () => storage);
  const other = new NoteStore('/other/.aterm', () => storage);
  other.receive(command(99), context, time(0));
  for (let n = 1; n <= 12; n++) (n % 2 ? a : b).receive(command(n), context, time(n));
  const reloaded = new NoteStore('/one/.aterm', () => storage).list();
  expect(reloaded.map((note: any) => note.title)).toEqual(
    Array.from({ length: 10 }, (_, i) => `Note ${12 - i}`),
  );
  expect(reloaded[0]).toMatchObject({
    id: id(12),
    markdown: command(12).markdown,
    context,
    receivedAt: time(12),
  });
  expect(other.list()).toHaveLength(1);
  expect(storage.length).toBe(11);
});

test('duplicate receipt keeps identity/time and refuses conflicting content without modifying history', () => {
  const storage = new MemoryStorage(),
    store = new NoteStore('/one', () => storage);
  const original = store.receive(command(1), context, time(1));
  expect(store.receive(command(1), { ...context, terms: [] }, time(2))).toEqual(original);
  expect(() => store.receive({ ...command(1), markdown: 'Different' }, context, time(3))).toThrow(
    'different',
  );
  expect(store.list()).toEqual([original]);
});

test('invalid cached records are ignored; storage refusal preserves prior Notes', () => {
  const storage = new MemoryStorage(),
    store = new NoteStore('/one', () => storage);
  store.receive(command(1), context, time(1));
  storage.setItem(store.prefix + 'bad', '{');
  storage.setItem(
    store.prefix + id(2),
    JSON.stringify({ ...store.list()[0], id: id(2), markdown: '' }),
  );
  expect(store.list()).toHaveLength(1);
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  expect(() => store.receive(command(3), context, time(3))).toThrow('could not be cached');
  expect(store.list().map((note: any) => note.id)).toEqual([id(1)]);
  const unavailable = new NoteStore('/one', () => {
    throw new Error('SecurityError');
  });
  expect(() => unavailable.receive(command(4), context, time(4))).toThrow('localStorage');
});
