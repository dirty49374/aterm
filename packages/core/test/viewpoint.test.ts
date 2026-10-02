import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  AtermConfigReader,
  AtermError,
  AtermViewpointReader,
  composeTermKinds,
  type IAtermHome,
} from '../src/index.js';

const doc = (name: string, body: string) =>
  ['---', `name: ${name}`, body, '---', '', `# ${name}`, '', 'Guidance.'].join('\n');

const uml = doc(
  'uml',
  [
    'description: UML classifiers.',
    'termKinds:',
    '  - name: class',
    '    description: A structural classifier.',
    '    sections:',
    '      - name: definition',
    '        type: md',
    '      - name: attributes',
    '        type: md',
    '        description: Its structural features.',
    '      - name: constraints',
    '        type: md',
  ].join('\n'),
);

const ddd = doc(
  'ddd',
  [
    'description: Domain building blocks.',
    'termKinds:',
    '  - name: entity',
    '    description: A thing with identity over time.',
    '    sections:',
    '      - name: definition',
    '        type: md',
    '      - name: attributes',
    '        type: md',
    '        description: What it holds.',
    '      - name: invariants',
    '        type: md',
  ].join('\n'),
);

const home = (workspace: string): IAtermHome => ({
  home: join(workspace, '.aterm'),
  workspace,
  configPath: join(workspace, '.aterm', 'aterm.yaml'),
  origin: 'option',
});

test('each kind of a Viewpoint carries its own Schema, and the body carries the guidance', () => {
  const parsed = new AtermViewpointReader().parse('uml', '/fixture/uml.md', uml);
  expect(parsed.name).toBe('uml');
  expect(parsed.source).toBe(uml);
  expect(parsed.termKinds.map((c) => c.name)).toEqual(['class']);
  const { schema } = parsed.termKinds[0]!;
  expect(schema.sections.map((f) => f.name)).toEqual([
    'definition',
    'relations',
    'attributes',
    'constraints',
  ]);
  expect(schema.sections[1]!.name).toBe('relations');
  expect(parsed.body.trim().startsWith('# uml')).toBe(true);
});

test('a Viewpoint that disagrees with its bound name, lacks frontmatter or declares a bad Schema fails', () => {
  const reader = new AtermViewpointReader();
  expect(() => reader.parse('other', '/f.md', uml)).toThrow('names itself uml');
  expect(() => reader.parse('uml', '/f.md', '# no frontmatter')).toThrow('frontmatter');
  expect(() => reader.parse('uml', '/f.md', doc('uml', 'description: No kinds.'))).toThrow(
    'termKinds',
  );
  const first = doc(
    'uml',
    [
      'description: Misordered.',
      'termKinds:',
      '  - name: class',
      '    description: A structural classifier.',
      '    sections:',
      '      - name: attributes',
      '        type: md',
    ].join('\n'),
  );
  expect(() => reader.parse('uml', '/f.md', first)).toThrow(
    'must begin with the definition section',
  );
  const absent = doc(
    'uml',
    [
      'description: Absent relations.',
      'termKinds:',
      '  - name: class',
      '    description: A structural classifier.',
      '    sections:',
      '      - name: definition',
      '        type: md',
      '    relations: nowhere',
    ].join('\n'),
  );
  expect(() => reader.parse('uml', '/f.md', absent)).toThrow('relations');
});

test('paths resolve against the user home, the Aterm home, or as given', () => {
  const reader = new AtermViewpointReader('/users/me');
  expect(reader.resolvePath('/p/.aterm', '~/lib/uml.md')).toBe('/users/me/lib/uml.md');
  expect(reader.resolvePath('/p/.aterm', './uml.md')).toBe('/p/.aterm/uml.md');
  expect(reader.resolvePath('/p/.aterm', '/abs/uml.md')).toBe('/abs/uml.md');
});

test('a Knowledge composes the kinds of every Viewpoint it declares, in that order', () => {
  const uml_ = new AtermViewpointReader().parse('uml', '/f/uml.md', uml);
  const ddd_ = new AtermViewpointReader().parse('ddd', '/f/ddd.md', ddd);
  const termKinds = composeTermKinds([ddd_, uml_]);
  expect(termKinds.map((c) => c.name)).toEqual(['entity', 'class']);
  // Each kind keeps the sections its own Viewpoint gave it; nothing merges across them.
  expect(termKinds[0]!.schema.sections.map((f) => f.name)).toEqual([
    'definition',
    'relations',
    'attributes',
    'invariants',
  ]);
  expect(termKinds[1]!.schema.sections.map((f) => f.name)).toEqual([
    'definition',
    'relations',
    'attributes',
    'constraints',
  ]);

  expect(termKinds.map((c) => c.viewpoint)).toEqual(['ddd', 'uml']);
});

