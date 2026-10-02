import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AtermApplication,
  AtermHomeDiscovery,
  AtermServer,
  SkillCatalog,
  WorkspaceFiles,
} from '@aterm/core';
import { CommandEndpoint } from '../src/mcp-module/endpoint.js';
import { remoteCommand, remoteSelection } from '../src/mcp-module/client.js';
import { CommandRunner, commandArguments, type ICommandResult } from '../src/command-runner.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function port() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const value = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return value;
}
const viewpoint = `---
name: todo-spec
description: Observable Todo behavior.
termKinds:
  - name: data
    description: State identity.
    sections:
      - name: definition
        type: md
      - name: rules
        type: md
---
Keep fields inline.
`;
const knowledgeSource =
  '@knowledge todo\n@viewpoints todo-spec\ndata _Task_ = {\n  One identified task.\n.rules\n  - Title remains nonempty.\n}\n';
async function fixture(invalid = false) {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-mcp-'));
  cleanups.push(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, '.aterm'));
  await mkdir(join(workspace, 'docs'));
  const address = await port();
  const source = `useDefaultKnowledge: false\nuseViewpoints: []\nsources: [docs]\nserver:\n  host: 127.0.0.1\n  port: ${address}\n  debounceMs: 60000\n`;
  await writeFile(join(workspace, '.aterm/aterm.yaml'), invalid ? 'sources: [' : source);
  const home = await new AtermHomeDiscovery({}).discover(workspace);
  const config = invalid
    ? {
        home,
        allowDefaultWrites: false,
        useDefaultKnowledge: false,
        useViewpoints: [],
        sources: [],
        viewpoints: [],
        server: { port: address, host: '127.0.0.1', debounceMs: 200, watchExternal: false },
      }
    : (await AtermApplication.open({ home: home.home })).config;
  const server = new AtermServer(config);
  server.useExtension(new CommandEndpoint(home, server));
  await server.start();
  cleanups.push(() => server.close());
  const client = new Client({ name: 'mcp-only-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url + '/mcp')));
  cleanups.push(() => client.close());
  const run = async (cmd: string, stdin?: string) => {
    const result = await client.callTool({
      name: 'aterm',
      arguments: { cmd, ...(stdin !== undefined ? { stdin } : {}) },
    });
    return result.structuredContent as unknown as ICommandResult;
  };
  return { workspace, source, server, client, run, home };
}

test('GraphQL MCP tool, remote CLI and HTTP share the same request and result after a hosted write', async () => {
  const f = await fixture();
  await f.run('viewpoint create todo-spec', viewpoint);
  await f.run('knowledge create todo --path docs/todo.trm', knowledgeSource);
  const input = {
    query:
      'query Read($id: ID!) { term(id: $id) { id termDeclarations { termKind { qualifiedName } definition } } }',
    variables: { id: '_todo:Task_' },
    operationName: 'Read',
  };
  const tool = await f.client.callTool({ name: 'graphql', arguments: input });
  expect(tool.isError).toBe(false);
  expect(tool.structuredContent).toMatchObject({
    data: {
      term: { id: '_todo:Task_', termDeclarations: [{ definition: 'One identified task.' }] },
    },
  });
  const cli = await f.run(
    'corpus query --variables \'{"id":"_todo:Task_"}\' --operation-name Read',
    input.query,
  );
  expect(cli.exitCode).toBe(0);
  expect(JSON.parse(cli.stdout)).toEqual(tool.structuredContent);
  const http = await fetch(f.server.url + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  expect(await http.json()).toEqual(tool.structuredContent);
  const remote = await remoteCommand(f.server.url + '/mcp', [
    'corpus',
    'query',
    input.query,
    '--variables',
    JSON.stringify(input.variables),
    '--operation-name',
    'Read',
  ]);
  expect(remote).toEqual(cli);
  const selectedInput = {
    query: 'query($p:String!){terms(where:$p,orderBy:[{key:".definition"}]){nodes{id} totalCount}}',
    variables: { p: '.["@knowledge"] == "todo"' },
  };
  const selectedTool = await f.client.callTool({ name: 'graphql', arguments: selectedInput });
  expect(selectedTool.isError).toBe(false);
  expect(selectedTool.structuredContent).toMatchObject({
    data: { terms: { totalCount: 1, nodes: [{ id: '_todo:Task_' }] } },
  });
  const selectedHttp = await fetch(f.server.url + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selectedInput),
  });
  expect(await selectedHttp.json()).toEqual(selectedTool.structuredContent);
  const refused = await f.client.callTool({
    name: 'graphql',
    arguments: { query: 'mutation { __typename }' },
  });
  expect(refused.isError).toBe(true);
  expect(refused.structuredContent).toHaveProperty('errors');
  const toolInfo = (await f.client.listTools()).tools.find((tool) => tool.name === 'graphql');
  expect(toolInfo?.annotations?.readOnlyHint).toBe(true);
});

