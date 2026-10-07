import { createServer } from 'node:net';
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns';
import { realpath, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { AtermDispatch, AtermServer, type AtermQuery } from '../src/index.js';
import { serverProtocol } from '../src/server-module/protocol.js';
import { AtermScanner } from '../src/corpus-module/index.js';
import { AtermSnapshot } from '../src/server-module/snapshot.js';
import { serverClientUrl } from '../src/server-module/address.js';
import { networkInterfaces } from 'node:os';
import { request, type IncomingHttpHeaders } from 'node:http';
import { fixture } from './fixture.js';

// Allow native event delivery and trailing debounce to settle.
const poll: typeof expect.poll = (callback, options) =>
  expect.poll(callback, { timeout: 4000, ...options });

async function availablePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

// Node fetch rewrites Host; use raw HTTP when the authority itself is under test.
function requestAuthority(url: string, headers: IncomingHttpHeaders, body?: string) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const req = request(url, { method: body ? 'POST' : 'GET', headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
      req.on('error', reject);
      req.end(body);
    },
  );
}

async function setup(extra = '') {
  const f = await fixture();
  await f.write('docs/SPEC-one.trm', 'concept _One_ = { First. }\n');
  const original = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  const port = await availablePort();
  const config = original + `\nserver:\n  port: ${port}\n  debounceMs: 150\n` + extra;
  await f.write('.aterm/aterm.yaml', config);
  const app = await f.app();
  const server = new AtermServer(app.config);
  const home = await realpath(f.home);
  const query = async (query: AtermQuery) =>
    fetch(server.url + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': String(serverProtocol) },
      body: JSON.stringify({ home, query }),
    });
  const health = async () =>
    (await fetch(server.url + '/api/health')).json() as Promise<{
      revision: number;
      ready: boolean;
    }>;
  return { f, app, server, query, health, config, original };
}

