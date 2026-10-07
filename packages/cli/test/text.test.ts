import { expect, test } from 'vitest';
import {
  AtermParser as SourceParser,
  AtermSchema,
  TermDeclarationProjection,
  type ITermDeclarationResult,
} from '@garage49/aterm-core';
import { TermDeclarationText } from '../src/presentation-module/index.js';

class AtermParser extends SourceParser {
  override parse(file: string, text: string) {
    return super.parse(file, '@knowledge fixture\n' + text);
  }
}

const empty: ITermDeclarationResult = {
  operation: 'list',
  files: [],
  termDeclarations: [],
  edges: [],
  diagnostics: [],
  includeRemarks: true,
};

test('check distinguishes warnings from errors and only prints paths on request', () => {
  const result: ITermDeclarationResult = {
    ...empty,
    files: ['/fixture/check.trm'],
    warnings: [{ file: '/fixture/check.trm', line: 7, message: 'Ignored: /fixture/check.trm' }],
  };
  const output = new TermDeclarationText();
  expect(output.render({ ...result, operation: 'check' })).toContain('Warning: Ignored');
  expect(output.render({ ...result, operation: 'check' })).not.toContain('/fixture/');
  expect(output.render({ ...result, operation: 'check' })).not.toContain('No diagnostics');
  expect(output.render({ ...result, operation: 'check' }, true)).toContain(
    '/fixture/check.trm:7: Warning:',
  );
  expect(output.render({ ...empty, operation: 'check' })).toBe(
    'Checked 0 Aterm files, 0 Term Declarations. No diagnostics.\n',
  );
  expect(output.render({ ...empty, operation: 'list' })).toBe('TERM  TERM KIND  VIEWPOINT\n');
  expect(output.render({ ...empty, operation: 'path' })).toBe('No path.\n');
  expect(output.render({ ...empty, operation: 'grep' })).toBe('No references.\n');
  expect(output.render({ ...empty, operation: 'relations' })).toBe('No relations.\n');
});

test('show and default view emit copyable blocks preserving typed Contract and Remarks', () => {
  const source =
    'undecided _Shape_ = ```md\n  A shape.\n---ts\n  interface Shape { id: string }\n---ts\n  const example = { id: "one" };\n```';
  const schema = new AtermSchema('Typed examples', [
    { name: 'definition', type: 'md' },
    { name: 'contract', type: 'ts' },
    { name: 'remarks', type: 'ts' },
  ]);
  const parser = new AtermParser([
    { name: 'undecided', description: 'Typed examples', viewpoint: 'spec', schema },
  ]);
  const parsed = parser.parse('typed.trm', source);
  const result: ITermDeclarationResult = {
    ...empty,
    termDeclarations: new TermDeclarationProjection().file(parsed).termDeclarations,
  };
  const text = new TermDeclarationText().render({ ...result, operation: 'show' });
  expect(text.trim()).toBe('// Knowledge: fixture\n// Viewpoint: spec\n\n' + source);
  expect(parser.parse('copy.trm', text).diagnostics).toEqual([]);
  expect(new TermDeclarationText().render({ ...result, operation: 'view' })).toBe(text);
  const withoutRemarks = new TermDeclarationText().render({
    ...result,
    includeRemarks: false,
    operation: 'show',
  });
  expect(withoutRemarks).toContain('---ts\n  interface Shape');
  expect(withoutRemarks).not.toContain('const example');
});

test('reads display the owning Viewpoint without changing Term identity or reference lists', () => {
  const parsed = new AtermParser().parse('k.trm', 'concept _Sample_ = { A sample. }\n');
  const definition = {
    ...new TermDeclarationProjection().file(parsed).termDeclarations[0]!,
    viewpoint: 'guide',
  };
  const value: ITermDeclarationResult = {
    ...empty,
    termDeclarations: [definition],
    matches: [{ termDeclaration: definition, section: 'remarks', text: 'Instructions.' }],
  };
  const output = new TermDeclarationText();
  for (const operation of ['view', 'show'] as const)
    expect(output.render({ ...value, operation })).toMatch(
      /^\/\/ Knowledge: fixture\n\/\/ Viewpoint: guide\n/,
    );
  expect(output.render({ ...value, operation: 'view' }, false, true)).toMatch(
    /^\/\/ Knowledge: fixture\n\/\/ Viewpoint: guide\n/,
  );
  expect(output.render({ ...value, operation: 'list' }).split('\n')[0]).toMatch(
    /^TERM\s+TERM KIND\s+VIEWPOINT$/,
  );
  expect(output.render({ ...value, operation: 'list' }, true).split('\n')[0]).toMatch(
    /^TERM\s+TERM KIND\s+VIEWPOINT\s+SOURCE$/,
  );
  expect(output.render({ ...value, operation: 'search' })).toContain(
    definition.id + '  ' + definition.termKind + '  guide',
  );
  expect(output.render({ ...value, operation: 'search' })).not.toContain(definition.file);
});