test('MCP-only authoring creates vocabulary and Knowledge, repairs invalid files and deletes them', async () => {
  const f = await fixture();
  expect((await f.run('viewpoint create todo-spec --dry-run', viewpoint)).exitCode).toBe(0);
  expect((await f.run('viewpoint list')).stdout).not.toContain('todo-spec');
  expect((await f.run('viewpoint create todo-spec', viewpoint)).exitCode).toBe(0);
  expect(
    (await f.run('knowledge create todo --path docs/todo.trm', knowledgeSource)).exitCode,
  ).toBe(0);
  // Own writes are immediately visible even with a sixty-second filesystem debounce.
  expect((await f.run('term list --knowledge todo')).stdout).toContain('_todo:Task_');
  const source = JSON.parse((await f.run('file read docs/todo.trm --output json')).stdout);
  expect(source.text).toBe(knowledgeSource);
  expect((await f.run('knowledge edit todo --if-match stale', knowledgeSource)).exitCode).toBe(1);
  expect(
    (
      await f.run(
        'knowledge edit todo',
        knowledgeSource.replace('One identified', 'A stable identified'),
      )
    ).exitCode,
  ).toBe(0);
  expect((await f.run('viewpoint delete todo-spec')).exitCode).toBe(1);
  const invalid = await f.run(
    'file write docs/todo.trm --output json',
    '@knowledge todo\n@viewpoints missing\n',
  );
  expect(JSON.parse(invalid.stdout)).toMatchObject({ saved: true });
  expect(JSON.parse(invalid.stdout).diagnostics.length).toBeGreaterThan(0);
  expect((await f.run('file read docs/todo.trm')).stdout).toContain('@viewpoints missing');
  expect((await f.run('corpus check')).exitCode).toBe(1);
  expect((await f.run('file write docs/todo.trm', knowledgeSource)).exitCode).toBe(0);
  expect((await f.run('corpus check')).exitCode).toBe(0);
  const config = (await f.run('file read .aterm/aterm.yaml')).stdout;
  expect((await f.run('file write .aterm/aterm.yaml', 'sources: [')).exitCode).toBe(0);
  expect((await f.run('knowledge list')).exitCode).toBe(1);
  expect((await f.run('--help')).stdout).toContain('file');
  expect((await f.run('file list .aterm')).stdout).toContain('aterm.yaml');
  expect((await f.run('file write .aterm/aterm.yaml', config)).exitCode).toBe(0);
  expect((await f.run('knowledge delete todo')).exitCode).toBe(0);
  expect((await f.run('viewpoint delete todo-spec')).exitCode).toBe(0);
  expect((await f.run('file read docs/todo.trm')).exitCode).toBe(1);
  expect((await f.run('corpus check')).exitCode).toBe(0);
}, 30000);