test('GraphQL HTTP, internal dispatch and local reads share projections and published snapshots', async () => {
  const { f, app, server, query } = await setup();
  const request = {
    query: 'query($id: ID!) { term(id: $id) { id termDeclarations { definition } } }',
    variables: { id: '_One_' },
  };
  const input = { operation: 'graphql' as const, graphql: request };
  const local = await app.query(input);
  if (!('response' in local)) throw new Error('Expected GraphQL.');
  await server.start();
  try {
    const post = (body: unknown) =>
      fetch(server.url + '/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const scan = vi.spyOn(AtermScanner.prototype, 'scan');
    expect(await (await post(request)).json()).toEqual(local.response);
    expect(await (await query(input)).json()).toEqual(local);
    expect(await new AtermDispatch().query(app, input)).toEqual(local);
    const filteredRequest = {
      query: `{ terms(where: """.definition == "First." """, orderBy:[{key:""".["@term"]""",direction:DESC}]) {nodes{id} totalCount} }`,
    };
    const filteredInput = { operation: 'graphql' as const, graphql: filteredRequest };
    const filtered = await (await post(filteredRequest)).json();
    expect(filtered.errors).toBeUndefined();
    expect(filtered.data.terms.totalCount).toBe(1);
    expect((await (await query(filteredInput)).json()).response).toEqual(filtered);
    expect(scan).not.toHaveBeenCalled();
    scan.mockRestore();
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Updated. }\n');
    await server.refresh();
    expect((await (await post(request)).json()).data.term.termDeclarations[0].definition).toBe(
      'Updated.',
    );
    expect((await post([{ query: '{__typename}' }])).status).toBe(400);
    expect(
      (await post({ query: '{__typename}', variables: null, operationName: null })).status,
    ).toBe(200);
    expect((await post({ query: ' '.repeat(1024 * 1024) })).status).toBe(413);
    expect((await post({ query: '{__typename}', home: '/other' })).status).toBe(400);
    expect((await fetch(server.url + '/graphql')).status).toBe(405);
    expect((await fetch(server.url + '/graphql', { method: 'POST', body: '{}' })).status).toBe(415);
    expect(
      (
        await fetch(server.url + '/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    const validation = await post({ query: '{ missing }' });
    expect(validation.status).toBe(200);
    expect((await validation.json()).errors[0].message).toContain('Cannot query field');
    expect(
      (
        await requestAuthority(
          server.url + '/graphql',
          {
            Host: `localhost:${server.port}`,
            Origin: 'https://other.example',
            'Content-Type': 'application/json',
          },
          JSON.stringify(request),
        )
      ).status,
    ).toBe(403);
  } finally {
    vi.restoreAllMocks();
    await server.close();
  }
});

test('HTTP preserves section expansion resources and authored source exactly like local reads', async () => {
  const { f, app, server, query } = await setup();
  await f.write(
    'docs/SPEC-one.trm',
    'concept _One_ = {\n  First.\n.relations\n  references _Rule_\n.contract\n  _Rule_.contract†\n}\nconcept _Rule_ = {\n  Rule.\n.contract\n  - Apply it here.\n}\n',
  );
  const input = { operation: 'view' as const, termPatterns: ['_One_'] };
  await server.start();
  try {
    const local = JSON.parse(JSON.stringify(await app.query(input)));
    const remote = await (await query(input)).json();
    expect(remote).toEqual(local);
    expect(
      remote.termDeclarations.map((termDeclaration: { name: string }) => termDeclaration.name),
    ).toEqual(['_One_']);
    expect(remote.termDeclarations[0].contract).toBe('_Rule_.contract†');
    expect(remote.sectionContext[0].contract).toBe('- Apply it here.');
  } finally {
    await server.close();
  }
});

test('server read results equal local results; dispatch falls back only when absent and writes stay local', async () => {
  const { f, app, server, query } = await setup();
  const dispatch = new AtermDispatch();
  const input = { operation: 'show' as const, termPatterns: ['_One_'] };
  expect(await dispatch.query(app, input)).toEqual(await app.query(input));
  await server.start();
  try {
    const local = JSON.parse(JSON.stringify(await app.query(input)));
    const spy = vi.spyOn(app, 'query');
    expect(await dispatch.query(app, input)).toEqual(local);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const rejected = await query({ operation: 'rename', from: '_One_', to: '_Two_' });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe('server.readonly');
    const moveRejected = await query({
      operation: 'move',
      termPatterns: ['_One_'],
      to: 'target',
      dryRun: true,
    });
    expect(moveRejected.status).toBe(400);
    expect((await moveRejected.json()).error.code).toBe('server.readonly');
    await dispatch.query(app, { operation: 'rename', from: '_One_', to: '_Two_' });
    await poll(
      async () =>
        (await (await query({ operation: 'show', termPatterns: ['_Two_'] })).json())
          .termDeclarations?.[0]?.name,
    ).toBe('_Two_');
    expect(await readFile(join(f.docs, 'SPEC-one.trm'), 'utf8')).toContain('_Two_');
  } finally {
    await server.close();
  }
  expect(
    (
      (await dispatch.query(await f.app(), { operation: 'list' })) as {
        termDeclarations: readonly unknown[];
      }
    ).termDeclarations,
  ).toHaveLength(1);
});

test('watching batches a burst and updates external references without a request-triggered refresh', async () => {
  const { f, server, query, health } = await setup('externalSources:\n  core: src/**/*.ts\n');
  await f.write('src/refs.ts', '// _docs_spec_one:One_');
  await server.start();
  try {
    const before = (await health()).revision;
    for (let i = 0; i < 4; i++) {
      await f.write(`docs/SPEC-added${i}.trm`, `concept _Added${i}_ = { Added. }`);
      await f.write('src/refs.ts', `// changed ${i}: _docs_spec_one:One_ _docs_spec_one:One_`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await health()).revision).toBe(before);
    await poll(async () => (await health()).revision, { timeout: 4000 }).toBe(before + 1);
    const result = await (await query({ operation: 'grep', referencePattern: '_One_' })).json();
    expect(result.externalOccurrences).toHaveLength(2);
    expect(result.externalOccurrences[0]).toMatchObject({
      file: 'src/refs.ts',
      line: 1,
      term: '_docs_spec_one:One_',
    });
    expect(
      (await (await query({ operation: 'search', searchText: 'changed 3' })).json())
        .externalMatches,
    ).toHaveLength(1);
    await rename(join(f.workspace, 'src/refs.ts'), join(f.workspace, 'src/moved.ts'));
    await poll(async () => (await health()).revision, { timeout: 4000 }).toBe(before + 2);
    expect(
      (await (await query({ operation: 'grep', referencePattern: '_One_' })).json())
        .externalOccurrences[0].file,
    ).toBe('src/moved.ts');
    await rm(join(f.workspace, 'src/moved.ts'));
    await poll(
      async () =>
        (await (await query({ operation: 'grep', referencePattern: '_One_' })).json())
          .externalOccurrences,
    ).toEqual([]);
  } finally {
    await server.close();
  }
});

test('config changes, invalid config and corpus errors recover; source watching can be disabled', async () => {
  const { f, server, query, health, config } = await setup(
    'externalSources:\n  core: src/**/*.ts\n',
  );
  await f.write('src/refs.ts', '// _docs_spec_one:One_');
  await server.start();
  try {
    const before = (await health()).revision;
    await f.write(
      '.aterm/aterm.yaml',
      config.replace('  debounceMs: 150', '  debounceMs: 150\n  watchExternal: false'),
    );
    await poll(async () => (await health()).revision).toBeGreaterThan(before);
    await poll(
      async () =>
        (await (await query({ operation: 'grep', referencePattern: '_One_' })).json())
          .externalOccurrences,
    ).toHaveLength(1);
    const revision = (await health()).revision;
    await f.write('src/refs.ts', '// _docs_spec_one:One_ disabled');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await health()).revision).toBe(revision);
    expect(
      (await (await query({ operation: 'grep', referencePattern: '_One_' })).json())
        .externalOccurrences[0].text,
    ).toContain('disabled');
    await f.write('.aterm/aterm.yaml', 'invalid: [');
    await poll(async () => (await health()).ready).toBe(false);
    expect((await query({ operation: 'list' })).status).toBe(400);
    await f.write('.aterm/aterm.yaml', config);
    await f.write(
      'docs/SPEC-one.trm',
      'concept _One_ = {\n  Uses _Missing_.\n.relations\n  references _Missing_\n}',
    );
    await poll(
      async () => (await (await query({ operation: 'check' })).json()).diagnostics?.[0]?.message,
    ).toContain('Unresolved');
    expect((await query({ operation: 'list' })).status).toBe(400);
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Repaired. }');
    await poll(
      async () => (await (await query({ operation: 'list' })).json()).termDeclarations,
    ).toHaveLength(1);
    expect((await health()).ready).toBe(true);
  } finally {
    await server.close();
  }
});

