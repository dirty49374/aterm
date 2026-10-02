import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { commands } from '../src/command-module/index.js';
import { CommandInvocation } from '../src/invocation.js';
import { AtermProgram } from '../src/program.js';
import type { ICommandInputContext } from '../src/contracts.js';
import { installedPaths, packagedSkillNames } from '../../core/test/skill-fixture.js';
import { viewpointSource } from '@aterm/core';

const sample =
  'concept _Slot_ = {\n  A position that holds a stock of one _Product_ at one price.\n.relations\n  contains _Product_\n.contract\n  - A _Slot_ must contain at most one _Product_ kind.\n}\n\nconcept _Product_ = {\n  A kind of item the machine can dispense, identified by name.\n}\n';

async function cli() {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-cli-'));
  await mkdir(join(workspace, '.aterm'));
  await mkdir(join(workspace, 'docs'));
  await writeFile(
    join(workspace, '.aterm', 'aterm.yaml'),
    'useDefaultKnowledge: false\nuseViewpoints: []\nsources: [docs]\nviewpoints:\n  specification: ' +
      join(viewpointSource, 'specification.md') +
      '\n',
  );
  await writeFile(
    join(workspace, 'docs', 'SPEC-sample.trm'),
    '@knowledge sample\n@viewpoints specification\n' + sample,
  );
  const out: string[] = [];
  const err: string[] = [];
  const input: ICommandInputContext = {
    text: async (path) => readFile(String(path), 'utf8'),
    cwd: () => workspace,
  };
  const program = new AtermProgram(
    new CommandInvocation(input, {}, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }),
  ).create();
  const configure = (command: typeof program) => {
    command
      .exitOverride()
      .configureOutput({ writeOut: (text) => out.push(text), writeErr: (text) => err.push(text) });
    command.commands.forEach(configure);
  };
  configure(program);
  return {
    workspace,
    out,
    err,
    async run(...argv: string[]) {
      out.length = 0;
      process.exitCode = 0;
      await program.parseAsync(['node', 'aterm', ...argv]);
      return { text: out.join(''), code: process.exitCode ?? 0 };
    },
  };
}

test('read commands default to insensitive matching and honor the global case-sensitive option', async () => {
  const c = await cli();
  const listed = JSON.parse(
    (await c.run('term', 'list', '*product*', '--knowledge', 'SAMPLE', '--output', 'json')).text,
  );
  expect(listed.termDeclarations.map((term: { id: string }) => term.id)).toEqual([
    '_sample:Product_',
  ]);
  expect((await (await cli()).run('term', 'view', '_slot_', '--section', 'DEFINITION')).text).toBe(
    'A position that holds a stock of one _Product_ at one price.\n',
  );
  expect(
    (
      await (
        await cli()
      ).run('term', 'view', '_slot_', '--section', 'DEFINITION', '--output', 'markdown')
    ).text,
  ).toBe('A position that holds a stock of one _Product_ at one price.\n\n\n');
  expect(
    JSON.parse((await c.run('corpus', 'search', 'POSITION', '--output', 'json')).text).matches,
  ).toHaveLength(1);
  const sensitive = await cli();
  expect(
    JSON.parse(
      (await sensitive.run('term', 'list', '*product*', '--case-sensitive', '--output', 'json'))
        .text,
    ).termDeclarations,
  ).toEqual([]);
  expect(
    JSON.parse(
      (await sensitive.run('corpus', 'search', 'POSITION', '--case-sensitive', '--output', 'json'))
        .text,
    ).matches,
  ).toEqual([]);
  await expect(
    (await cli()).run('term', 'view', '_Slot_', '--section', 'DEFINITION', '--case-sensitive'),
  ).rejects.toThrow('No selected Term');
  const query = '{ terms(match: "*product*") { nodes { id } } }';
  expect(JSON.parse((await c.run('corpus', 'query', query)).text).data.terms.nodes).toEqual([
    { id: '_sample:Product_' },
  ]);
  expect(
    JSON.parse((await sensitive.run('corpus', 'query', query, '--case-sensitive')).text).data.terms
      .nodes,
  ).toEqual([]);
  const source = await readFile(join(c.workspace, 'docs/SPEC-sample.trm'), 'utf8');
  await expect(c.run('term', 'rename', '_Product_', '_Item_', '--case-sensitive')).rejects.toThrow(
    'does not accept caseSensitive',
  );
  expect(await readFile(join(c.workspace, 'docs/SPEC-sample.trm'), 'utf8')).toBe(source);
});

test('corpus query supports inline and file documents, variables and standard GraphQL output', async () => {
  const c = await cli();
  const query = 'query Read($id: ID!) { term(id: $id) { id termDeclarations { definition } } }';
  const args = ['--variables', '{"id":"_sample:Product_"}', '--operation-name', 'Read'];
  const inline = await c.run('corpus', 'query', query, ...args);
  expect(inline.code).toBe(0);
  expect(JSON.parse(inline.text)).toEqual({
    data: {
      term: {
        id: '_sample:Product_',
        termDeclarations: [
          { definition: 'A kind of item the machine can dispense, identified by name.' },
        ],
      },
    },
  });
  const path = join(c.workspace, 'read.graphql');
  await writeFile(path, query);
  expect(await c.run('corpus', 'query', '--file', path, ...args, '--output', 'json')).toEqual(
    inline,
  );
  expect(parse((await c.run('corpus', 'query', query, ...args, '--output', 'yaml')).text)).toEqual(
    JSON.parse(inline.text),
  );
  expect((await c.run('corpus', 'query', query, ...args, '--output', 'markdown')).text).toMatch(
    /^```json[\s\S]*```\n\n\n$/,
  );
  const collection = await c.run(
    'corpus',
    'query',
    'query($p:String!){terms(where:$p,orderBy:[{key:".definition",direction:DESC}]){nodes{id} totalCount}}',
    '--variables',
    JSON.stringify({ p: '.["@term"] == "_sample:Product_"' }),
  );
  expect(collection.code).toBe(0);
  expect(JSON.parse(collection.text).data.terms).toEqual({
    nodes: [{ id: '_sample:Product_' }],
    totalCount: 1,
  });
  const failure = await c.run('corpus', 'query', '{ missing }');
  expect(failure.code).toBe(1);
  expect(JSON.parse(failure.text).errors[0].message).toContain('Cannot query field');
  await expect(c.run('corpus', 'query', query, '--file', path)).rejects.toThrow('either an inline');
  process.exitCode = 0;
});