test('each Skill tool returns the canonical installed document and exact description', async () => {
  const f = await fixture();
  const tools = (await f.client.listTools()).tools;
  const skills = await new SkillCatalog().read((await f.server.application()).config);
  expect(tools.map((t) => t.name).sort()).toEqual(
    ['aterm', 'graphql', ...skills.map((s) => 'skill_' + s.name)].sort(),
  );
  for (const skill of skills) {
    expect(tools.find((t) => t.name === 'skill_' + skill.name)?.description).toBe(
      skill.description,
    );
    const output = await f.client.callTool({ name: 'skill_' + skill.name, arguments: {} });
    expect(output.content).toEqual([{ type: 'text', text: skill.text }]);
  }
  await f.run('file write .aterm/aterm.yaml', 'sources: [');
  expect((await f.client.listTools()).tools.map((t) => t.name)).toEqual(['aterm', 'graphql']);
  expect((await f.run('file write .aterm/aterm.yaml', f.source)).exitCode).toBe(0);
  expect((await f.client.listTools()).tools.length).toBe(skills.length + 2);
});

test('HTTP MCP reserves Git metadata writes and dry-runs while retaining ordinary raw repair', async () => {
  const f = await fixture();
  await mkdir(join(f.workspace, '.git'));
  await writeFile(join(f.workspace, '.git/config'), '[core]\nrepositoryformatversion = 0\n');
  for (const cmd of [
    'file write .git/config',
    'file write .git/config --dry-run',
    'file write nested/.GIT/config',
    'file write .git',
    'file delete .git/config',
    'file delete .git/config --dry-run',
  ]) {
    const result = await f.run(cmd, 'blocked');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('reserved');
  }
  expect((await f.run('file read .git/config')).stdout).toContain('repositoryformatversion');
  expect((await f.run('file write note.md', 'still writable')).exitCode).toBe(0);
});

test('HTTP MCP publishes default Knowledge configuration changes without disabling guidance', async () => {
  const f = await fixture();
  const enabled = f.source.replace('useDefaultKnowledge: false', 'useDefaultKnowledge: true');
  expect((await f.run('file write .aterm/aterm.yaml', enabled)).exitCode).toBe(0);
  const knowledges = JSON.parse((await f.run('knowledge list --output json')).stdout);
  expect(knowledges.knowledges.map((k: { id: string }) => k.id)).toEqual([
    'aterm',
    'aterm_skills',
    'vending_machine',
  ]);
  expect((await f.run('term view _aterm:Term_')).exitCode).toBe(0);
  const refused = await f.run('knowledge delete aterm --dry-run');
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('read-only');
  expect((await f.run('file write .aterm/aterm.yaml', f.source)).exitCode).toBe(0);
  expect(JSON.parse((await f.run('term list --output json')).stdout).termDeclarations).toEqual([]);
  expect((await f.run('skill remind _aterm_skills:Runtime_Management_Skill_')).stdout).toContain(
    'Runtime_Management_Skill',
  );
  expect((await f.run('skill view _aterm_skills:Aterm_Basics_Skill_')).stdout).toContain(
    '_aterm_skills:Aterm_Basics_Skill_',
  );
});

test('recovery endpoint starts with invalid config and supports remote CLI without a local Home', async () => {
  const f = await fixture(true);
  expect((await f.run('file read .aterm/aterm.yaml')).stdout).toBe('sources: [');
  expect((await f.run('file write .aterm/aterm.yaml', f.source)).exitCode).toBe(0);
  const remote = await remoteCommand(f.server.url + '/mcp', ['knowledge', 'list']);
  const local = await new CommandRunner(f.home).run(['knowledge', 'list']);
  expect(remote).toEqual(local);
  expect((await f.run('ui session list')).exitCode).toBe(0);
});