test('wrong Home, origin and protocol refuse; listener conflicts and remote errors never fall back', async () => {
  const { f, app, server, query } = await setup();
  await server.start();
  try {
    await expect(new AtermServer(app.config).start()).rejects.toThrow('Cannot listen');
    const other = await fixture();
    const config = await readFile(join(other.home, 'aterm.yaml'), 'utf8');
    await other.write('.aterm/aterm.yaml', config + `\nserver: { port: ${server.port} }\n`);
    await expect(
      new AtermDispatch().query(await other.app(), { operation: 'list' }),
    ).rejects.toThrow('another Home');
    expect(
      (
        await fetch(server.url + '/api/query', {
          method: 'POST',
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(server.url + '/api/query', { method: 'POST' })).status).toBe(400);
    expect((await fetch(server.url + '/api/query')).status).toBe(405);
    expect((await fetch(server.url + '/missing')).status).toBe(404);
    const identity = await fetch(server.url + '/identity.js');
    expect(identity.status).toBe(200);
    expect(await identity.text()).toContain('function termIdentity');
    expect(
      (
        await fetch(server.url + '/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': '2' },
          body: JSON.stringify({ home: app.home.home, query: { operation: 'list' } }),
        })
      ).status,
    ).toBe(400);
    await f.write(
      'docs/SPEC-one.trm',
      'concept _One_ = {\n  _Missing_.\n.relations\n  references _Missing_\n}',
    );
    await poll(async () => (await query({ operation: 'list' })).status).toBe(400);
    const spy = vi.spyOn(app, 'query');
    await expect(new AtermDispatch().query(app, { operation: 'list' })).rejects.toThrow(
      'Unresolved',
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await query({ operation: 'edit', patch: 'bad', dryRun: true })).status).toBe(400);
  } finally {
    await server.close();
  }
});