test('retired command families and legacy Skill selectors are refused', async () => {
  const c = await cli();
  for (const command of ['workflow', 'newskill'])
    await expect(c.run(command, 'list')).rejects.toThrow();
  await expect(c.run('skill', 'view', 'aterm')).rejects.toThrow('unknown');
});

test('every command registers with its own help, and the workspace help lists the home rule', async () => {
  const program = new AtermProgram().create();
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(program.version()).toBe(manifest.version);
  const paths = (command: typeof program, prefix = ''): string[] =>
    command.commands.flatMap((child) => {
      const path = [prefix, child.name()].filter(Boolean).join(' ');
      return child.commands.length ? paths(child, path) : [path];
    });
  const leaves = paths(program);
  const checkGroups = (command: typeof program): void => {
    if (command.commands.length) expect(command.description().trim()).not.toBe('');
    command.commands.forEach(checkGroups);
  };
  checkGroups(program);
  expect(leaves.sort()).toEqual(commands.map((c) => new c().name).sort());
  expect(program.helpInformation()).toContain('--home <path>');
  expect(program.helpInformation()).toContain('--output <format>');
  const list = program.commands
    .find((c) => c.name() === 'term')!
    .commands.find((c) => c.name() === 'list')!;
  let help = '';
  list.configureOutput({ writeOut: (text) => (help += text) });
  list.outputHelp();
  expect(help).toContain('--unreferenced');
  expect(help).toContain('--tree');
  expect(help).toContain("aterm term list '*Project*'");
  expect(help).toContain('Behavior and recovery:');
});

test('discovery CLI shares validation and renders bounded evidence in every output format', async () => {
  const c = await cli();
  const result = JSON.parse(
    (
      await c.run(
        'corpus',
        'discover',
        'product stock',
        '--mode',
        'lexical',
        '--limit',
        '1',
        '--output',
        'json',
      )
    ).text,
  );
  expect(result).toMatchObject({ operation: 'discover', mode: 'lexical', limit: 1 });
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].evidence[0]).toMatchObject({
    file: expect.any(String),
    line: expect.any(Number),
    section: expect.any(String),
    excerpt: expect.any(String),
  });
  const text = (await c.run('corpus', 'discover', '_Slot_', '--mode', 'lexical')).text;
  expect(text).toMatch(/^TERM\s+SCORE\n_sample:Slot_\s+\d+\.\d{4}(?:\n|$)/);
  expect(text).not.toContain('A position that holds a stock');
  expect(text).not.toContain('SPEC-sample.trm:');
  const detail = (await c.run('corpus', 'discover', '_Slot_', '--mode', 'lexical', '--detail'))
    .text;
  expect(detail).toMatch(
    /^## _sample:Slot_ score=\d+\.\d{4}\nA position that holds a stock of one _Product_ at one price\./,
  );
  expect(detail).toContain('SPEC-sample.trm:');
  const markdown = (
    await c.run('corpus', 'discover', '_Slot_', '--mode', 'lexical', '--output', 'markdown')
  ).text;
  expect(markdown).toMatch(/^\| Term\s+\| Score\s+\|/);
  expect(markdown).toMatch(/\| _sample:Slot_\s+\| \d+\.\d{4}\s+\|/);
  expect(markdown).not.toContain('A position that holds a stock');
  expect(markdown.endsWith('\n\n\n')).toBe(true);
  const definitionOnly = JSON.parse(
    (
      await c.run(
        'corpus',
        'discover',
        'most',
        '--mode',
        'lexical',
        '--search-in',
        'definition',
        '--output',
        'json',
      )
    ).text,
  );
  expect(definitionOnly).toMatchObject({ searchSections: ['definition'], candidates: [] });
  expect(
    JSON.parse((await c.run('corpus', 'index', 'status', '--output', 'json')).text),
  ).toMatchObject({ operation: 'index-status', modelReady: false, ready: false });
  for (const options of [
    ['--limit', '0'],
    ['--limit', '101'],
    ['--mode', 'bad'],
  ])
    await expect(c.run('corpus', 'discover', 'question', ...options)).rejects.toThrow();
});

test('Skill readings default to shared Markdown while structured output retains composition', async () => {
  const c = await cli();
  for (const name of ['_aterm_skills:Aterm_Basics_Skill_', '_aterm_skills:Modeling_Skill_']) {
    const args: string[] = [];
    const plain = await c.run('skill', 'view', name, ...args);
    const markdown = await c.run('skill', 'view', name, ...args, '--output', 'markdown');
    expect(plain).toEqual(markdown);
    expect(plain.code).toBe(0);
    expect(plain.text.match(/\n+$/)?.[0]).toBe('\n\n\n');
    const result = JSON.parse(
      (await c.run('skill', 'view', name, ...args, '--output', 'json')).text,
    );
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].term).toBe(name);
    expect(plain.text).toContain(result.skills[0].markdown.trimEnd());
    expect(plain.text).toContain('## Reminder');
    expect(plain.text).not.toContain('## specification');
  }
});