test('remote execution is isolated and refuses local-only commands and path escapes', async () => {
  const f = await fixture();
  for (const cmd of [
    'init',
    'server run',
    'skill install',
    'skill update',
    'skill uninstall',
    '--home /tmp knowledge list',
    'file read ../outside',
    'file write /tmp/outside',
    'file delete docs',
    'knowledge list; echo bad',
  ])
    expect((await f.run(cmd, 'text')).exitCode, cmd).toBe(1);
  await symlink(tmpdir(), join(f.workspace, 'escape'));
  expect((await f.run('file write escape/aterm-mcp-escape', 'bad')).exitCode).toBe(1);
  await writeFile(join(f.workspace, 'binary'), Buffer.from([0, 255, 20]));
  expect((await f.run('file read binary')).exitCode).toBe(1);
  const before = process.exitCode;
  const [help, error, good] = await Promise.all([
    f.run('--help'),
    f.run('nonsense'),
    f.run('knowledge list'),
  ]);
  expect(help.stdout).toContain('Usage:');
  expect(error.exitCode).toBe(1);
  expect(good.exitCode).toBe(0);
  expect(process.exitCode).toBe(before);
  expect(commandArguments('term list "*Task*"')).toEqual(['term', 'list', '*Task*']);
  expect(() => commandArguments('term list | cat')).toThrow();
});

test('raw files preserve version preconditions and refuse binary replacement', async () => {
  const f = await fixture();
  const raw = new WorkspaceFiles(f.home);
  const created = await raw.execute({ operation: 'file-write', path: 'note.md', text: 'first' });
  await raw.execute({
    operation: 'file-write',
    path: 'note.md',
    text: 'second',
    ifMatch: created.version,
  });
  await expect(
    raw.execute({ operation: 'file-delete', path: 'note.md', ifMatch: created.version }),
  ).rejects.toThrow('version');
  expect(await readFile(join(f.workspace, 'note.md'), 'utf8')).toBe('second');
});

test('MCP semantic edits preserve references across rename and move, and refuse breaking schema changes', async () => {
  const f = await fixture();
  await f.run('viewpoint create todo-spec', viewpoint);
  await f.run('knowledge create todo --path docs/todo.trm', knowledgeSource);
  expect(
    (
      await f.run(
        'viewpoint edit todo-spec',
        viewpoint.replace('Keep fields inline.', 'Keep identity explicit.'),
      )
    ).exitCode,
  ).toBe(0);
  expect(
    (await f.run('viewpoint edit todo-spec', viewpoint.replace('name: rules', 'name: policy')))
      .exitCode,
  ).toBe(1);
  expect((await f.run('viewpoint view todo-spec')).stdout).toContain('name: rules');
  const patch =
    '*** Begin Patch\n*** Update Term: _todo:Task_\n@@\n-  One identified task.\n+  A task with stable identity.\n*** End Patch\n';
  expect((await f.run('term edit', patch)).exitCode).toBe(0);
  expect((await f.run('term show _todo:Task_')).stdout).toContain('stable identity');
  const other =
    '@knowledge other\n@viewpoints todo-spec\ndata _List_ = {\n  A collection of _todo:Task_.\n.relations\n  contains _todo:Task_\n}\n';
  expect((await f.run('knowledge create other --path docs/other.trm', other)).exitCode).toBe(0);
  expect((await f.run('corpus check --root _todo:Task_')).exitCode).toBe(1);
  expect((await f.run('corpus check --root _other:List_')).exitCode).toBe(0);
  expect((await f.run('corpus check --root _Missing_')).exitCode).toBe(1);
  expect((await f.run('knowledge delete todo')).exitCode).toBe(1);
  expect((await f.run('term rename _todo:Task_ _Item_')).exitCode).toBe(0);
  expect((await f.run('term move _todo:Item_ --to other')).exitCode).toBe(0);
  expect((await f.run('term show _other:List_')).stdout).toContain('_other:Item_');
  expect((await f.run('knowledge delete todo --dry-run')).exitCode).toBe(0);
  expect((await f.run('file read docs/todo.trm')).exitCode).toBe(0);
  expect((await f.run('knowledge delete todo')).exitCode).toBe(0);
  expect((await f.run('corpus check')).exitCode).toBe(0);
});

