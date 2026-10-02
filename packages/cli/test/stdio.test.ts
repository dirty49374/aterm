import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AtermApplication,
  AtermServer,
  SkillCatalog,
  serverProtocol,
  viewpointSource,
} from '@aterm/core';
import { CommandEndpoint } from '../src/mcp-module/endpoint.js';
import type { ICommandResult } from '../src/command-runner.js';

const termDeclaration = new URL('../dist/entry.js', import.meta.url).pathname;
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}
const knowledgeSource =
  '@knowledge sample\n@viewpoints specification\nconcept _Original_ = {\n  One stable subject.\n}\n';
async function fixture(withPort = false) {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-stdio-'));
  cleanups.push(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, '.aterm'));
  await mkdir(join(workspace, 'docs'));
  const port = await freePort();
  const source =
    `useDefaultKnowledge: false\nuseViewpoints: []\nsources: [docs]\nviewpoints:\n  specification: ${join(viewpointSource, 'specification.md')}\n` +
    (withPort ? `server:\n  host: 127.0.0.1\n  port: ${port}\n  debounceMs: 60000\n` : '');
  await writeFile(join(workspace, '.aterm/aterm.yaml'), source);
  await writeFile(join(workspace, 'docs/sample.trm'), knowledgeSource);
  return {
    workspace,
    home: join(workspace, '.aterm'),
    source,
    port,
    url: `http://127.0.0.1:${port}`,
  };
}
async function connectStdio(f: Awaited<ReturnType<typeof fixture>>, args: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [termDeclaration, '--home', f.home, 'mcp', 'run', ...args],
    cwd: f.workspace,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (data) => {
    stderr += data.toString();
  });
  const client = new Client({ name: 'stdio-integration', version: '1' });
  const errors: Error[] = [];
  client.onerror = (error) => {
    errors.push(error);
  };
  cleanups.push(() => client.close());
  await client.connect(transport);
  return { client, transport, errors, stderr: () => stderr, run: runner(client) };
}
function runner(client: Client) {
  return async (cmd: string, stdin?: string) => {
    const result = await client.callTool({
      name: 'aterm',
      arguments: { cmd, ...(stdin === undefined ? {} : { stdin }) },
    });
    return result.structuredContent as unknown as ICommandResult;
  };
}
async function httpClient(url: string) {
  const client = new Client({ name: 'http-integration', version: '1' });
  cleanups.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp')));
  return { client, run: runner(client) };
}
async function host(f: Awaited<ReturnType<typeof fixture>>) {
  const app = await AtermApplication.open({ home: f.home });
  const server = new AtermServer(app.config);
  server.useExtension(new CommandEndpoint(app.home, server));
  cleanups.push(() => server.close());
  await server.start();
  return server;
}

test('GraphQL is identical through standalone stdio, automatic server dispatch and hosted stdio', async () => {
  const input = {
    query:
      '{ terms(match: "*original*") { nodes { id termDeclarations { definition } } } strict: terms(match: "*original*", caseSensitive: true) { totalCount } }',
  };
  const f = await fixture(true);
  const stdio = await connectStdio(f);
  const local = await stdio.client.callTool({ name: 'graphql', arguments: input });
  expect(local.isError).toBe(false);
  expect(local.structuredContent).toMatchObject({
    data: { terms: { nodes: [{ id: '_sample:Original_' }] }, strict: { totalCount: 0 } },
  });
  const verifyCase = async (run: ReturnType<typeof runner>) => {
    const result = await run('term list "*original*" --output json');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).termDeclarations).toHaveLength(1);
    const strict = await run('term list "*original*" --case-sensitive --output json');
    expect(strict.exitCode).toBe(0);
    expect(JSON.parse(strict.stdout).termDeclarations).toEqual([]);
  };
  await verifyCase(stdio.run);
  const server = await host(f);
  await verifyCase(stdio.run);
  const remote = await httpClient(f.url);
  await verifyCase(remote.run);
  expect(await stdio.client.callTool({ name: 'graphql', arguments: input })).toEqual(local);
  expect((await stdio.run('corpus query', input.query)).exitCode).toBe(0);
  await stdio.client.close();
  await server.close();
  const hosted = await connectStdio(f, ['--with-server']);
  await verifyCase(hosted.run);
  expect(await hosted.client.callTool({ name: 'graphql', arguments: input })).toEqual(local);
  expect(hosted.errors).toEqual([]);
  expect(hosted.stderr()).not.toContain('Error');
});