test('read commands render text and structured output for the same query', async () => {
  const c = await cli();
  expect((await c.run('term', 'list')).text).toMatch(/_sample:Product_ +concept +specification/);
  expect((await c.run('term', 'list', '_Slot_', '--with-fileline')).text).toContain(
    'docs/SPEC-sample.trm:3',
  );
  expect((await c.run('term', 'show', '_Product_')).text).toBe(
    '// Knowledge: sample\n// Viewpoint: specification\n\nconcept _Product_ = { A kind of item the machine can dispense, identified by name. }\n',
  );
  expect((await c.run('term', 'show', '_Product_', '--section', 'definition')).text).toBe(
    'A kind of item the machine can dispense, identified by name.\n',
  );
  expect((await c.run('corpus', 'search', 'dispense')).text).toContain(
    'definition: A kind of item',
  );
  expect((await c.run('graph', 'overview', '_Slot_')).text).toContain(
    '_sample:Slot_ contains _sample:Product_',
  );
  expect((await c.run('graph', 'relations', '--edges', 'relation')).text).toBe(
    '_sample:Slot_ contains _sample:Product_\n',
  );
  expect((await c.run('graph', 'path', '_Slot_', '_Product_')).text).toBe(
    '_sample:Slot_ > _sample:Product_\n',
  );
  const grep = (await c.run('term', 'occurrences', '_Product_', '--match', '_Slot_')).text;
  expect(grep).toContain('_sample:Slot_:1-3');
  expect(grep).toContain('2 |   A position that holds a stock of one _Product_ at one price.');
  expect((await c.run('graph', 'connect', '_Slot_', '_Product_', '--limit', '1')).text).toContain(
    '## Path #1',
  );
  const json = await c.run('--output', 'json', 'term', 'list', '_Slot_');
  expect(JSON.parse(json.text).termDeclarations[0].name).toBe('_Slot_');
  const yaml = await c.run('term', 'list', '_Slot_', '--output', 'yaml');
  expect(yaml.text).toContain('name: _Slot_');
});

test('Markdown CLI emits Term Declaration headings and two final empty lines without context annotations', async () => {
  const c = await cli();
  const result = await c.run('term', 'show', '_Slot_', '--output', 'markdown');
  expect(result.code).toBe(0);
  expect(result.text).toMatch(/^## concept _Slot_\n\n/);
  expect(result.text).toContain('### relations\n\n- contains _Product_');
  expect(result.text).not.toContain('Viewpoint:');
  expect(result.text).not.toContain('](#');
  expect(result.text.match(/\n+$/)?.[0]).toBe('\n\n\n');
  expect(
    (await c.run('term', 'view', '_Slot_', '--output', 'markdown', '--section', 'contract')).text,
  ).toBe('- A _Slot_ must contain at most one _Product_ kind.\n\n\n');
});

test('check reports diagnostics with exit 1 and a clean corpus with exit 0', async () => {
  const c = await cli();
  expect(await c.run('corpus', 'check')).toEqual({
    text: 'Checked 1 Aterm files, 2 Term Declarations. No diagnostics.\n',
    code: 0,
  });
  await writeFile(
    join(c.workspace, 'docs', 'SPEC-broken.trm'),
    '@knowledge broken\n@viewpoints specification\nconcept _Broken_ = {\n  Uses _Missing_.\n.relations\n  references _Missing_\n}\n',
  );
  const broken = await c.run('corpus', 'check');
  expect(broken.code).toBe(1);
  expect(broken.text).toContain('Unresolved reference _broken:Missing_');
  expect(broken.text).not.toContain(c.workspace);
  expect((await c.run('corpus', 'check', '--with-fileline')).text).toContain(
    join(c.workspace, 'docs', 'SPEC-broken.trm') + ':4',
  );
  await expect(c.run('term', 'list')).rejects.toThrow('Unresolved reference _broken:Missing_');
});

test('authoring commands preview with --dry-run and save without it', async () => {
  const c = await cli();
  const file = join(c.workspace, 'docs', 'SPEC-sample.trm');
  const patch = join(c.workspace, 'change.patch');
  await writeFile(
    patch,
    '*** Begin Patch\n*** Update Term: _Product_.definition\n@@\n-  A kind of item the machine can dispense, identified by name.\n+  A kind of item the machine dispenses, identified by name.\n*** End Patch\n',
  );
  const preview = await c.run('term', 'edit', '--file', patch, '--dry-run');
  expect(preview.text).toContain('Preview: _sample:Product_');
  expect(await readFile(file, 'utf8')).toBe(
    '@knowledge sample\n@viewpoints specification\n' + sample,
  );
  await c.run('term', 'edit', '--file', patch);
  expect(await readFile(file, 'utf8')).toContain('the machine dispenses');
  await c.run('term', 'rename', '_Product_', '_Item_');
  expect(await readFile(file, 'utf8')).toContain('contains _Item_');
  expect((await c.run('term', 'format', '--dry-run')).text).toContain('No changes.');
});

test('an uninitialized directory explains itself, and init makes it usable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-init-cli-'));
  const out: string[] = [];
  const invocation = new CommandInvocation(
    { text: async () => '', cwd: () => workspace },
    {},
    { stdout: (t) => out.push(t), stderr: () => {} },
  );
  const program = new AtermProgram(invocation).create();
  await expect(program.parseAsync(['node', 'aterm', 'term', 'list'])).rejects.toThrow(
    'run aterm init',
  );
  await program.parseAsync(['node', 'aterm', 'init']);
  expect(out.join('')).toContain('Initialized ' + join(workspace, '.aterm', 'aterm.yaml'));
  // This initialization test exercises local reads, independent of a live default-port server.
  const configPath = join(workspace, '.aterm', 'aterm.yaml');
  const config = parse(await readFile(configPath, 'utf8'));
  expect(config.server.port).toBe(43127);
  expect(config.server.host).toBe('127.0.0.1');
  delete config.server;
  await writeFile(configPath, stringify(config));
  out.length = 0;
  await program.parseAsync(['node', 'aterm', 'corpus', 'check']);
  expect(out.join('')).toContain('Checked 3 Aterm files');
});

