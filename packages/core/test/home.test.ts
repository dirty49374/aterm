import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  AtermConfigReader,
  AtermHomeDiscovery,
  AtermInitialization,
  AtermViewpointReader,
  AtermApplication,
  installedViewpoints,
  viewpointSource,
} from '../src/index.js';

async function tree() {
  const base = await mkdtemp(join(tmpdir(), 'aterm-home-'));
  const project = join(base, 'project');
  await mkdir(join(project, '.aterm'), { recursive: true });
  await mkdir(join(project, 'src', 'deep'), { recursive: true });
  const user = join(base, 'user');
  await mkdir(join(user, '.aterm'), { recursive: true });
  return { base, project, user };
}

test('discovers the nearest ancestor .aterm, then falls back to the user home, then fails', async () => {
  const { base, project, user } = await tree();
  const discovery = new AtermHomeDiscovery({}, user);
  const found = await discovery.discover(join(project, 'src', 'deep'));
  expect(found).toMatchObject({
    home: join(project, '.aterm'),
    workspace: project,
    configPath: join(project, '.aterm', 'aterm.yaml'),
    origin: 'ancestor',
  });
  expect(await discovery.discover(base)).toMatchObject({
    home: join(user, '.aterm'),
    origin: 'user',
  });
  await expect(new AtermHomeDiscovery({}, join(base, 'nobody')).discover(base)).rejects.toThrow(
    'run aterm init',
  );
});

test('an explicit option precedes ATERM_HOME, which precedes discovery; both must be directories', async () => {
  const { base, project, user } = await tree();
  const other = join(base, 'other', '.aterm');
  await mkdir(other, { recursive: true });
  const env = { ATERM_HOME: other };
  expect(await new AtermHomeDiscovery(env, user).discover(project)).toMatchObject({
    home: other,
    origin: 'environment',
  });
  expect(
    await new AtermHomeDiscovery(env, user).discover(project, join(project, '.aterm')),
  ).toMatchObject({ home: join(project, '.aterm'), origin: 'option' });
  expect(await new AtermHomeDiscovery(env, user).discover(project, '.aterm')).toMatchObject({
    workspace: project,
  });
  await expect(
    new AtermHomeDiscovery({ ATERM_HOME: join(base, 'missing') }, user).discover(project),
  ).rejects.toThrow('not a directory');
  await expect(new AtermHomeDiscovery({ ATERM_HOME: ' ' }, user).discover(project)).rejects.toThrow(
    'must not be empty',
  );
});

test('config resolves sources against the root, applies Schema defaults and rejects conflicts', async () => {
  const { project } = await tree();
  const home = await new AtermHomeDiscovery({}, project).discover(project);
  const reader = new AtermConfigReader();
  await expect(reader.read(home)).rejects.toThrow('run aterm init');
  const guide = new AtermViewpointReader().parse(
    'guide',
    '/fixture/guide.md',
    [
      '---',
      'name: guide',
      'description: Instructions.',
      'termKinds:',
      '  - name: guide',
      '    description: One body of instructions.',
      '    sections:',
      '      - name: definition',
      '        type: md',
      '      - name: body',
      '        type: md',
      '---',
      '',
      '# Guide',
    ].join('\n'),
  );
  const config = reader.parse(
    home,
    'sources: [docs, /abs/elsewhere, docs]\nuseViewpoints: []\nviewpoints:\n  guide: ./guide.md\n',
    new Map([['guide', guide]]),
  );
  expect(config.sources).toEqual([join(project, 'docs'), '/abs/elsewhere']);
  expect(config.useDefaultKnowledge).toBe(true);
  expect(
    reader.parse(home, 'sources: [docs]\nuseViewpoints: []\nuseDefaultKnowledge: false')
      .useDefaultKnowledge,
  ).toBe(false);
  expect(config.viewpoints.map((v) => v.name)).toEqual(['guide']);
  expect(config.viewpoints[0]!.termKinds[0]!.schema.sections.map((s) => s.name)).toEqual([
    'definition',
    'relations',
    'body',
  ]);
  expect(config.viewpoints[0]!.termKinds.map((c) => c.description)).toEqual([
    'One body of instructions.',
  ]);
  for (const [text, message] of [
    ['viewpoints: {}', 'sources'],
    ['sources: []', 'sources'],
    ['sources: [docs]\nuseDefaultKnowledge: "false"', 'useDefaultKnowledge'],
    ['sources: [docs]\ntermKinds: {}', 'termKinds'],
    ['sources: [docs]\nviewpoints:\n  a: 1', 'viewpoints'],
    ['sources: [docs\nviewpoints: {}', 'aterm.yaml'],
  ] as const)
    expect(() => reader.parse(home, text)).toThrow(message);
});