test('concept discovery shows identity and kind, with Relation paths opt-in', () => {
  const result: ITermDeclarationResult = {
    ...empty,
    files: ['/fixture/map.trm'],
    conceptMap: {
      selected: ['_fixture:A_'],
      terms: [
        {
          name: '_fixture:A_',
          id: '_fixture:A_',
          knowledge: 'fixture',
          termDeclarations: [
            {
              termKind: 'concept',
              viewpoint: 'spec',
              definition: 'A concept.',
              file: '/fixture/map.trm',
              line: 1,
            },
          ],
        },
        {
          name: '_fixture:B_',
          id: '_fixture:B_',
          knowledge: 'fixture',
          termDeclarations: [
            {
              termKind: 'concept',
              viewpoint: 'spec',
              definition: 'B concept.',
              file: '/fixture/map.trm',
              line: 3,
            },
          ],
        },
      ],
      relations: [
        {
          source: '_fixture:A_',
          phrase: 'names',
          target: '_fixture:B_',
          origin: 'relation',
          type: 'association',
          structural: false,
          locations: [{ file: '/fixture/map.trm', line: 5 }],
        },
      ],
    },
  };
  const output = new TermDeclarationText();
  const plain = output.render({ ...result, operation: 'overview' });
  expect(plain).toBe(
    '## Terms\n\n_fixture:A_  concept  spec  A concept.\n\n## Relations\n\n_fixture:A_ names _fixture:B_\n',
  );
  expect(plain).not.toContain('B concept.');
  expect(plain).not.toContain('/fixture');
  const located = output.render({ ...result, operation: 'overview' }, true);
  expect(located).toContain('/fixture/map.trm:5');
  expect(located).toContain('_fixture:A_  concept  spec  A concept.  // /fixture/map.trm:1');
});

test('connect prints requested identities then Relations in traversal order, using reverse arrows', () => {
  const result: ITermDeclarationResult = {
    ...empty,
    conceptMap: {
      selected: ['_fixture:Z_', '_fixture:A_'],
      terms: ['_fixture:A_', '_fixture:Middle_', '_fixture:Z_'].map((name) => ({
        name,
        id: name,
        knowledge: 'fixture',
        termDeclarations: [
          {
            termKind: 'concept',
            viewpoint: 'spec',
            definition: `${name} identity.\nSecond line.`,
            file: '/fixture/map.trm',
            line: 1,
          },
        ],
      })),
      relations: [
        {
          source: '_fixture:A_',
          phrase: 'owns',
          target: '_fixture:Middle_',
          origin: 'relation',
          type: 'association',
          structural: false,
          locations: [],
        },
        {
          source: '_fixture:Middle_',
          phrase: 'encodes',
          target: '_fixture:Z_',
          origin: 'relation',
          type: 'association',
          structural: false,
          locations: [{ file: '/fixture/map.trm', line: 9 }],
        },
      ],
      paths: [['_fixture:Z_', '_fixture:Middle_', '_fixture:A_']],
      disconnected: [],
    },
  };
  const output = new TermDeclarationText();
  expect(output.render({ ...result, operation: 'connect' })).toBe(
    '## Terms\n\n_fixture:Z_  concept  spec  _fixture:Z_ identity. Second line.\n_fixture:A_  concept  spec  _fixture:A_ identity. Second line.\n\n## Path #1\n\n_fixture:Z_ ← encodes — _fixture:Middle_\n_fixture:Middle_ ← owns — _fixture:A_\n',
  );
  expect(output.render({ ...result, operation: 'connect' }, true)).toContain(
    '_fixture:Z_ ← encodes — _fixture:Middle_  // /fixture/map.trm:9',
  );
  const multiple = {
    ...result,
    conceptMap: {
      ...result.conceptMap!,
      selected: ['_fixture:Z_', '_fixture:Middle_', '_fixture:A_'],
      paths: [
        ['_fixture:Z_', '_fixture:Middle_'],
        ['_fixture:Z_', '_fixture:Middle_', '_fixture:A_'],
        ['_fixture:Middle_', '_fixture:A_'],
      ],
      disconnected: [['_fixture:A_', '_fixture:Absent_']],
    },
  };
  expect(output.render({ ...multiple, operation: 'connect' })).toContain(
    '## Path #2: _fixture:Z_ → _fixture:A_\n\n_fixture:Z_ ← encodes — _fixture:Middle_\n_fixture:Middle_ ← owns — _fixture:A_',
  );
  expect(output.render({ ...multiple, operation: 'connect' })).toContain(
    'No path: _fixture:A_ → _fixture:Absent_',
  );
});