test('default reads omit scope; explicit detail and structured output retain it', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, 'docs', 'SPEC-sample.trm'),
    '@knowledge sample\n@viewpoints specification\n@scope {\n  Specify behavior and result content.\n}\n' +
      sample,
  );
  for (const command of ['show', 'view']) {
    const plain = (await c.run('term', command, '_Slot_')).text;
    expect(plain).not.toContain('// Scope:');
    expect(plain).not.toContain('Specify behavior and result content.');
    expect(plain).toContain('// Knowledge: sample\n// Viewpoint: specification');
    const result = JSON.parse((await c.run('term', command, '_Slot_', '--output', 'json')).text);
    expect(result.termDeclarations[0].scope).toEqual({
      content: 'Specify behavior and result content.',
      line: 3,
      endLine: 5,
    });
    expect((await c.run('term', command, '_Slot_', '--section', 'definition')).text).not.toContain(
      'Scope:',
    );
  }
  const detail = (await c.run('term', 'view', '_Slot_', '--detail')).text;
  expect(detail).toContain(
    '// Scope:\n// Specify behavior and result content.\n\n// Declaration:\n',
  );
  expect(detail).toContain('\n\n// References:\n');
  expect(detail).toContain('\n\n// Referenced by:\n');
  expect(detail).toContain('SPEC-sample.trm:6-12');
});

test('list --unreachable-from uses reachability roots and combines with name selection', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, 'docs', 'SPEC-isolated.trm'),
    '@knowledge isolated\n@viewpoints specification\nconcept _Isolated_ = { Alone. }\n',
  );
  const result = await c.run('term', 'list', '--unreachable-from', '_Slot_', '--output', 'json');
  expect(result.code).toBe(0);
  expect(
    JSON.parse(result.text).termDeclarations.map(
      (termDeclaration: { name: string }) => termDeclaration.name,
    ),
  ).toEqual(['_Isolated_']);
});

test('an option the operation cannot honor is refused, never accepted and ignored', async () => {
  const c = await cli();
  // A Guide is read in its own declared Viewpoints and composes none.
  await expect(c.run('skill', 'view', 'aterm', '--viewpoint', 'specification')).rejects.toThrow(
    'unknown option',
  );
  await expect(c.run('skill', 'view', 'modeling', '--viewpoint', 'absent')).rejects.toThrow(
    'unknown option',
  );
  await expect(c.run('skill', 'view', 'modeling', '--viewpoint', 'specification')).rejects.toThrow(
    'unknown option',
  );
  await expect(c.run('viewpoint', 'view', 'absent')).rejects.toThrow(
    'Unknown Viewpoint absent; available: specification.',
  );
});