test('remote CLI entrypoint works from a directory without Home and forwards stdin exactly', async () => {
  const f = await fixture();
  const cwd = await mkdtemp(join(tmpdir(), 'aterm-remote-client-'));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const { spawn } = await import('node:child_process');
  const termDeclaration = new URL('../dist/entry.js', import.meta.url).pathname;
  const env = { ...process.env };
  delete env.ATERM_HOME;
  async function cli(args: string[], stdin = '') {
    const child = spawn(
      process.execPath,
      [termDeclaration, '--server', f.server.url + '/mcp', ...args],
      {
        cwd,
        env,
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.stdin.end(stdin);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    return { exitCode, stdout, stderr };
  }
  expect((await cli(['file', 'write', 'note.md'], 'Exact $literal `text`\n\n')).exitCode).toBe(0);
  expect((await cli(['file', 'read', 'note.md'])).stdout).toBe('Exact $literal `text`\n\n');
  expect((await cli(['knowledge', 'list'])).stdout).toBe((await f.run('knowledge list')).stdout);
  expect((await cli(['init'])).exitCode).toBe(1);
}, 30000);

test('cold recovery starts through server run with invalid config and validates override settings', async () => {
  const f = await fixture(true);
  // Exercise the actual server command; the fixture endpoint is independent.
  const { spawn } = await import('node:child_process');
  const termDeclaration = new URL('../dist/entry.js', import.meta.url).pathname;
  const address = await port();
  const child = spawn(process.execPath, [
    termDeclaration,
    'server',
    'run',
    '--home',
    f.home.home,
    '--port',
    String(address),
    '--output',
    'json',
  ]);
  let output = '',
    errors = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  cleanups.push(async () => {
    child.kill('SIGTERM');
    await closed;
  });
  await expect.poll(() => output || errors, { timeout: 10000 }).not.toBe('');
  expect(errors).toBe('');
  const endpoint = JSON.parse(output).mcp;
  expect((await remoteCommand(endpoint, ['file', 'read', '.aterm/aterm.yaml'])).stdout).toBe(
    'sources: [',
  );
  expect(
    (await remoteCommand(endpoint, ['file', 'write', '.aterm/aterm.yaml'], f.source)).exitCode,
  ).toBe(0);
  expect((await remoteCommand(endpoint, ['corpus', 'check'])).exitCode).toBe(0);
  const invalid = await new CommandRunner(f.home).run([
    'server',
    'run',
    '--port',
    '1234',
    '--host',
    'arbitrary.example',
  ]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain('host');
}, 30000);

test('an explicitly configured proxy origin is accepted without trusting forwarded headers', async () => {
  const { acceptsServerOrigin } = await import('../../core/src/server-module/address.js');
  const address = { host: '127.0.0.1', port: 43127, publicOrigin: 'https://aterm.example' };
  expect(
    acceptsServerOrigin({ host: 'aterm.example', origin: 'https://aterm.example' }, address),
  ).toBe(true);
  expect(
    acceptsServerOrigin({ host: '127.0.0.1:43127', origin: 'https://aterm.example' }, address),
  ).toBe(true);
  expect(
    acceptsServerOrigin({ host: 'aterm.example', origin: 'https://evil.example' }, address),
  ).toBe(false);
  expect(
    acceptsServerOrigin(
      { host: 'evil.example', 'x-forwarded-host': 'aterm.example', 'x-forwarded-proto': 'https' },
      address,
    ),
  ).toBe(false);
});

test('MCP UI commands wait for the selected browser acknowledgement and forward Markdown notes', async () => {
  const f = await fixture();
  await f.run('viewpoint create todo-spec', viewpoint);
  await f.run('knowledge create todo --path docs/todo.trm', knowledgeSource);
  const { WebSocket } = await import('ws');
  const { randomUUID } = await import('node:crypto');
  const { serverProtocol } = await import('@aterm/core');
  const health = await (await fetch(f.server.url + '/api/health')).json();
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
  const socket = new WebSocket(f.server.url.replace('http:', 'ws:') + '/api/ui/events', {
    origin: f.server.url,
  });
  cleanups.push(async () => {
    socket.close();
  });
  const commands: any[] = [];
  let ready = false;
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'ready') ready = true;
    if (message.type === 'command') {
      commands.push(message.command);
      socket.send(
        JSON.stringify({
          type: 'ack',
          id: message.command.id,
          status: 'applied',
          state: { ...state, revision: commands.length + 1 },
        }),
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
  expect((await f.run('ui session list')).stdout).toContain(id.slice(0, 6));
  expect((await f.run(`ui explore set _todo:Task_ --session ${id} --output json`)).exitCode).toBe(
    0,
  );
  expect(commands[0].terms).toEqual(['_todo:Task_']);
  expect(
    (await f.run(`ui note send --session ${id} --title Review`, '# Task\n\nSee _todo:Task_.'))
      .exitCode,
  ).toBe(0);
  expect(JSON.stringify(commands[1])).toContain('# Task');
  expect((await f.run(`ui explore clear --session ${id}`)).exitCode).toBe(0);
});

test('remote endpoint selection preserves literal arguments after the option terminator', () => {
  expect(remoteSelection(['corpus', 'search', '--', '--server'])).toBeUndefined();
  expect(
    remoteSelection(['--server', 'http://host/mcp', 'corpus', 'search', '--', '--server']),
  ).toEqual({ url: 'http://host/mcp', argv: ['corpus', 'search', '--', '--server'] });
});

test('skill CLI, HTTP queries and MCP share readings without installing experimental Skills', async () => {
  const f = await fixture();
  const vocabulary = await readFile(
    new URL('../../core/viewpoints/skill.md', import.meta.url),
    'utf8',
  );
  expect((await f.run('viewpoint create skill', vocabulary)).exitCode).toBe(0);
  const inventory = await f.run('skill list --output json');
  const source = `@knowledge experiment
@viewpoints skill
skill _Basics_Skill_ = {
  Shared task knowledge.
.description
  Read before the experiment.
.body
  Shared instructions appear only when explicitly requested.
}
skill _Task_Skill_ = {
  A Skill for the experimental task.
.relations
  requires _Basics_Skill_
.description
  Use for the experimental task.
.body
  Perform the task and report its evidence.
.reminder
  - Use current inputs and return observed evidence.
}
`;
  expect(
    (await f.run('knowledge create experiment --path docs/experiment.trm', source)).exitCode,
  ).toBe(0);
  const app = await AtermApplication.open({ home: f.home.home });
  const local = new CommandRunner(f.home, { query: (q) => app.query(q) });
  for (const args of [
    ['skill', 'list'],
    ['skill', 'list', '--output', 'markdown'],
    ['skill', 'toc', '_Task_Skill_', '_Basics_Skill_', '_experiment:Task_Skill_'],
    ['skill', 'toc', '_Task_Skill_', '--output', 'markdown'],
    ['skill', 'toc', '_Task_Skill_', '--output', 'json'],
    ['skill', 'toc', '_Task_Skill_', '--output', 'yaml'],
    ['skill', 'view', '_experiment:Task_Skill_', '_experiment:Basics_Skill_'],
    ['skill', 'view', '_Task_Skill_', '--output', 'json'],
    ['skill', 'remind', '_Task_Skill_', '_Basics_Skill_', '_experiment:Task_Skill_'],
    ['skill', 'remind', '_Task_Skill_', '--output', 'markdown'],
    ['skill', 'remind', '_Task_Skill_', '--output', 'json'],
    ['skill', 'remind', '_Task_Skill_', '--output', 'yaml'],
  ]) {
    const expected = await local.run(args);
    expect(expected.exitCode).toBe(0);
    expect(await f.run(args.join(' '))).toEqual(expected);
    expect(await remoteCommand(f.server.url + '/mcp', args)).toEqual(expected);
  }
  const view = await f.run('skill view _Task_Skill_');
  expect(view.stdout).not.toContain('aterm skill view');
  expect(view.stdout).not.toContain('Prerequisite reading');
  expect(view.stdout).not.toContain('Shared instructions appear only');
  expect(view.stdout).toContain('## Reminder');
  const toc = await f.run('skill toc _Task_Skill_');
  expect(toc.stdout).toContain('## Skill reading\n\n_experiment:Task_Skill_');
  expect(toc.stdout).not.toContain('Perform the task and report its evidence.');
  expect(toc.stdout).not.toContain('Use current inputs and return observed evidence.');
  const command = toc.stdout.match(/```sh\n([\s\S]*?)\n```/)![1]!;
  const batch = await f.run(command.slice('aterm '.length));
  expect(batch.exitCode).toBe(0);
  expect(batch.stdout.indexOf('Shared instructions appear only')).toBeLessThan(
    batch.stdout.indexOf('Perform the task'),
  );
  expect(batch.stdout).not.toContain('Prerequisite reading');
  const reminder = await f.run('skill remind _Task_Skill_');
  expect(reminder.stdout).toContain('Use current inputs and return observed evidence.');
  expect(reminder.stdout).not.toContain('Perform the task and report its evidence.');
  expect(reminder.stdout).not.toContain('Prerequisite reading');
  expect((await f.run('skill remind _Basics_Skill_')).stdout).toContain('No Reminder is authored');
  expect(JSON.parse((await f.run('skill list --output json')).stdout).skills).toHaveLength(
    JSON.parse(inventory.stdout).skills.length + 2,
  );
  const failed = await f.run('skill view _Missing_');
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toContain('unknown');
  // Whole-source authoring rejects a newly introduced prerequisite cycle before saving.
  const cyclic = source.replace(
    '  Shared task knowledge.\n',
    '  Shared task knowledge.\n.relations\n  requires _Task_Skill_\n',
  );
  const refused = await f.run('knowledge edit experiment', cyclic);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('Prerequisite cycle');
  expect((await f.run('skill view _Task_Skill_')).stdout).toBe(view.stdout);
  const emptyReminder = source.replace(
    '  - Use current inputs and return observed evidence.\n',
    '',
  );
  const emptyRefusal = await f.run('knowledge edit experiment', emptyReminder);
  expect(emptyRefusal.exitCode).toBe(1);
  expect(emptyRefusal.stderr).toContain('authored .reminder section must be nonempty');
  expect((await f.run('skill remind _Task_Skill_')).stdout).toBe(reminder.stdout);
  const selected = await AtermApplication.open({ home: f.home.home });
  const documents = await new SkillCatalog().read(selected.config);
  const tools = await f.client.listTools();
  expect(tools.tools.map((t) => t.name).sort()).toEqual(
    ['aterm', 'graphql', ...documents.map((d) => 'skill_' + d.name)].sort(),
  );
  for (const document of documents) {
    const result = await f.client.callTool({ name: 'skill_' + document.name, arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: document.text }]);
    const read = await f.run('skill toc ' + document.term);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain('## Skill reading');
  }
  expect(
    JSON.parse((await f.run('skill list --output json')).stdout)
      .skills.map((s: { term: string }) => s.term)
      .sort(),
  ).toEqual(documents.map((d) => d.term).sort());
}, 120000);

test('jq shares snapshot data across GraphQL HTTP, MCP and remote commands', async () => {
  const f = await fixture();
  await f.run('viewpoint create todo-spec', viewpoint);
  await f.run('knowledge create todo --path docs/todo.trm', knowledgeSource);
  const input = {
    query: 'query($program:String!) { jq(program:$program, knowledge:["todo"]) }',
    variables: { program: '.[] | {term: .["@term"], definition}' },
  };
  const tool = await f.client.callTool({ name: 'graphql', arguments: input });
  expect(tool.isError).toBe(false);
  expect(tool.structuredContent).toEqual({
    data: { jq: [{ term: '_todo:Task_', definition: 'One identified task.' }] },
  });
  const http = await fetch(f.server.url + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  expect(await http.json()).toEqual(tool.structuredContent);
  const cli = await f.run('corpus jq --knowledges todo', input.variables.program);
  expect(cli.exitCode).toBe(0);
  expect(JSON.parse(cli.stdout)).toEqual(
    (tool.structuredContent as { data: { jq: unknown } }).data.jq,
  );
  expect(
    await remoteCommand(f.server.url + '/mcp', [
      'corpus',
      'jq',
      input.variables.program,
      '--knowledges',
      'todo',
    ]),
  ).toEqual(cli);
});