test('standalone stdio needs no listener, preserves stdin and shares CLI guards and help', async () => {
  const f = await fixture();
  const mcp = await connectStdio(f);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(mcp.client.getServerVersion()).toEqual({ name: 'aterm', version: manifest.version });
  expect((await mcp.run('--version')).stdout).toBe(manifest.version + '\n');
  expect((await mcp.run('skill list')).stdout).toContain('_aterm_skills:Runtime_Management_Skill_');
  expect((await mcp.run('skill view _aterm_skills:Runtime_Management_Skill_')).stdout).toContain(
    '_aterm_skills:Runtime_Management_Skill_',
  );
  expect((await mcp.run('skill remind _aterm_skills:Runtime_Management_Skill_')).stdout).toContain(
    'aterm skill view',
  );
  expect((await mcp.run('term list')).stdout).toContain('_sample:Original_');
  const skills = await new SkillCatalog().read(
    (await AtermApplication.open({ home: f.home })).config,
  );
  expect((await mcp.client.listTools()).tools.map((t) => t.name).sort()).toEqual(
    ['aterm', 'graphql', ...skills.map((s) => 'skill_' + s.name)].sort(),
  );
  for (const skill of skills) {
    expect(
      (await mcp.client.callTool({ name: 'skill_' + skill.name, arguments: {} })).content,
    ).toEqual([{ type: 'text', text: skill.text }]);
  }
  const text = 'first line\n`$HOME` and $(literal)\n한글\n';
  expect((await mcp.run('file write notes.md', text)).exitCode).toBe(0);
  expect((await mcp.run('file read notes.md')).stdout).toBe(text);
  expect(
    (await mcp.run('knowledge edit sample', knowledgeSource.replace('_Original_', '_Changed_')))
      .exitCode,
  ).toBe(0);
  expect((await mcp.run('term list')).stdout).toContain('_sample:Changed_');
  expect((await mcp.run('mcp run --help')).stdout).toContain('--with-server');
  for (const cmd of [
    'mcp run',
    'mcp run --with-server',
    'server run',
    'skill install',
    '--home /tmp term list',
    '--server http://localhost/mcp term list',
    'file read ../outside',
    'term list | cat',
  ])
    expect((await mcp.run(cmd)).exitCode, cmd).toBe(1);
  expect((await mcp.run('ui session list')).exitCode).toBe(1);
  expect(mcp.stderr()).toBe('');
  expect(mcp.errors).toEqual([]);
});

test('standalone stdio discovers the same server as CLI, writes locally, and never owns the server', async () => {
  const f = await fixture(true);
  const server = await host(f);
  const mcp = await connectStdio(f);
  expect((await mcp.run('term list')).stdout).toContain('_sample:Original_');
  expect(
    (await mcp.run('file write docs/sample.trm', knowledgeSource.replace('_Original_', '_Local_')))
      .exitCode,
  ).toBe(0);
  // Sixty-second debounce makes this an observable dispatch test, not just equal content.
  expect((await mcp.run('file read docs/sample.trm')).stdout).toContain('_Local_');
  expect((await mcp.run('term list')).stdout).toContain('_sample:Original_');
  await server.refresh();
  expect((await mcp.run('term list')).stdout).toContain('_sample:Local_');
  await mcp.client.close();
  expect((await fetch(f.url + '/api/health')).ok).toBe(true);
  const next = await connectStdio(f);
  await server.close();
  expect((await next.run('term list')).stdout).toContain('_sample:Local_');
});

test('standalone stdio refuses a server belonging to another Home', async () => {
  const other = await fixture(true);
  await host(other);
  const f = await fixture(true);
  await writeFile(
    join(f.workspace, '.aterm/aterm.yaml'),
    f.source.replace(String(f.port), String(other.port)),
  );
  const mcp = await connectStdio(f);
  const result = await mcp.run('term list');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('another Home');
  expect((await mcp.run('file write notes.md', 'local despite mismatched listener')).exitCode).toBe(
    0,
  );
});