test('every result lists Term Declarations by ascending Term name, whatever order the selectors take', async () => {
  const c = await cli();
  const names = (text: string) =>
    [...text.matchAll(/^(?:concept|procedure|undecided) (_[A-Za-z0-9_]+_) = \{/gm)].map(
      (match) => match[1],
    );
  expect(names((await c.run('term', 'show', '_Slot_', '_Product_')).text)).toEqual([
    '_Product_',
    '_Slot_',
  ]);
  expect(names((await c.run('term', 'show', '_Product_', '_Slot_')).text)).toEqual([
    '_Product_',
    '_Slot_',
  ]);
  const listed = (await c.run('term', 'list')).text
    .split('\n')
    .slice(1)
    .map((row) => row.split(' ')[0])
    .filter(Boolean);
  expect(listed).toEqual([...listed].sort());
});

test('viewpoint and skill CLI selections support the same quoted globs as discovery', async () => {
  const c = await cli();
  const vocabulary = JSON.parse(
    (await c.run('viewpoint', 'view', 'spec*', '--output', 'json')).text,
  );
  expect(vocabulary.viewpoints.map((v: { name: string }) => v.name)).toEqual(['specification']);
  await expect(c.run('skill', 'view', 'modeling', '--viewpoint', 'spec*')).rejects.toThrow(
    'unknown option',
  );
  const noVocabulary = JSON.parse(
    (await c.run('viewpoint', 'view', 'absent*', '--output', 'json')).text,
  );
  expect(noVocabulary.viewpoints).toEqual([]);
  const noTerms = JSON.parse(
    (await c.run('term', 'list', '--viewpoint', 'absent*', '--output', 'json')).text,
  );
  expect(noTerms.termDeclarations).toEqual([]);
});

test('external search and rename options reach text, structured results and dry-run', async () => {
  const c = await cli();
  await mkdir(join(c.workspace, 'src'));
  const path = join(c.workspace, 'src/main.ts');
  await writeFile(path, '// ExternalOnly _sample:Product_\n');
  const options = ['--external', 'core=src/**/*.ts'];
  expect((await c.run('corpus', 'search', 'ExternalOnly', ...options)).text).toContain(
    'ext.core: src/main.ts:1:4',
  );
  const structured = JSON.parse(
    (await c.run('corpus', 'search', 'ExternalOnly', ...options, '--output', 'json')).text,
  );
  expect(structured.externalMatches).toEqual([
    {
      source: 'core',
      file: 'src/main.ts',
      line: 1,
      column: 4,
      text: '// ExternalOnly _sample:Product_',
    },
  ]);
  const preview = await c.run('term', 'rename', '_Product_', '_Item_', ...options, '--dry-run');
  expect(preview.text).toContain('src/main.ts');
  expect(preview.text).toContain('_sample:Item_');
  expect(await readFile(path, 'utf8')).toContain('_sample:Product_');
  expect((await c.run('term', 'rename', '_Product_', '_Item_', ...options)).code).toBe(0);
  expect(await readFile(path, 'utf8')).toBe('// ExternalOnly _sample:Item_\n');
});

test('duplicate Terms fail CLI checks and reads regardless of Term Kind, without configuration', async () => {
  const c = await cli();
  const path = join(c.workspace, 'docs', 'SPEC-sample.trm');
  const before =
    '@knowledge sample\n@viewpoints specification\n' +
    sample +
    'procedure _Product_ = { Process the product. }\n';
  await writeFile(path, before);
  const checked = await c.run('corpus', 'check');
  expect(checked.code).toBe(1);
  expect(checked.text).toContain('Duplicate Term _sample:Product_');
  expect(checked.text).toContain('exactly one Term Declaration');
  process.exitCode = 0;
  for (const args of [
    ['term', 'show', '_Product_'],
    ['graph', 'overview', '_Product_'],
    ['term', 'rename', '_Product_', '_New_'],
  ])
    await expect(c.run(...args)).rejects.toThrow('Duplicate Term');
  expect(await readFile(path, 'utf8')).toBe(before);
});

test('skill lifecycle CLI installs, updates and uninstalls with structured results', async () => {
  const c = await cli();
  const directory = join(c.workspace, '.aterm/skills');
  const installed = JSON.parse((await c.run('skill', 'install', '--output', 'json')).text);
  expect(installed.operation).toBe('install');
  expect(installed.added).toEqual(installedPaths().map((p) => join(directory, p)));
  const updated = JSON.parse((await c.run('skill', 'update', '--output', 'json')).text);
  expect(updated.unchanged).toHaveLength(packagedSkillNames.length);
  const removed = JSON.parse((await c.run('skill', 'uninstall', '--output', 'json')).text);
  expect(removed.removed).toHaveLength(packagedSkillNames.length);
});

test('Skill lifecycle subcommands refuse positional names and read selectors', async () => {
  for (const args of [
    ['install', '--update'],
    ['update', '--uninstall'],
    ['install', 'aterm'],
    ['install', '/tmp/old-destination'],
    ['install', '--viewpoint', 'specification'],
  ]) {
    const c = await cli();
    await expect(c.run('skill', ...args)).rejects.toThrow();
  }
});

test('Knowledge selectors return candidates with exit 0, qualify URLs and refuse ambiguous writes', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, 'docs', 'other.trm'),
    '@knowledge other\n@viewpoints specification\nconcept _Product_ = { Other product. }',
  );
  const candidates = await c.run('term', 'show', '_Product_', '--section', 'definition');
  expect(candidates.code).toBe(0);
  expect(candidates.text).toContain('_other:Product_');
  expect(candidates.text).toContain('_sample:Product_');
  expect(candidates.text).toContain('--knowledge');
  expect(
    (await c.run('term', 'show', '_Product_', '--knowledge', 'other', '--section', 'definition'))
      .text,
  ).toBe('Other product.\n');
  const structured = JSON.parse(
    (await c.run('term', 'show', '_Product_', '--output', 'json')).text,
  );
  expect(structured.ambiguity.candidates).toHaveLength(2);
  await expect(c.run('term', 'rename', '_Product_', '_Item_')).rejects.toThrow('Ambiguous');
  const preview = await c.run('knowledge', 'rename', 'other', 'catalog', '--dry-run');
  expect(preview.text).toContain('@knowledge catalog');
  expect(await readFile(join(c.workspace, 'docs', 'other.trm'), 'utf8')).toContain(
    '@knowledge other',
  );
  await c.run('knowledge', 'rename', 'other', 'catalog');
  expect((await c.run('term', 'show', '_catalog:Product_', '--section', 'definition')).text).toBe(
    'Other product.\n',
  );
});

test('list --tree nests only matching Term Declarations and preserves structured results', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, 'docs', 'SPEC-sample.trm'),
    '@knowledge sample\n@viewpoints specification\n' +
      sample
        .replace('concept _Slot_ =', 'concept _Slot_ in machine.parts =')
        .replace('concept _Product_ =', 'concept _Product_ in catalog.concepts =') +
      'procedure _Process_Product_ in catalog.actions = { Process the product. }\n',
  );
  await writeFile(
    join(c.workspace, 'docs', 'other.trm'),
    '@knowledge other\n@viewpoints specification\nconcept _Other_ in elsewhere = { Other. }\n',
  );
  const all = await c.run('term', 'list', '--tree');
  expect(all.code).toBe(0);
  expect(all.text).toContain('SPEC-sample.trm — @knowledge sample (3 Term Declarations)');
  expect(all.text).toContain('catalog (2)');
  expect(all.text).toContain('concept _Product_ [specification]');
  expect(all.text).toContain('procedure _Process_Product_ [specification]');
  expect(all.text).toContain('other.trm — @knowledge other (1 Term Declaration)');

  const filtered = await c.run(
    'term',
    'list',
    '*Slot*',
    '--tree',
    '--knowledge',
    'sample',
    '--viewpoint',
    'spec*',
    '--with-fileline',
  );
  expect(filtered.text).toBe(
    [
      `${c.workspace}/docs/SPEC-sample.trm — @knowledge sample (1 Term Declaration)`,
      '└── machine (1)',
      '    └── parts (1)',
      `        └── concept _Slot_ [specification]  // ${c.workspace}/docs/SPEC-sample.trm:3`,
      '',
    ].join('\n'),
  );
  expect(
    (await c.run('term', 'list', '*Slot*', '--tree', '--knowledge', 'sample', '--unreferenced'))
      .text,
  ).toBe(filtered.text.replace(`  // ${c.workspace}/docs/SPEC-sample.trm:3`, ''));
  expect(
    (await c.run('term', 'list', '--tree', '--unreachable-from', '_sample:Slot_')).text,
  ).toContain('concept _Other_ [specification]');
  expect((await c.run('term', 'list', '*Missing*', '--tree')).text).toBe('No matches.\n');

  for (const format of ['json', 'yaml']) {
    const plain = (await c.run('term', 'list', '--output', format)).text;
    const tree = (await c.run('term', 'list', '--tree', '--output', format)).text;
    expect(tree).toBe(plain);
    expect(parse(tree).termDeclarations).toHaveLength(4);
    expect(
      parse(tree).termDeclarations.some(
        (termDeclaration: { group?: string }) => termDeclaration.group === 'catalog.actions',
      ),
    ).toBe(true);
  }
});