test('same local Term Kind names remain distinct across Viewpoints even with identical schemas', () => {
  const parse = (name: string, body: string) =>
    new AtermViewpointReader().parse(name, `/f/${name}.md`, doc(name, body));
  const variant = (description: string, type: string) =>
    [
      'description: Another.',
      'termKinds:',
      '  - name: class',
      `    description: ${description}`,
      '    sections:',
      '      - name: definition',
      '        type: md',
      '      - name: attributes',
      `        type: ${type}`,
      '        description: Its structural features.',
      '      - name: constraints',
      '        type: md',
    ].join('\n');
  const umlParsed = new AtermViewpointReader().parse('uml', '/f/uml.md', uml);
  for (const other of [
    parse('other', variant('Something else entirely.', 'md')),
    parse('other', variant('A structural classifier.', 'ts')),
  ])
    expect(composeTermKinds([umlParsed, other]).map((termKind) => termKind.viewpoint)).toEqual([
      'uml',
      'other',
    ]);
  // Identical content still belongs to distinct Viewpoint-qualified Term Kinds.
  const same = parse('same', variant('A structural classifier.', 'md'));
  expect(composeTermKinds([umlParsed, same]).map((c) => c.viewpoint)).toEqual(['uml', 'same']);
  expect(composeTermKinds([umlParsed, umlParsed])).toHaveLength(1);
});

test('a missing Viewpoint file fails the configuration that names it', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-vp-'));
  await writeFile(join(workspace, 'kept.md'), uml);
  await expect(new AtermViewpointReader().read('uml', workspace, './absent.md')).rejects.toThrow(
    'Missing Viewpoint uml',
  );
});

const asked = doc(
  'asked',
  [
    'description: A Viewpoint that asks.',
    'termKinds:',
    '  - name: entity',
    '    description: Identity persists.',
    '    sections:',
    '      - name: definition',
    '        type: md',
    '        question: What is _X_? _X_ is ___',
    '        example: |',
    '          _Order_ is a request to buy.',
    '          Head noun "request": the kind.',
    '      - name: rules',
    '        type: md',
    '        question: |',
    '          What changes _X_? _X_ is changed by ___',
    '          What holds?',
  ].join('\n'),
);

test('each section asks its own questions, one per line, the frame after the question mark', () => {
  const reader = new AtermViewpointReader();
  const parsed = reader.parse('asked', '/f/asked.md', asked);
  const [definition, , rules] = parsed.termKinds[0]!.schema.sections;
  expect(definition!.questions).toEqual([{ ask: 'What is _X_?', frame: '_X_ is ___' }]);
  expect(definition!.example).toBe('_Order_ is a request to buy.\nHead noun "request": the kind.');
  expect(rules!.questions).toEqual([
    { ask: 'What changes _X_?', frame: '_X_ is changed by ___' },
    { ask: 'What holds?' },
  ]);
  const stray = asked.replace('        question: What is _X_? _X_ is ___', '        questions: x');
  expect(() => reader.parse('asked', '/f/asked.md', stray)).toThrow('questions');
});

test('reading Viewpoints answers from the configuration, narrowed by name', async () => {
  const { ViewpointReading } = await import('../src/index.js');
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-vp-'));
  const reader = new AtermConfigReader();
  const config = reader.parse(
    home(workspace),
    'sources: [docs]\nuseViewpoints: []\nviewpoints:\n  asked: ./asked.md\n',
    new Map([['asked', new AtermViewpointReader().parse('asked', '/f/asked.md', asked)]]),
  );
  const reading = new ViewpointReading();
  const all = reading.read(config);
  expect(all.viewpoints.map((v) => v.name)).toEqual(['asked']);
  expect(all.selected).toBe(false);
  expect(all.viewpoints[0]!.termKinds[0]!.sections.map((f) => f.name)).toEqual([
    'definition',
    'relations',
    'rules',
  ]);
  expect(all.viewpoints[0]!.guidance).toBeUndefined();
  expect(all.viewpoints[0]!.source).toBeUndefined();
  expect(reading.read(config, { viewpoints: ['asked'] }).viewpoints[0]!.source).toBe(asked);
  expect(
    all.viewpoints[0]!.termKinds[0]!.sections.flatMap((s) => s.questions ?? []).map((q) => q.ask),
  ).toEqual(['What is _X_?', 'What changes _X_?', 'What holds?']);
  expect(reading.read(config, { viewpoints: ['asked'] }).selected).toBe(true);
  expect(reading.read(config, { guidance: true }).viewpoints[0]!.guidance).toContain('Guidance.');
  // A refusal crosses the boundary as one AtermError naming what this home does bind.
  expect(() => reading.read(config, { viewpoints: ['absent'] })).toThrow(
    'Unknown Viewpoint absent; available: asked.',
  );
  expect(() => reading.read(config, { viewpoints: ['absent'] })).toThrow(AtermError);
});