test('localhost serves the UI and same-origin queries while loopback refuses foreign Host and Origin', async () => {
  const { app, server } = await setup();
  await server.start();
  try {
    const url = `http://localhost:${server.port}`;
    expect((await fetch(url + '/')).status).toBe(200);
    expect((await fetch(url + '/graph.js')).status).toBe(200);
    const response = await fetch(url + '/api/query', {
      method: 'POST',
      headers: {
        Origin: url,
        'Content-Type': 'application/json',
        'X-Aterm-Protocol': String(serverProtocol),
      },
      body: JSON.stringify({ home: await realpath(app.home.home), query: { operation: 'list' } }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).termDeclarations[0].name).toBe('_One_');
    for (const headers of [
      { Host: `foreign.example:${server.port}`, Origin: `http://foreign.example:${server.port}` },
      { Host: `localhost:${server.port + 1}` },
      { Origin: server.url },
      { Origin: 'null' },
    ]) {
      expect((await requestAuthority(url + '/api/health', headers)).status).toBe(403);
    }
  } finally {
    await server.close();
  }
});

test('wildcard listening accepts network addresses and hostnames, rejects cross-origin reads and preserves CLI discovery', async () => {
  const { f, config } = await setup();
  await f.write('.aterm/aterm.yaml', config.replace('server:', 'server:\n  host: 0.0.0.0'));
  const app = await f.app();
  const server = new AtermServer(app.config);
  await server.start();
  try {
    const client = serverClientUrl(app.config.server!);
    expect(client).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.url).toBe(`http://0.0.0.0:${server.port}`);
    const input = { operation: 'list' as const };
    const local = JSON.parse(JSON.stringify(await app.query(input)));
    const spy = vi.spyOn(app, 'query');
    expect(await new AtermDispatch().query(app, input)).toEqual(local);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const hosts = [
      `aterm.example:${server.port}`,
      `192.0.2.10:${server.port}`,
      `[2001:db8::1]:${server.port}`,
    ];
    for (const host of hosts) {
      const response = await requestAuthority(
        client + '/api/query',
        {
          Host: host,
          Origin: `http://${host}`,
          'Content-Type': 'application/json',
          'X-Aterm-Protocol': String(serverProtocol),
        },
        JSON.stringify({ home: await realpath(f.home), query: input }),
      );
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual(local);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        (
          await requestAuthority(client + '/api/health', {
            Host: host,
            Origin: 'https://other.example',
          })
        ).status,
      ).toBe(403);
    }
    const external = Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === 'IPv4' && !address.internal);
    if (external)
      expect((await fetch(`http://${external.address}:${server.port}/`)).status).toBe(200);
    expect((await requestAuthority(client + '/api/health', { Host: 'localhost:1' })).status).toBe(
      403,
    );
  } finally {
    await server.close();
  }
});