test('hosted stdio and HTTP share publication, catalog and UI Sessions', async () => {
  const f = await fixture(true);
  const stdio = await connectStdio(f, ['--with-server']);
  const http = await httpClient(f.url);
  expect((await fetch(f.url)).ok).toBe(true);
  expect((await stdio.client.listTools()).tools).toEqual((await http.client.listTools()).tools);
  expect(
    (await stdio.run('knowledge edit sample', knowledgeSource.replace('_Original_', '_Hosted_')))
      .exitCode,
  ).toBe(0);
  expect((await http.run('term list')).stdout).toContain('_sample:Hosted_');
  expect((await http.run('term rename _sample:Hosted_ _Shared_')).exitCode).toBe(0);
  expect((await stdio.run('term list')).stdout).toContain('_sample:Shared_');
  const health = await (await fetch(f.url + '/api/health')).json();
  const id = randomUUID();
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
  const socket = new WebSocket(f.url.replace('http:', 'ws:') + '/api/ui/events', { origin: f.url });
  cleanups.push(async () => {
    socket.close();
  });
  let ready = false;
  let acknowledge = true;
  const delivered: unknown[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'ready') ready = true;
    if (message.type === 'command') {
      delivered.push(message.command);
      if (acknowledge)
        socket.send(
          JSON.stringify({ type: 'ack', id: message.command.id, status: 'applied', state }),
        );
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(
    JSON.stringify({
      type: 'hello',
      id,
      credential: randomUUID(),
      instance: randomUUID(),
      state,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      protocol: serverProtocol,
      home: health.home,
    }),
  );
  await expect.poll(() => ready).toBe(true);
  expect((await stdio.run('ui session list')).stdout).toContain(id.slice(0, 6));
  expect((await http.run('ui session list')).stdout).toContain(id.slice(0, 6));
  expect((await stdio.run(`ui explore set _sample:Shared_ --session ${id}`)).exitCode).toBe(0);
  expect((await http.run(`ui note send --session ${id}`, '# Shared session')).exitCode).toBe(0);
  expect(delivered).toHaveLength(2);
  expect(stdio.stderr()).toContain('Serving');
  expect(stdio.errors).toEqual([]);
  acknowledge = false;
  const pending = http.run(`ui explore clear --session ${id} --output json`);
  await expect.poll(() => delivered.length).toBe(3);
  await stdio.client.close();
  const interrupted = await pending;
  expect(interrupted.exitCode).toBe(1);
  expect(JSON.parse(interrupted.stdout).command.status).toBe('unknown');
  await http.client.close();
  await expect(fetch(f.url + '/api/health')).rejects.toThrow();
});

test.each([false, true])(
  'stdio cold recovery and current catalog on one connection (hosted=%s)',
  async (hosted) => {
    const f = await fixture(true);
    await writeFile(join(f.workspace, '.aterm/aterm.yaml'), 'sources: [');
    const mcp = await connectStdio(f, hosted ? ['--with-server', '--port', String(f.port)] : []);
    expect((await mcp.client.listTools()).tools.map((t) => t.name)).toEqual(['aterm', 'graphql']);
    expect((await mcp.run('file write .aterm/aterm.yaml', f.source)).exitCode).toBe(0);
    const valid = (await mcp.client.listTools()).tools;
    const skill = valid.find((tool) => tool.name.startsWith('skill_'))!;
    expect(skill).toBeDefined();
    expect((await mcp.client.callTool({ name: skill.name })).isError).not.toBe(true);
    expect((await mcp.run('file write .aterm/aterm.yaml', 'sources: [')).exitCode).toBe(0);
    expect((await mcp.client.listTools()).tools.map((t) => t.name)).toEqual(['aterm', 'graphql']);
    expect((await mcp.client.callTool({ name: skill.name })).isError).toBe(true);
    expect((await mcp.run('file read .aterm/aterm.yaml')).stdout).toBe('sources: [');
    expect((await mcp.run('file write .aterm/aterm.yaml', f.source)).exitCode).toBe(0);
    expect((await mcp.run('corpus check')).exitCode).toBe(0);
  },
);

test.each(['EOF', 'SIGTERM', 'SIGINT'] as const)(
  'hosted process exits cleanly and releases its listener on %s',
  async (termination) => {
    const f = await fixture(true);
    const child = spawn(process.execPath, [
      termDeclaration,
      '--home',
      f.home,
      'mcp',
      'run',
      '--with-server',
    ]);
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    await expect.poll(() => stderr).toContain('Serving');
    if (termination === 'EOF') child.stdin.end();
    else child.kill(termination);
    expect(await closed).toEqual({ code: 0, signal: null });
    expect(stdout).toBe('');
    await expect(fetch(f.url + '/api/health')).rejects.toThrow();
    const server = await host(f); // The same address can be rebound after shutdown.
    expect((await fetch(server.url + '/api/health')).ok).toBe(true);
  },
);

test('hosted startup refuses occupied ports and standalone rejects listener-only options', async () => {
  const f = await fixture(true);
  await host(f);
  for (const args of [['--with-server'], ['--port', String(f.port)], ['--host', '127.0.0.1']]) {
    const child = spawn(process.execPath, [
      termDeclaration,
      '--home',
      f.home,
      'mcp',
      'run',
      ...args,
    ]);
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const code = await new Promise<number | null>((resolve) => child.once('close', resolve));
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain(
      args[0] === '--with-server' ? 'Cannot listen' : 'require mcp run --with-server',
    );
    expect((await fetch(f.url + '/api/health')).ok).toBe(true);
  }
  expect(await readFile(join(f.workspace, '.aterm/aterm.yaml'), 'utf8')).toBe(f.source);
});

test.each([
  [false, false],
  [true, false],
  [true, true],
])(
  'EOF finishes a submitted write before process shutdown (hosted=%s, closed output=%s)',
  async (hosted, closedOutput) => {
    const f = await fixture(true);
    const child = spawn(process.execPath, [
      termDeclaration,
      '--home',
      f.home,
      'mcp',
      'run',
      ...(hosted ? ['--with-server'] : []),
    ]);
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    const messages: { id?: number; result?: { structuredContent?: ICommandResult } }[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      messages.push(JSON.parse(line));
    });
    child.stderr.resume();
    const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal })),
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'half-close-test', version: '1' },
        },
      }) + '\n',
    );
    await expect.poll(() => messages.some((m) => m.id === 1)).toBe(true);
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    const text = 'A complete saved line.\n'.repeat(12000);
    child.stdin.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'aterm',
          arguments: { cmd: 'file write final.md --output json', stdin: text },
        },
      }) + '\n',
    );
    if (closedOutput) child.stdout.destroy();
    expect(await closed).toEqual({ code: 0, signal: null });
    expect(await readFile(join(f.workspace, 'final.md'), 'utf8')).toBe(text);
    if (!closedOutput)
      expect(messages.find((m) => m.id === 2)?.result?.structuredContent?.exitCode).toBe(0);
    if (hosted) await expect(fetch(f.url + '/api/health')).rejects.toThrow();
  },
);