test('groups show help without selecting Home; removed commands and implicit reads refuse with guidance', async () => {
  const invocation = new CommandInvocation({ text: async () => '', cwd: () => '/unused' }, {});
  const execute = vi.spyOn(invocation, 'execute');
  for (const resource of ['term', 'corpus', 'knowledge', 'graph', 'viewpoint', 'skill', 'server']) {
    const program = new AtermProgram(invocation).create();
    let help = '';
    const group = program.commands.find((c) => c.name() === resource)!;
    group.configureOutput({
      writeOut: (text) => {
        help += text;
      },
    });
    await program.parseAsync(['node', 'aterm', resource]);
    expect(help).toContain('Commands:');
  }
  expect(execute).not.toHaveBeenCalled();
  const c = await cli();
  for (const old of ['list', 'search', 'show', 'view', 'grep', 'rename-knowledge', 'changes']) {
    await expect(c.run(old)).rejects.toThrow('moved; use aterm');
  }
  for (const args of [
    ['viewpoint', 'specification'],
    ['skill', 'aterm'],
    ['skill', '--install'],
  ]) {
    await expect(c.run(...args)).rejects.toThrow();
    expect(c.err.join('')).toContain('<operation>');
  }
  for (const resource of ['term', 'knowledge', 'viewpoint', 'skill']) {
    await expect(c.run(resource, 'view')).rejects.toThrow('missing required argument');
  }
});

test('Knowledge CLI exposes metadata, explicit Scope and Term Declaration inventory in every output format', async () => {
  const c = await cli();
  const file = join(c.workspace, 'docs', 'SPEC-sample.trm');
  await writeFile(
    file,
    '@knowledge sample\n@viewpoints specification\n@scope {\n  Model inventory.\n}\n' + sample,
  );
  expect((await c.run('knowledge', 'list')).text).toMatch(/sample\s+2\s+specification/);
  expect((await c.run('knowledge', 'view', 'sample')).text).toContain(
    '### Scope\n\nModel inventory.\n\n### Declarations\n\n',
  );
  const json = JSON.parse((await c.run('knowledge', 'view', 'sample', '--output', 'json')).text);
  expect(json.knowledges[0].termDeclarations).toHaveLength(2);
  const md = (await c.run('knowledge', 'view', 'sample', '--output', 'markdown')).text;
  expect(md).toContain('### Scope\n\nModel inventory.\n\n### Declarations\n\n');
  expect(md.match(/\n+$/)?.[0]).toBe('\n\n\n');
  expect(parse((await c.run('knowledge', 'list', '--output', 'yaml')).text).knowledges[0].id).toBe(
    'sample',
  );
  await expect(c.run('knowledge', 'view', 'absent')).rejects.toThrow('Unknown Knowledge');
  await expect(c.run('knowledge', 'list', '--knowledge', 'sample')).rejects.toThrow(
    'does not accept knowledge',
  );
});

test('Skill inventory IDs share expanded body between Markdown, JSON and installed content', async () => {
  const c = await cli();
  const config = join(c.workspace, '.aterm', 'aterm.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')) + '  skill: ' + join(viewpointSource, 'skill.md') + '\n',
  );
  await writeFile(
    join(c.workspace, 'docs', 'skill.trm'),
    '@knowledge custom\n@viewpoints skill\nskill _Skill_Test_ = {\n  Test guidance.\n.relations\n  references _Rule_\n.description\n  Use for tests.\n.body\n  _Rule_.contract†\n}\nrule _Rule_ = {\n  A rule.\n.contract\n  - Preserve evidence.\n}\n',
  );
  const inventory = JSON.parse((await c.run('skill', 'list', '--output', 'json')).text);
  expect(inventory.skills).toContainEqual(expect.objectContaining({ term: '_custom:Skill_Test_' }));
  const skill = await c.run('skill', 'view', '_custom:Skill_Test_');
  expect(skill).toEqual(
    await c.run('skill', 'view', '_custom:Skill_Test_', '--output', 'markdown'),
  );
  expect(skill.text).toContain('- Preserve evidence.');
  expect(skill.text).not.toContain('_Rule_.contract†');
  expect(
    JSON.parse(
      (await c.run('skill', 'view', '_custom:Skill_Test_', '--output', 'json')).text,
    ).skills[0].markdown.trimEnd(),
  ).toBe(skill.text.trimEnd());
  await c.run('skill', 'install');
  const installedText = await readFile(
    join(c.workspace, '.aterm/skills/custom-skill-test/SKILL.md'),
    'utf8',
  );
  expect(installedText.split(/---\n\n/)[1]?.trimEnd()).toBe(
    (await c.run('skill', 'toc', '_custom:Skill_Test_')).text.trimEnd(),
  );
  await expect(
    c.run('skill', 'view', '_custom:Skill_Test_', '--viewpoint', 'skill'),
  ).rejects.toThrow();
  for (const args of [
    ['--output', 'json', 'term', 'list'],
    ['term', '--output', 'json', 'list'],
    ['term', 'list', '--output', 'json'],
  ]) {
    expect(JSON.parse((await c.run(...args)).text).operation).toBe('list');
  }
});