test.each(['ipv4first', 'ipv6first'] as const)(
  'a configured localhost listener supports %s CLI discovery',
  async (order) => {
    const { f, config } = await setup();
    await f.write('.aterm/aterm.yaml', config.replace('server:', 'server:\n  host: localhost'));
    const app = await f.app();
    const server = new AtermServer(app.config);
    const previousOrder = getDefaultResultOrder();
    setDefaultResultOrder(order);
    try {
      await server.start();
      const local = JSON.parse(JSON.stringify(await app.query({ operation: 'list' })));
      const spy = vi.spyOn(app, 'query');
      expect(await new AtermDispatch().query(app, { operation: 'list' })).toEqual(local);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      setDefaultResultOrder(previousOrder);
      await server.close();
    }
  },
);

test.each([
  ['::', 'http://[::1]:43127'],
  ['0:0:0:0:0:0:0:0', 'http://[::1]:43127'],
  ['::1', 'http://[::1]:43127'],
  ['192.0.2.10', 'http://192.0.2.10:43127'],
])('CLI discovery converts bind address %s into a usable URL', (host, expected) => {
  expect(serverClientUrl({ host, port: 43127 })).toBe(expected);
});

test('server configuration validates host, port, debounce and external selection', async () => {
  const f = await fixture();
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  const awaitAppConfig = (await f.app()).config;
  expect(() => new AtermServer(awaitAppConfig)).toThrow('server.port');
  for (const server of [
    '{}',
    '{ port: 0 }',
    '{ port: 65536 }',
    '{ port: "43127" }',
    '{ port: 43127, host: "" }',
    '{ port: 43127, host: 123 }',
    '{ port: 43127, host: "http://localhost" }',
    '{ port: 43127, host: "127.0.0.1:43127" }',
    '{ port: 43127, host: "[::1]" }',
    '{ port: 43127, host: "example.com" }',
    '{ port: 43127, host: "fe80::1%eth0" }',
    '{ port: 43127, debounceMs: -1 }',
    '{ port: 43127, externalDirectories: [src] }',
  ]) {
    await f.write('.aterm/aterm.yaml', config + '\nserver: ' + server);
    await expect(f.app()).rejects.toThrow();
  }
  await f.write('.aterm/aterm.yaml', config + '\nserver: { port: 43127 }');
  expect((await f.app()).config.server?.host).toBe('127.0.0.1');
});