test('HTTP MCP writes log correlated starts, save/publication phases and payload sizes without source text', async () => {
  const f = await fixture(true);
  const server = await host(f);
  const { run } = await httpClient(server.url);
  const secret = 'PRIVATE_BOOKING_DETAIL_12345';
  const changed = knowledgeSource.replace('One stable subject.', secret + '.');
  const result = await run('knowledge edit sample --output json', changed);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).saved).toBe(true);
  const path = join(f.home, 'usage.jsonl');
  await expect
    .poll(async () => (await readFile(path, 'utf8')).includes('"kind":"http","operation":"/mcp"'))
    .toBe(true);
  const text = await readFile(path, 'utf8');
  const rows = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const start = rows.find(
    (row) => row.kind === 'command' && row.operation === 'knowledge edit' && row.event === 'start',
  );
  expect(start).toBeDefined();
  const phases = rows
    .filter((row) => row.spanId === start.spanId && row.event === 'phase')
    .map((row) => row.phase);
  expect(phases).toEqual([
    'input',
    'input-read',
    'execute',
    'executed',
    'publish',
    'published',
    'validate',
    'render',
  ]);
  const end = rows.find((row) => row.spanId === start.spanId && row.event === 'finish');
  expect(end).toMatchObject({
    outcome: 'ok',
    exitCode: 0,
    inputBytes: Buffer.byteLength(changed),
    stdoutBytes: Buffer.byteLength(result.stdout),
  });
  const tool = rows.find((row) => row.spanId === start.parentId && row.event === 'start');
  expect(tool).toMatchObject({ kind: 'mcp', requestId: start.requestId });
  expect(rows.find((row) => row.spanId === tool.parentId && row.event === 'start')).toMatchObject({
    kind: 'http',
    requestId: start.requestId,
  });
  expect(text).not.toContain(secret);
  expect(text).not.toContain(changed);

  const failed = await run(
    'knowledge edit sample --output json',
    '@knowledge wrong\n@viewpoints specification\n',
  );
  expect(failed.exitCode).toBe(1);
  const failedRows = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(
    failedRows.some(
      (row) =>
        row.kind === 'command' &&
        row.event === 'finish' &&
        row.outcome === 'error' &&
        row.errorCode,
    ),
  ).toBe(true);
});