test('init writes the default configuration once and the result opens as an application', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aterm-init-'));
  const result = await new AtermInitialization().create(base);
  expect(result.configPath).toBe(join(base, '.aterm', 'aterm.yaml'));
  expect(await readFile(result.configPath, 'utf8')).toContain('@viewpoints specification');
  expect(result.viewpoints).toEqual(
    installedViewpoints.map((name) => join(viewpointSource, `${name}.md`)),
  );
  expect(await readFile(result.configPath, 'utf8')).toContain(
    'useViewpoints: [specification, generic, domain, skill]',
  );
  expect(await readFile(result.viewpoints[0]!, 'utf8')).toContain('name: specification');
  await expect(new AtermInitialization().create(base)).rejects.toThrow('Already initialized');
  const app = await AtermApplication.open({ cwd: base, env: {} });
  expect(app.config.sources).toEqual([join(base, 'docs')]);
  expect(app.config.viewpoints.map((v) => v.name)).toEqual([...installedViewpoints]);
  expect(app.config.viewpoints.every((v) => v.readOnly)).toBe(true);
  expect(app.config.viewpoints[0]!.termKinds.map((c) => c.name)).toEqual([
    'concept',
    'procedure',
    'undecided',
  ]);
  await writeFile(
    join(base, 'docs', 'one.trm'),
    '@knowledge one\n@viewpoints specification\nconcept _One_ = { One. }\n',
  );
  const listed = await app.query({ operation: 'list', knowledge: 'one' });
  expect(
    'termDeclarations' in listed && listed.termDeclarations.map((d) => [d.name, d.viewpoint]),
  ).toEqual([['_One_', 'specification']]);
});

test('every Viewpoint the package ships is a file that parses into usable kinds', async () => {
  const reader = new AtermViewpointReader();
  for (const name of installedViewpoints) {
    const parsed = await reader.read(name, viewpointSource, `./${name}.md`);
    expect(parsed.name).toBe(name);
    expect(parsed.termKinds.length).toBeGreaterThan(0);
    for (const termKind of parsed.termKinds)
      expect(termKind.schema.sections[0]!.name).toBe('definition');
  }
});

test('Viewpoint frontmatter requires termKinds and refuses the former kinds key', async () => {
  const reader = new AtermViewpointReader();
  const { base } = await tree();
  const source = await readFile(join(viewpointSource, 'generic.md'), 'utf8');
  const file = join(base, 'generic.md');
  await writeFile(file, source.replace(/^termKinds:/m, 'kinds:'));
  await expect(reader.read('generic', base, './generic.md')).rejects.toThrow('kinds');
  await writeFile(file, source);
  expect((await reader.read('generic', base, './generic.md')).termKinds[0]!.name).toBe('term');
});

test('init preserves unbound local Viewpoint files and uses package bindings', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aterm-init-collision-'));
  const directory = join(base, '.aterm', 'viewpoints');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'specification.md');
  await writeFile(path, 'User-owned vocabulary.');
  await new AtermInitialization().create(base);
  const app = await AtermApplication.open({ cwd: base, env: {} });
  expect(app.config.viewpoints[0]!.path).toBe(join(viewpointSource, 'specification.md'));
  expect(await readFile(path, 'utf8')).toBe('User-owned vocabulary.');
});
