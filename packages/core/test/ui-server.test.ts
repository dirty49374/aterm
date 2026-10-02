import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, test } from 'vitest';
import { AtermServer, UIClient, serverProtocol } from '../src/index.js';
import { fixture } from './fixture.js';

async function setup() {
  const f = await fixture();
  await f.write('docs/SPEC-one.trm', 'concept _One_ = { First. }\n');
  const original = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  await f.write(
    '.aterm/aterm.yaml',
    original + `\nserver:\n  port: ${port}\n  controlToken: ${'t'.repeat(32)}\n`,
  );
  const app = await f.app(),
    server = new AtermServer(app.config);
  await server.start();
  return { f, app, server, client: new UIClient() };
}
async function browser(server: AtermServer) {
  const health = await (await fetch(server.url + '/api/health')).json();
  const id = randomUUID(),
    credential = randomUUID(),
    instance = randomUUID();
  const state = {
    location: '/graph/explore',
    view: 'graph',
    term: '',
    mode: 'explore',
    terms: [],
    selection: [],
    revision: 1,
    corpusRevision: health.revision,
    busy: false,
    visible: true,
    notes: { active: null, count: 0, open: false },
  };
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/api/ui/events', {
    origin: server.url,
  });
  const messages: any[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(
    JSON.stringify({
      type: 'hello',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      id,
      credential,
      instance,
      state,
      protocol: serverProtocol,
      home: health.home,
    }),
  );
  await expect.poll(() => messages.find((m) => m.type === 'ready')).toBeTruthy();
  return { socket, messages, id, credential, instance, state, health };
}

test('HTTP selects the matching Home, delivers canonical Terms once and waits for browser acknowledgement', async () => {
  const { f, app, server, client } = await setup();
  try {
    const b = await browser(server);
    const list = await client.request(app.config, { operation: 'session-list' });
    expect('sessions' in list && list.sessions[0]!.id).toBe(b.id);
    const id = randomUUID();
    const pending = client.request(app.config, {
      operation: 'open',
      session: b.id.slice(0, 6),
      id,
      terms: ['_One_'],
    });
    await expect.poll(() => b.messages.find((m) => m.type === 'command')).toBeTruthy();
    const delivered = b.messages.find((m) => m.type === 'command').command;
    expect(delivered.terms).toEqual(['_docs_spec_one:One_']);
    const inspection = await client.request(app.config, { operation: 'command-view', id });
    expect('command' in inspection && inspection.command.status).toBe('pending');
    b.socket.send(
      JSON.stringify({
        type: 'ack',
        id,
        status: 'applied',
        state: {
          ...b.state,
          term: '_docs_spec_one:One_',
          view: 'term-declarations',
          location: '/terms/docs_spec_one/One',
          revision: 2,
        },
      }),
    );
    const result = await pending;
    expect('command' in result && result.command.status).toBe('applied');
    expect(JSON.stringify(result)).not.toContain(b.credential);
    await client.request(app.config, { operation: 'open', session: b.id, id, terms: ['_One_'] });
    expect(b.messages.filter((m) => m.type === 'command')).toHaveLength(1);
    await expect(
      client.request(app.config, {
        operation: 'explore-add',
        session: b.id,
        id: randomUUID(),
        terms: ['_One_', '_Missing_'],
      }),
    ).rejects.toThrow('Unknown Term');
    expect(b.messages.filter((m) => m.type === 'command')).toHaveLength(1);
    await f.write('docs/SPEC-one.trm', 'concept _Other_ = { Replaced. }\n');
    await expect
      .poll(
        () => b.messages.find((m) => m.type === 'health' && m.health.revision > b.health.revision),
        { timeout: 4000 },
      )
      .toBeTruthy();
    const repeated = await client.request(app.config, {
      operation: 'open',
      session: b.id,
      id,
      terms: ['_One_'],
    });
    expect('command' in repeated && repeated.command.status).toBe('applied');
    expect(b.messages.filter((m) => m.type === 'command')).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('Notes target only the selected Session, preserve Markdown and require an acknowledgement before success', async () => {
  const { app, server, client } = await setup();
  try {
    const a = await browser(server),
      b = await browser(server),
      id = randomUUID();
    const request = {
      operation: 'note-send' as const,
      session: a.id,
      id,
      markdown: '# Explain\n\n_aterm:UI_Command_\n',
      title: 'UI control',
    };
    const pending = client.request(app.config, request);
    await expect.poll(() => a.messages.find((m) => m.type === 'command')).toBeTruthy();
    expect(a.messages.find((m) => m.type === 'command').command).toEqual(request);
    expect(b.messages.some((m) => m.type === 'command')).toBe(false);
    const result = await client.request(app.config, { operation: 'command-view', id });
    expect('command' in result && result.command.status).toBe('pending');
    a.socket.send(
      JSON.stringify({
        type: 'ack',
        id,
        status: 'applied',
        state: { ...a.state, notes: { active: id, count: 1, open: true }, revision: 2 },
      }),
    );
    const applied = await pending;
    expect('command' in applied && applied.command.state?.notes).toEqual({
      active: id,
      count: 1,
      open: true,
    });
    await client.request(app.config, request);
    expect(a.messages.filter((m) => m.type === 'command')).toHaveLength(1);
    await expect(
      client.request(app.config, { ...request, id: randomUUID(), markdown: '  ' }),
    ).rejects.toThrow();
    expect(a.messages.filter((m) => m.type === 'command')).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('known UI paths serve the shell while missing assets/API remain errors; Home, Origin and controller auth stay enforced', async () => {
  const { app, server } = await setup();
  try {
    for (const path of [
      '/terms/docs_spec_one/One',
      '/terms/docs_spec_one/One/references',
      '/graph/explore?term=_one%3AOne_',
      '/graph/structure',
      '/diagnostics',
    ]) {
      const response = await fetch(server.url + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('id="root"');
    }
    for (const path of ['/api/missing', '/missing.js', '/graph/missing'])
      expect((await fetch(server.url + path)).status).toBe(404);
    const request = (headers: Record<string, string>, home = app.home.home) =>
      fetch(server.url + '/api/ui', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Aterm-Protocol': String(serverProtocol),
          ...headers,
        },
        body: JSON.stringify({ home, request: { operation: 'session-list' } }),
      });
    expect((await request({}, '/wrong-home')).status).toBe(409);
    expect((await request({ Origin: 'http://evil.invalid' })).status).toBe(403);
    expect((await request({ Origin: server.url })).status).toBe(403);
    expect(
      (await request({ Origin: server.url, Authorization: `Bearer ${'t'.repeat(32)}` })).status,
    ).toBe(200);
    expect((await request({ Origin: server.url, Authorization: 'Bearer wrong' })).status).toBe(403);
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/api/ui/events', {
      origin: 'http://evil.invalid',
    });
    await expect(
      new Promise((resolve, reject) => {
        socket.on('open', resolve);
        socket.on('error', reject);
      }),
    ).rejects.toThrow('403');
  } finally {
    await server.close();
  }
});

test('published corpus revisions reach browser connections and server shutdown closes them without replay', async () => {
  const { f, server } = await setup();
  try {
    const b = await browser(server);
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Changed. }\n');
    await expect
      .poll(
        () => b.messages.find((m) => m.type === 'health' && m.health.revision > b.health.revision),
        { timeout: 4000 },
      )
      .toBeTruthy();
    await server.close();
    await expect.poll(() => b.socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    await server.close();
  }
});