test('configured external selection has local/HTTP parity, overrides and scoped read failures', async () => {
  const { f, app, server, query } = await setup('externalSources:\n  core: src/**/*.ts\n');
  await f.write('src/refs.ts', '// _docs_spec_one:One_ _Unknown_ x_One_\n');
  await f.write('other/refs.ts', '// _docs_spec_one:One_ explicit');
  await server.start();
  try {
    const grep = { operation: 'grep' as const, referencePattern: '_One_' };
    expect(await (await query(grep)).json()).toEqual(
      JSON.parse(JSON.stringify(await app.query(grep))),
    );
    const explicit = await (
      await query({ ...grep, externalSources: { other: 'other/**/*.ts' } })
    ).json();
    expect(explicit.externalOccurrences).toHaveLength(1);
    expect(explicit.externalOccurrences[0].file).toBe('other/refs.ts');
    await f.write('src/refs.ts', 'bad\0text');
    await poll(async () => (await query(grep)).status).toBe(400);
    expect((await query({ operation: 'list' })).status).toBe(200);
    await f.write('src/refs.ts', '// repaired _docs_spec_one:One_');
    await poll(async () => (await (await query(grep)).json()).externalOccurrences).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('Explorer serves only its fixed assets with browser isolation headers', async () => {
  const { server } = await setup();
  await server.start();
  try {
    for (const [path, type] of [
      ['/', 'text/html'],
      ['/queries', 'text/html'],
      ['/app.js', 'text/javascript'],
      ['/markdown.js', 'text/javascript'],
      ['/mermaid.js', 'text/javascript'],
      ['/graph.js', 'text/javascript'],
      ['/graph-state.js', 'text/javascript'],
      ['/graph-explore-model.js', 'text/javascript'],
      ['/graph-model.js', 'text/javascript'],
      ['/graph-layout.js', 'text/javascript'],
      ['/graph-geometry.js', 'text/javascript'],
      ['/elk-api.js', 'text/javascript'],
      ['/elk-worker.min.js', 'text/javascript'],
      ['/force-layout-worker.js', 'text/javascript'],
      ['/app.css', 'text/css'],
    ]) {
      const response = await fetch(server.url + path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(type);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect((await response.text()).length).toBeGreaterThan(100);
    }
    expect((await fetch(server.url + '/', { method: 'POST' })).status).toBe(405);
    expect((await fetch(server.url + '/aterm.yaml')).status).toBe(404);
    expect((await fetch(server.url + '/%2e%2e/aterm.yaml')).status).toBe(404);
  } finally {
    await server.close();
  }
});

test('snapshot reads reuse memory without scanning and do not wait for an in-flight refresh', async () => {
  const { f, app } = await setup();
  const snapshot = new AtermSnapshot(app.home);
  await snapshot.start();
  const scan = vi.spyOn(AtermScanner.prototype, 'scan');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const input = { operation: 'show' as const, termPatterns: ['_One_'] };
    const original = await snapshot.query(input);
    await Promise.all([snapshot.query(input), snapshot.query(input), snapshot.query(input)]);
    expect(scan).not.toHaveBeenCalled();
    // The spy's original implementation is used after a deterministic blocked refresh.
    let entered = false;
    scan.mockImplementationOnce(async function (config) {
      entered = true;
      await gate;
      return new AtermScanner().scan(config);
    });
    await f.write('docs/SPEC-one.trm', 'concept _One_ = { Updated. }');
    await poll(() => entered).toBe(true);
    // Resolves before the refresh gate is released: stale-but-published reads are deliberate.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        snapshot.query(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Read waited for refresh')), 500);
        }),
      ]);
      expect(result).toEqual(original);
    } finally {
      clearTimeout(timer);
      release();
    }
    release();
    await poll(() => snapshot.revision).toBe(2);
    expect(await snapshot.query(input)).not.toEqual(original);
  } finally {
    release();
    await snapshot.close();
    scan.mockRestore();
  }
});

test('configured glob roots created after startup and source renaming update the published selection', async () => {
  const { f, server, query, config } = await setup('externalSources:\n  core: future/**/*.ts\n');
  await server.start();
  const references = async () =>
    (await (await query({ operation: 'grep', referencePattern: '_One_' })).json())
      .externalOccurrences;
  try {
    expect(await references()).toEqual([]);
    await f.write('future/nested/a.ts', '// _docs_spec_one:One_');
    await poll(references).toMatchObject([{ source: 'core', file: 'future/nested/a.ts' }]);
    await f.write('.aterm/aterm.yaml', config.replace('  core:', '  renamed:'));
    await poll(references).toMatchObject([{ source: 'renamed', file: 'future/nested/a.ts' }]);
    await f.write('.aterm/aterm.yaml', config.replace('future/**/*.ts', 'future/**/*.js'));
    await poll(references).toEqual([]);
  } finally {
    await server.close();
  }
});