test('Add, Update and Delete Term patches share standalone stdio and hosted HTTP semantics', async () => {
  const f = await fixture(true);
  const standalone = await connectStdio(f);
  const add = `*** Begin Patch
*** Add Term: _sample:First_
+concept _First_ = {
+  First.
+.relations
+  uses _Second_
+}
*** Add Term: _sample:Second_
+concept _Second_ = { Second. }
*** Update Term: _sample:Original_
@@
-  One stable subject.
+  A revised stable subject.
*** End Patch`;
  const preview = await standalone.run('term edit --dry-run --output json', add);
  expect(preview.exitCode).toBe(0);
  expect(await readFile(join(f.workspace, 'docs/sample.trm'), 'utf8')).toBe(knowledgeSource);
  const added = await standalone.run('term edit --output json', add);
  expect(added.exitCode).toBe(0);
  expect(JSON.parse(added.stdout).terms).toEqual([
    '_sample:First_',
    '_sample:Second_',
    '_sample:Original_',
  ]);
  const server = await host(f);
  const remote = await httpClient(server.url);
  const blocked = await remote.run(
    'term edit --output json',
    '*** Begin Patch\n*** Delete Term: _sample:Second_\n*** End Patch',
  );
  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toContain('still references deleted Term');
  const deleted = await remote.run(
    'term edit --output json',
    '*** Begin Patch\n*** Delete Term: _sample:Second_\n*** Delete Term: _sample:First_\n*** End Patch',
  );
  expect(deleted.exitCode).toBe(0);
  const current = await remote.run('term list --output json');
  expect(JSON.parse(current.stdout).termDeclarations.map((d: { id: string }) => d.id)).toEqual([
    '_sample:Original_',
  ]);
  expect((await remote.run('corpus check --output json')).exitCode).toBe(0);
});

test('Knowledge header patches work through stdio and HTTP with immediate metadata publication', async () => {
  const f = await fixture(true);
  const stdio = await connectStdio(f);
  const addHeader = `*** Begin Patch
*** Update Knowledge: sample
@@
 @viewpoints specification
+@description {
+  Metadata only.
+}
*** End Patch`;
  const preview = await stdio.run('knowledge edit sample --dry-run --output json', addHeader);
  expect(preview.exitCode).toBe(0);
  expect(JSON.parse(preview.stdout).saved).toBe(false);
  expect(await readFile(join(f.workspace, 'docs/sample.trm'), 'utf8')).toBe(knowledgeSource);
  expect((await stdio.run('knowledge edit sample', addHeader)).exitCode).toBe(0);
  const server = await host(f);
  const http = await httpClient(server.url);
  const update = `*** Begin Patch
*** Update Knowledge: sample
@@
-  Metadata only.
+  Immediately published metadata.
*** End Patch`;
  expect((await http.run('knowledge edit sample', update)).exitCode).toBe(0);
  expect((await http.run('knowledge list')).stdout).toContain('Immediately published metadata.');
  expect((await http.run('term view _sample:Original_')).stdout).toContain('One stable subject.');
  const before = await readFile(join(f.workspace, 'docs/sample.trm'), 'utf8');
  const bad = update.replace('Metadata only.', 'One stable subject.');
  expect((await http.run('knowledge edit sample', bad)).exitCode).toBe(1);
  expect(await readFile(join(f.workspace, 'docs/sample.trm'), 'utf8')).toBe(before);
});