test('edits and diffs render their own shapes', () => {
  const output = new TermDeclarationText();
  const edit = output.render({
    dryRun: true,
    terms: ['_One_'],
    files: [{ path: 'docs/SPEC-one.trm', before: 'a\nold\nz\n', after: 'a\nnew\nz\n' }],
    derivedImpacts: [],
    warnings: ['Unresolved reference _Later_.'],
  });
  expect(edit).toContain('Preview: _One_');
  expect(edit).toContain('@@ -2,1 +2,1 @@\n-old\n+new');
  expect(edit).toContain('Warning: Unresolved reference _Later_.');
  expect(
    output.render({ dryRun: false, terms: [], files: [], derivedImpacts: [], warnings: [] }),
  ).toContain('No changes.');
  expect(output.render({ commit: 'abc', workspace: '/r', files: [], diff: '' })).toBe(
    'No Aterm changes.\n',
  );
  expect(output.render({ commit: 'abc', workspace: '/r', files: ['a'], diff: 'diff text\n' })).toBe(
    'diff text\n',
  );
});

test('field prints one section of each Term Declaration verbatim and fails when none declares it', () => {
  const guide = new AtermSchema('A guide', [
    { name: 'definition', type: 'md' },
    { name: 'body', type: 'md' },
  ]);
  const parser = new AtermParser([
    { name: 'guide', description: 'A guide', viewpoint: 'guide', schema: guide },
    {
      name: 'concept',
      description: 'A concept',
      viewpoint: 'spec',
      schema: new AtermSchema('A concept', [{ name: 'definition', type: 'md' }]),
    },
  ]);
  const parsed = parser.parse(
    'g.trm',
    'guide _G_ = {\n  A guide.\n.body\n  # Title\n\n  Read this.\n}\nconcept _C_ = { A concept. }\n',
  );
  const result: ITermDeclarationResult = {
    ...empty,
    termDeclarations: parsed.termDeclarations.map((d) =>
      new TermDeclarationProjection().termDeclaration(d, true),
    ),
  };
  const output = new TermDeclarationText();
  expect(output.field(result, 'body')).toBe('# Title\n\nRead this.\n');
  expect(output.field(result, 'definition')).toBe('A guide.\n\nA concept.\n');
  expect(() => output.field(result, 'nowhere')).toThrow(
    'No selected Term declares a section nowhere',
  );
});

test('copyable Term Declaration text retains Group paths for every supported syntax', () => {
  for (const block of ['{ One. }', '{\n  One.\n}', '```md\n  One.\n```']) {
    const parser = new AtermParser();
    const original = `concept _One_ in example.concepts = ${block}`;
    const parsed = parser.parse('group.trm', original);
    expect(parsed.diagnostics).toEqual([]);
    for (const operation of ['show', 'view'] as const) {
      const text = new TermDeclarationText().render({
        ...empty,
        operation,
        termDeclarations: new TermDeclarationProjection().file(parsed).termDeclarations,
      });
      expect(text).toContain('concept _One_ in example.concepts =');
      const copy = parser.parse('copy.trm', text);
      expect(copy.diagnostics).toEqual([]);
      expect(copy.termDeclarations[0]?.group).toBe('example.concepts');
    }
  }
});

test('list tree preserves File, Group and Term Declaration identities with canonical sibling order', () => {
  const parser = new SourceParser();
  const sources = [
    [
      'z/shared.trm',
      '@knowledge alpha\nconcept _Root_ = { Root. }\nconcept _Same_ in shell.inner = { Shape. }\nprocedure _Same_ in tasks = { Act. }',
    ],
    [
      'a/shared.trm',
      '@knowledge zeta\nconcept _Zulu_ in machine.child = { Child. }\nconcept _Alpha_ in machine = { Parent. }\nconcept _Root_ = { Root. }',
    ],
  ] as const;
  const termDeclarations = sources
    .flatMap(([file, source]) => {
      const parsed = parser.parse(file, source);
      expect(parsed.diagnostics).toEqual([]);
      return new TermDeclarationProjection().file(parsed).termDeclarations;
    })
    .reverse();
  const before = JSON.stringify(termDeclarations);
  const output = new TermDeclarationText();
  const result = { ...empty, termDeclarations };
  expect(output.render(result, false, false, true)).toBe(
    [
      'a/shared.trm — @knowledge zeta (3 Term Declarations)',
      '├── machine (2)',
      '│   ├── child (1)',
      '│   │   └── concept _Zulu_ [default]',
      '│   └── concept _Alpha_ [default]',
      '└── concept _Root_ [default]',
      '',
      'z/shared.trm — @knowledge alpha (3 Term Declarations)',
      '├── shell (1)',
      '│   └── inner (1)',
      '│       └── concept _Same_ [default]',
      '├── tasks (1)',
      '│   └── procedure _Same_ [default]',
      '└── concept _Root_ [default]',
      '',
    ].join('\n'),
  );
  expect(output.render(result, true, false, true)).toContain(
    'concept _Same_ [default]  // z/shared.trm:3',
  );
  expect(JSON.stringify(termDeclarations)).toBe(before);
  expect(output.render(empty, false, false, true)).toBe('No matches.\n');
  expect(
    output.render(
      {
        ...empty,
        derivedImpacts: [],
        warnings: [{ file: 'bad.trm', line: 1, message: 'Skipped.' }],
      },
      false,
      false,
      true,
    ),
  ).toBe('// Warning: Skipped.\nNo matches.\n');
});