test('Knowledge identity changes and file moves refresh HTTP identities, ambiguity and external references', async () => {
  const { f, app, server, query, health } = await setup(
    'externalSources: { code: "src/**/*.ts" }\n',
  );
  await f.write('src/refs.ts', '// _docs_spec_one:One_ _One_');
  await server.start();
  try {
    await f.write(
      'docs/two.trm',
      '@knowledge other\n@viewpoints spec\nconcept _One_ = { Independent. }',
    );
    await poll(
      async () =>
        (await (await query({ operation: 'show', termPatterns: ['_One_'] })).json()).ambiguity
          ?.candidates?.length,
    ).toBe(2);
    const dispatch = new AtermDispatch();
    await dispatch.query(app, {
      operation: 'rename-knowledge',
      from: 'docs_spec_one',
      to: 'renamed',
    });
    await poll(
      async () =>
        (await (await query({ operation: 'show', termPatterns: ['_renamed:One_'] })).json())
          .termDeclarations?.[0]?.id,
    ).toBe('_renamed:One_');
    const refs = await (
      await query({ operation: 'grep', referencePattern: '_renamed:One_' })
    ).json();
    expect(refs.externalOccurrences).toHaveLength(1);
    expect(refs.externalOccurrences[0].term).toBe('_renamed:One_');
    const revision = (await health()).revision;
    await rename(join(f.docs, 'SPEC-one.trm'), join(f.docs, 'moved.trm'));
    await poll(async () => (await health()).revision).toBeGreaterThan(revision);
    const moved = await (
      await query({ operation: 'show', termPatterns: ['_renamed:One_'] })
    ).json();
    expect(moved.termDeclarations[0].file).toBe(join(f.docs, 'moved.trm'));
    await f.write('docs/duplicate.trm', '@knowledge renamed\n@viewpoints spec\n');
    await poll(async () =>
      (await (await query({ operation: 'check' })).json()).diagnostics?.some(
        (d: { message: string }) => d.message.includes('Duplicate Knowledge'),
      ),
    ).toBe(true);
    await rm(join(f.docs, 'duplicate.trm'));
    await poll(
      async () => (await (await query({ operation: 'check' })).json()).diagnostics,
    ).toEqual([]);
  } finally {
    await server.close();
  }
});

test.each([
  ['has_part', 'parthood'],
  ['has_state', 'state_membership'],
])('HTTP and local reads expose identical %s semantics', async (phrase, type) => {
  const { f, app, server, query } = await setup();
  await f.write(
    'docs/SPEC-one.trm',
    `concept _One_ = {\n  First.\n.relations\n  ${phrase} _Target_†\n}\nconcept _Target_ = { A target. }\n`,
  );
  await server.start();
  try {
    const input = { operation: 'relations' as const, relationPhrases: ['has_*'] };
    const response = await query(input);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual(JSON.parse(JSON.stringify(await app.query(input))));
    expect(result.relations).toMatchObject([{ phrase, type, structural: true }]);
  } finally {
    await server.close();
  }
});

test('HTTP serves Knowledge and unified Skill reads with the same results as local queries', async () => {
  const { f, server, query } = await setup();
  const { viewpointSource } = await import('../src/index.js');
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  await f.write(
    '.aterm/aterm.yaml',
    config.replace('server:', '  skill: ' + join(viewpointSource, 'skill.md') + '\nserver:'),
  );
  await f.write(
    'docs/skill.trm',
    '@knowledge work\n@viewpoints skill\nskill _Skill_Work_ = {\n  Work.\n.description\n  Use to work.\n.body\n  Work instructions.\n}\n',
  );
  const local = await f.app();
  await server.start();
  try {
    for (const input of [
      { operation: 'knowledge-list' },
      { operation: 'knowledge-view', knowledgeIds: ['work'] },
      { operation: 'skill-list' },
      { operation: 'skill-view', skillTerms: ['_work:Skill_Work_'] },
    ] satisfies AtermQuery[]) {
      const response = await query(input);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(await local.query(input))));
    }
  } finally {
    await server.close();
  }
});

test('Viewpoint source is identical locally and over HTTP and refreshes with its snapshot', async () => {
  const { f, app, server, query } = await setup();
  const path = join(f.home, 'viewpoint-spec.md');
  const source = await readFile(path, 'utf8');
  const input = { operation: 'viewpoint' as const, viewpoints: ['spec'] };
  await server.start();
  try {
    const local = await app.query(input);
    expect(await (await query(input)).json()).toEqual(local);
    expect('viewpoints' in local && local.viewpoints[0]!.source).toBe(source);
    const revised =
      source.replace('name: spec', '# preserved\r\nname: spec').trimEnd() + '\r\n\r\n';
    await f.write('.aterm/viewpoint-spec.md', revised);
    await poll(async () => (await (await query(input)).json()).viewpoints?.[0]?.source).toBe(
      revised,
    );
    // A preexisting application reads its loaded configuration, never a live file in presentation.
    expect(await app.query(input)).toEqual(local);
    const fresh = await f.app();
    expect(await (await query(input)).json()).toEqual(await fresh.query(input));
  } finally {
    await server.close();
  }
});