test('every list is a flat aligned table, including Markdown; Viewpoint lists contain no Term Kind rows', async () => {
  const c = await cli();
  const knowledgeSource = join(c.workspace, 'docs', 'SPEC-sample.trm');
  await writeFile(
    knowledgeSource,
    (await readFile(knowledgeSource, 'utf8')).replace(
      '@viewpoints specification\n',
      '@viewpoints specification\n@description {\n  Inventory model.\n}\n',
    ),
  );
  const headers = {
    term: ['TERM', 'TERM KIND', 'VIEWPOINT'],
    knowledge: ['KNOWLEDGE', 'TERMS', 'VIEWPOINTS', 'DESCRIPTION'],
    viewpoint: ['VIEWPOINT', 'DESCRIPTION'],
    skill: ['TERM', 'DESCRIPTION'],
  };
  for (const [resource, columns] of Object.entries(headers)) {
    const text = (await c.run(resource, 'list')).text.trimEnd().split('\n');
    expect(text[0]!.split(/ {2,}/)).toEqual(columns);
    const starts = columns.map((column) => text[0]!.indexOf(column));
    for (const row of text.slice(1))
      for (let column = 1; column < starts.length; column++) {
        expect(row.slice(starts[column]! - 2, starts[column])).toBe('  ');
        expect(row[starts[column]!]).not.toBe(' ');
      }
    const markdown = (await c.run(resource, 'list', '--output', 'markdown')).text;
    expect(markdown.trimEnd().split('\n')).toHaveLength(text.length + 1);
    expect(
      markdown
        .split('\n')[0]!
        .split('|')
        .slice(1, -1)
        .map((s) => s.trim().toUpperCase()),
    ).toEqual(columns);
  }
  const listing = (await c.run('viewpoint', 'list')).text;
  expect(listing.trimEnd().split('\n')).toHaveLength(2);
  expect(listing).not.toContain('concept');
  expect(listing).not.toContain('viewpoint view');
});

test('Viewpoint view preserves complete original Markdown including CRLF, comments and EOF', async () => {
  const c = await cli();
  const source =
    (await readFile(join(viewpointSource, 'specification.md'), 'utf8'))
      .replace('name: specification', '# Preserve this comment\nname: specification')
      .trimEnd()
      .replace(/\n/g, '\r\n') + '  ';
  const path = join(c.workspace, '.aterm', 'specification.md');
  await writeFile(path, source);
  await writeFile(
    join(c.workspace, '.aterm', 'aterm.yaml'),
    `sources: [docs]\nuseViewpoints: []\nviewpoints:\n  specification: ${path}\n`,
  );
  for (const format of [[], ['--output', 'markdown']])
    expect((await c.run('viewpoint', 'view', 'spec*', ...format)).text).toBe(source);
  const structured = JSON.parse(
    (await c.run('viewpoint', 'view', 'specification', '--output', 'json')).text,
  );
  expect(structured.viewpoints[0].source).toBe(source);
  expect(structured.viewpoints[0].termKinds.length).toBeGreaterThan(0);
  const list = JSON.parse((await c.run('viewpoint', 'list', '--output', 'json')).text);
  expect(list.viewpoints[0].source).toBeUndefined();
  expect(list.viewpoints[0].termKinds.length).toBeGreaterThan(0);
  const independent = JSON.parse(
    (await c.run('skill', 'view', '_aterm_skills:Modeling_Skill_', '--output', 'json')).text,
  );
  expect(independent.skills[0].term).toBe('_aterm_skills:Modeling_Skill_');
  expect((await c.run('viewpoint', 'view', 'absent*')).text).toBe('No viewpoints.\n');
  expect((await c.run('viewpoint', 'view', 'absent*', '--output', 'markdown')).text).toBe(
    'No viewpoints.\n\n\n',
  );
  const otherSource = source.replace('name: specification', 'name: other');
  const otherPath = join(c.workspace, '.aterm', 'other.md');
  await writeFile(otherPath, otherSource);
  await writeFile(
    join(c.workspace, '.aterm', 'aterm.yaml'),
    `sources: [docs]\nuseViewpoints: []\nviewpoints:\n  specification: ${path}\n  other: ${otherPath}\n`,
  );
  for (const format of [[], ['--output', 'markdown']])
    expect((await c.run('viewpoint', 'view', 'other', '*', ...format)).text).toBe(
      source + otherSource,
    );
  await expect(c.run('viewpoint', 'view', 'specification', '--guidance')).rejects.toThrow(
    'unknown option',
  );
});

