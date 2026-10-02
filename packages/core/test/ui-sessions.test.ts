import { expect, test, vi } from 'vitest';
import { UISessions } from '../src/server-module/ui-sessions.js';
import { uiRequest, type UIState } from '../src/server-module/ui-protocol.js';

const first = 'aaaaaa11-1111-4111-8111-111111111111';
const second = 'aaaaaa22-2222-4222-8222-222222222222';
const command = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const credential = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const instance = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const state: UIState = {
  location: '/graph/explore',
  view: 'graph',
  term: '',
  mode: 'explore',
  terms: [],
  selection: [],
  revision: 1,
  corpusRevision: 1,
  busy: false,
  visible: true,
  notes: { active: null, count: 0, open: false },
};
const connection = () => ({ send: vi.fn(), close: vi.fn() });

test('Session prefixes expand through collisions, ambiguous selectors fail and heartbeat does not reorder activity', () => {
  let now = '2026-09-23T12:00:00.000Z';
  const registry = new UISessions(30000, () => now),
    a = connection(),
    b = connection();
  registry.register(first, credential, instance, state, a);
  now = '2026-09-23T12:01:00.000Z';
  registry.register(second, credential, instance, state, b);
  expect(registry.list().map((s) => s.shortId)).toEqual(['aaaaaa2', 'aaaaaa1']);
  expect(() => registry.get('aaaaaa')).toThrow('ambiguous');
  now = '2026-09-23T12:02:00.000Z';
  registry.update(first, a);
  expect(registry.list()[0]!.id).toBe(second);
  registry.update(first, a, state, true);
  expect(registry.list()[0]!.id).toBe(first);
  expect(registry.get('AAAAAA1').id).toBe(first);
  expect(JSON.stringify(registry.list())).not.toContain(credential);
  registry.close();
});

test('credentials protect identity; duplicate pages fail; same page reconnect and fresh server retain UUID', () => {
  const registry = new UISessions(),
    a = connection(),
    b = connection();
  registry.register(first, credential, instance, state, a);
  expect(() => registry.register(first, command, instance, state, b)).toThrow('credential');
  expect(() => registry.register(first, credential, command, state, b)).toThrow('another page');
  registry.register(first, credential, instance, state, b);
  expect(a.close).toHaveBeenCalledOnce();
  registry.disconnect(first, a);
  expect(registry.get(first).status).toBe('ready');
  registry.disconnect(first, b);
  expect(registry.get(first).status).toBe('disconnected');
  registry.register(first, credential, command, state, a);
  expect(registry.get(first).id).toBe(first);
  registry.close();
  const restarted = new UISessions();
  restarted.register(first, credential, command, state, b);
  expect(restarted.get(first).id).toBe(first);
  restarted.close();
});

test('receipt is pending; only the owning connection can acknowledge; a duplicate request delivers once', async () => {
  const registry = new UISessions(),
    a = connection(),
    b = connection();
  registry.register(first, credential, instance, state, a);
  registry.register(second, credential, instance, state, b);
  const request = { operation: 'explore-clear' as const, session: first, id: command };
  const pending = registry.execute(request);
  expect(registry.command(command).status).toBe('pending');
  expect(registry.get(first).status).toBe('busy');
  const repeated = registry.execute(request);
  registry.acknowledge(second, b, command, 'applied', state);
  expect(registry.command(command).status).toBe('pending');
  registry.acknowledge(first, a, command, 'applied', { ...state, revision: 2 });
  expect((await pending).status).toBe('applied');
  expect((await repeated).state!.revision).toBe(2);
  expect(a.send).toHaveBeenCalledOnce();
  await expect(
    registry.execute({ ...request, operation: 'explore-add', terms: ['_one:A_'] }),
  ).rejects.toThrow('different request');
  registry.close();
});

test('busy and disconnected Sessions refuse without delivery; timeout is unknown and late ack can settle it', async () => {
  vi.useFakeTimers();
  try {
    const registry = new UISessions(100),
      a = connection();
    registry.register(first, credential, instance, { ...state, busy: true }, a);
    const request = { operation: 'explore-clear' as const, session: first, id: command };
    await expect(registry.execute(request)).rejects.toThrow('busy');
    expect(a.send).not.toHaveBeenCalled();
    registry.update(first, a, state);
    const pending = registry.execute(request);
    await vi.advanceTimersByTimeAsync(101);
    expect((await pending).status).toBe('unknown');
    registry.acknowledge(first, a, command, 'applied', state);
    expect(registry.command(command).status).toBe('applied');
    registry.disconnect(first, a);
    await expect(registry.execute({ ...request, id: second })).rejects.toThrow('disconnected');
    registry.close();
  } finally {
    vi.useRealTimers();
  }
});

test('disconnect marks delivered commands unknown; reconnect never replays them and stale acknowledgement cannot apply', async () => {
  const registry = new UISessions(),
    a = connection(),
    b = connection();
  registry.register(first, credential, instance, state, a);
  const pending = registry.execute({ operation: 'explore-clear', session: first, id: command });
  registry.disconnect(first, a);
  expect((await pending).status).toBe('unknown');
  registry.register(first, credential, instance, state, b);
  registry.acknowledge(first, a, command, 'applied', state);
  expect(registry.command(command).status).toBe('unknown');
  expect(b.send).not.toHaveBeenCalled();
  registry.close();
});

test('UI requests require explicit targets, exact Terms and operation-specific fields', () => {
  expect(uiRequest.safeParse({ operation: 'explore-clear', id: command }).success).toBe(false);
  expect(
    uiRequest.safeParse({ operation: 'explore-clear', id: command, session: 'aaaaaa', terms: [] })
      .success,
  ).toBe(false);
  expect(
    uiRequest.safeParse({ operation: 'open', id: command, session: 'aaaaaa', terms: ['*Term*'] })
      .success,
  ).toBe(false);
  expect(
    uiRequest.safeParse({ operation: 'explore-set', id: command, session: 'aaaaaa', terms: [] })
      .success,
  ).toBe(false);
  expect(
    uiRequest.safeParse({ operation: 'explore-clear', id: command, session: 'aaaaaa' }).success,
  ).toBe(true);
});

test('server restart restores tab activity metadata without making reconnection a new activity', () => {
  const now = '2026-09-23T18:00:00.000Z';
  const registry = new UISessions(30000, () => now);
  const activity = {
    createdAt: '2026-09-23T10:00:00.000Z',
    lastActiveAt: '2026-09-23T17:00:00.000Z',
  };
  registry.register(first, credential, instance, state, connection(), activity);
  expect(registry.get(first)).toMatchObject({ ...activity, lastSeenAt: now });
  registry.register(second, credential, instance, state, connection(), {
    createdAt: '2099-01-01T00:00:00.000Z',
    lastActiveAt: '2099-01-01T00:00:00.000Z',
  });
  expect(registry.get(second)).toMatchObject({ createdAt: now, lastActiveAt: now });
  registry.close();
});