test('Description changes refresh Knowledge reads and catalogs in the published snapshot', async () => {
  const { f, app, server, query } = await setup();
  const source =
    '@knowledge one\n@viewpoints spec\n@description {\n  Reader introduction.\n}\n@scope {\n  Writer obligations.\n}\nconcept _One_ = { First. }\n';
  await f.write('docs/SPEC-one.trm', source);
  const input = { operation: 'knowledge-view' as const, knowledgeIds: ['one'] };
  await server.start();
  try {
    expect(await (await query(input)).json()).toEqual(await app.query(input));
    await f.write(
      'docs/SPEC-one.trm',
      source.replace('Reader introduction.', 'Updated reader introduction.'),
    );
    await poll(
      async () => (await (await query(input)).json()).knowledges?.[0]?.description?.content,
    ).toBe('Updated reader introduction.');
    const remote = await (await query(input)).json();
    expect(remote.knowledges[0].scope.content).toBe('Writer obligations.');
    expect(remote).toEqual(await app.query(input));
    const catalog = await (await query({ operation: 'list' })).json();
    expect(catalog.knowledges[0].description).toEqual(remote.knowledges[0].description);
    expect(catalog.termDeclarations[0].name).toBe('_One_');
  } finally {
    await server.close();
  }
});

test('HTTP and local reads agree on overlapping qualified Term Kinds and owner filters', async () => {
  const { f, app, server, query } = await setup();
  await f.write(
    'docs/SPEC-one.trm',
    '@knowledge example\n@viewpoints spec other\nspec.procedure _Work_ = { First owner. }\nother.procedure _Other_Work_ = { Second owner. }\n',
  );
  await server.start();
  try {
    for (const input of [
      { operation: 'show' as const, termPatterns: ['_Work_'] },
      { operation: 'list' as const, viewpoints: ['other'] },
    ]) {
      const local = JSON.parse(JSON.stringify(await app.query(input)));
      const remote = await (await query(input)).json();
      expect(remote).toEqual(local);
      expect(remote.termDeclarations.map((e: { termKind: string }) => e.termKind)).toEqual(
        input.operation === 'show' ? ['spec.procedure'] : ['other.procedure'],
      );
    }
  } finally {
    await server.close();
  }
});

test('HTTP usage IDs identify completed and disconnected requests without recording URL queries', async () => {
  const { f, server } = await setup();
  let release!: () => void;
  let entered!: () => void;
  const arrived = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.useExtension({
    handle: async (req) => {
      if (!req.url?.startsWith('/slow')) return false;
      entered();
      await gate;
      return true;
    },
    close: async () => {
      release();
    },
  });
  await server.start();
  const records = async () =>
    (await readFile(join(f.home, 'usage.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  try {
    const response = await fetch(server.url + '/api/health');
    await response.text();
    const id = response.headers.get('x-aterm-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await poll(async () =>
      (await records()).some(
        (row) => row.requestId === id && row.event === 'finish' && row.outcome === 'ok',
      ),
    ).toBe(true);
    const pending = request(server.url + '/slow?private=DO_NOT_LOG_THIS');
    pending.on('error', () => {});
    pending.end();
    await arrived;
    pending.destroy();
    await poll(async () =>
      (await records()).some((row) => row.event === 'finish' && row.outcome === 'disconnected'),
    ).toBe(true);
    expect(await readFile(join(f.home, 'usage.jsonl'), 'utf8')).not.toContain('DO_NOT_LOG_THIS');
  } finally {
    release();
    await server.close();
  }
});