test('Knowledge Description is reader content while Scope remains authoring guidance', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, 'docs', 'SPEC-sample.trm'),
    '@knowledge sample\n@viewpoints specification\n@description {\n  Inventory and dispensing.\n  Worked examples.\n}\n@scope {\n  Cover stock behavior only.\n}\n' +
      sample,
  );
  for (const format of [[], ['--output', 'markdown']]) {
    const list = (await c.run('knowledge', 'list', ...format)).text;
    expect(list).toContain('Inventory and dispensing. Worked examples.');
    expect(list).not.toContain('Cover stock behavior only.');
    expect(list).not.toContain('SPEC-sample.trm');
    expect(list.split('\n')[0]).not.toMatch(/ENTRIES|FILE/i);
    const view = (await c.run('knowledge', 'view', 'sample', ...format)).text;
    expect(view).toContain('## sample\n\nInventory and dispensing.\nWorked examples.\n\n');
    expect(view).toContain('### Scope\n\nCover stock behavior only.\n\n### Declarations');
  }
  const json = JSON.parse((await c.run('knowledge', 'view', 'sample', '--output', 'json')).text);
  expect(json.knowledges[0].description).toEqual({
    content: 'Inventory and dispensing.\nWorked examples.',
    line: 3,
    endLine: 6,
  });
  expect(
    parse((await c.run('knowledge', 'list', '--output', 'yaml')).text).knowledges[0].scope.content,
  ).toBe('Cover stock behavior only.');
});

test('term move previews and saves a Knowledge transfer through the CLI', async () => {
  const c = await cli();
  const destination = join(c.workspace, 'docs/target.trm');
  await writeFile(destination, '@knowledge target\n@viewpoints specification\n');
  const before = await readFile(destination, 'utf8');
  const preview = await c.run(
    'term',
    'move',
    '_sample:Product_',
    '--to',
    'target',
    '--dry-run',
    '--output',
    'json',
  );
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.text).files).toHaveLength(2);
  expect(await readFile(destination, 'utf8')).toBe(before);
  expect((await c.run('term', 'move', '_sample:Product_', '--to', 'target')).code).toBe(0);
  expect(await readFile(destination, 'utf8')).toContain('concept _Product_');
  expect((await c.run('corpus', 'check')).code).toBe(0);
  await expect(c.run('term', 'move', '_target:Product_')).rejects.toThrow('requires --to');
});

test('CLI reads and edits Viewpoint-qualified Term Kinds without merging their Term Declarations', async () => {
  const c = await cli();
  await writeFile(
    join(c.workspace, '.aterm', 'aterm.yaml'),
    'useDefaultKnowledge: false\nuseViewpoints: []\nsources: [docs]\nviewpoints:\n  domain: ' +
      join(viewpointSource, 'domain.md') +
      '\n  skill: ' +
      join(viewpointSource, 'skill.md') +
      '\n',
  );
  const file = join(c.workspace, 'docs', 'SPEC-sample.trm');
  const before =
    '@knowledge sample\n@viewpoints domain skill\ndomain.procedure _Domain_Run_ = { Run in domain. }\nskill.procedure _Run_ = {\n  Run guidance.\n.procedure\n  1. Run the suite.\n}\n';
  await writeFile(file, before);
  const list = await c.run('term', 'list', '--output', 'json');
  expect(list.code).toBe(0);
  expect(
    JSON.parse(list.text).termDeclarations.map((e: { termKind: string }) => e.termKind),
  ).toEqual(['domain.procedure', 'skill.procedure']);
  expect((await c.run('term', 'show', '_Run_')).text).toContain('skill.procedure _Run_');
  expect((await c.run('term', 'view', '_Run_', '--output', 'markdown')).text).toContain(
    '## skill.procedure _Run_',
  );
  const patch = join(c.workspace, 'edit.patch');
  await writeFile(
    patch,
    '*** Begin Patch\n*** Update Term: skill.procedure _sample:Run_.procedure\n@@\n-  1. Run the suite.\n+  1. Run the relevant suite.\n*** End Patch\n',
  );
  expect((await c.run('term', 'edit', '--file', patch, '--dry-run')).code).toBe(0);
  expect(await readFile(file, 'utf8')).toBe(before);
  expect((await c.run('term', 'edit', '--file', patch)).code).toBe(0);
  expect(await readFile(file, 'utf8')).toContain('1. Run the relevant suite.');
  expect((await c.run('corpus', 'check')).code).toBe(0);
});

test('corpus jq supports inline and file programs, scope, output formats and refusal', async () => {
  const c = await cli();
  const program = '.[] | .["@term"]';
  const inline = await c.run('corpus', 'jq', program, '--knowledges', 'SAMPLE');
  expect(JSON.parse(inline.text)).toEqual(['_sample:Product_', '_sample:Slot_']);
  const path = join(c.workspace, 'query.jq');
  await writeFile(path, program);
  expect(await c.run('corpus', 'jq', '--file', path, '--knowledges', 'SAMPLE')).toEqual(inline);
  expect(parse((await c.run('corpus', 'jq', program, '--output', 'yaml')).text)).toEqual(
    JSON.parse(inline.text),
  );
  expect((await c.run('corpus', 'jq', program, '--output', 'markdown')).text).toMatch(
    /^```json[\s\S]*```\n\n\n$/,
  );
  await expect(c.run('corpus', 'jq', program, '--file', path)).rejects.toThrow('either an inline');
  await expect((await cli()).run('corpus', 'jq', 'error("bad")')).rejects.toThrow('bad');
  process.exitCode = 0;
});

test('local CLI writes bounded usage evidence without command arguments or result content', async () => {
  const c = await cli();
  await c.run('term', 'view', '_Product_');
  const text = await readFile(join(c.workspace, '.aterm/usage.jsonl'), 'utf8');
  const rows = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(rows[0]).toMatchObject({
    event: 'start',
    kind: 'command',
    operation: 'term view',
    transport: 'cli',
  });
  expect(rows.at(-1)).toMatchObject({ event: 'finish', outcome: 'ok', exitCode: 0 });
  expect(rows.at(-1).stdoutBytes).toBeGreaterThan(0);
  expect(text).not.toContain('_Product_');
  expect(text).not.toContain('machine can dispense');
});
