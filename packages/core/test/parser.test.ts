import { describe, expect, test } from 'vitest';
import {
  AtermParser as SourceParser,
  AtermSchema,
  TermDeclarationProjection,
  specSchema,
} from '../src/index.js';

/** Term Declaration grammar fixtures supply a real Knowledge header; positions include that header. */
class AtermParser extends SourceParser {
  override parse(file: string, text: string) {
    return super.parse(
      file,
      text.replace(/^(\uFEFF)?/, (_match, bom = '') => bom + '@knowledge fixture\n'),
    );
  }
}

/** Every Schema in these fixtures is shared by all of its kinds. */
const as = (
  schema: AtermSchema,
  names: readonly string[] = ['concept', 'procedure', 'undecided'],
) => names.map((name) => ({ name, description: name, viewpoint: 'test', schema }));

const parse = (text: string, schema = specSchema) =>
  new TermDeclarationProjection().file(new AtermParser(as(schema)).parse('sample.trm', text));

describe('Aterm declarations', () => {
  test('parses kinds and rejects removed parent syntax', () => {
    const child = parse('undecided _Child_ = ```md\n  A child.\n```');
    expect(child.diagnostics).toEqual([]);
    expect(child.termDeclarations[0]).toMatchObject({
      name: '_Child_',
      termKind: 'undecided',
      line: 2,
      endLine: 4,
    });
    for (const header of ['_X_ under _Y_, _Z_', '_X_ under', '_X_ : _Y_'])
      expect(parse(header + ' = ```md\n  Invalid.\n```').diagnostics.length).toBeGreaterThan(0);
  });
  test('retains physical source lines without trimming blank lines or nested indentation', () => {
    const lines = [
      '// Heading',
      '',
      'undecided _Sample_ = ```md',
      '',
      '  A contract.',
      '    Indented.',
      '',
      '---md',
      '',
      '  Reason.',
      '',
      '```',
    ];
    const d = parse(lines.join('\r\n')).termDeclarations[0]!;
    expect(d.endLine).toBe(13);
    expect(d.sourceLines).toEqual(lines.slice(2).map((text, i) => ({ line: i + 4, text })));
    expect(d.contractLine).toBe(9);
  });
  test('separates a Markdown Term Declaration and Contract with physical reference locations', () => {
    const result = parse(
      [
        '// The comment is not a Term Declaration.',
        'undecided _Project_ = ```md',
        '  A registered source repository.',
        '---md',
        '  _Project_Interface_ describes its sections.',
        '```',
        '',
        'undecided _Project_Interface_ = ````md',
        '  ```ts',
        '  interface Project {',
        '    id: string;',
        '  }',
        '  ```',
        '````',
      ].join('\n'),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.termDeclarations).toHaveLength(2);
    expect(result.termDeclarations[0]).toMatchObject({
      name: '_Project_',
      language: 'md',
      file: 'sample.trm',
      line: 3,
      endLine: 7,
      contractLine: 5,
      definition: 'A registered source repository.',
      contract: '_Project_Interface_ describes its sections.',
      references: [
        {
          name: '_Project_Interface_',
          id: '_fixture:Project_Interface_',
          file: 'sample.trm',
          line: 6,
          section: 'contract',
        },
      ],
    });
    expect(result.termDeclarations[1]).toMatchObject({
      language: 'md',
      definition: '```ts\ninterface Project {\n  id: string;\n}\n```',
      contract: undefined,
    });
  });
  test('keeps nested fences, ignores code references and recognizes inline references', () => {
    const result = parse(
      [
        'undecided _Project_ = ````md',
        '  Uses `_Project_Interface_`, not ordinary_variable_name or \\_Literal_.',
        '  ```ts',
        '  const example = "_Not_A_Reference_";',
        '  ```',
        '  ~~~text',
        '  _Also_Not_A_Reference_',
        '  ~~~',
        '  _Project_Interface_ applies.',
        '````',
      ].join('\n'),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.termDeclarations[0]?.references.map((ref) => ref.name)).toEqual([
      '_Project_Interface_',
      '_Project_Interface_',
    ]);
  });
  test('accepts CRLF and preserves TypeScript as opaque text', () => {
    const result = parse(
      'undecided _Interface_ = ```ts\r\n  type _Unresolved_ = string;\r\n```\r\n',
      new AtermSchema('Typed', [{ name: 'definition', type: 'ts' }]),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.termDeclarations[0]?.definition).toBe('type _Unresolved_ = string;');
    expect(result.termDeclarations[0]?.references).toEqual([]);
  });
  test('tracks Term Declaration and Contract separately, resetting their Markdown fence state', () => {
    const result = parse(
      [
        'undecided _Example_ = ````md',
        '  Uses _Contract_.',
        '  ```ts',
        '  const opaque = "_NotAReference_";',
        '---md',
        '  See _Analogy_.',
        '````',
      ].join('\n'),
    );
    expect(result.termDeclarations[0]?.references).toEqual([
      {
        name: '_Contract_',
        id: '_fixture:Contract_',
        file: 'sample.trm',
        line: 3,
        column: 8,
        section: 'definition',
      },
      {
        name: '_Analogy_',
        id: '_fixture:Analogy_',
        file: 'sample.trm',
        line: 7,
        column: 7,
        section: 'contract',
      },
    ]);
  });
  test.each([
    ['legacy def', 'def undecided _Project_ = {\n  Text\n}'],
    ['double underscore', 'undecided _Project__Interface_ = ```ts\n  type X = string;\n```'],
    ['unsupported language', 'undecided _Project_ = ```yaml\n  value: 1\n```'],
    ['missing close', 'undecided _Project_ = ```md\n  Text'],
    ['incorrect closing fence', 'undecided _Project_ = ````md\n  Text\n```'],
    ['unindented content', 'undecided _Project_ = ```md\nText\n```'],
    ['empty contract', 'undecided _Project_ = ```md\n---md\n  Only contract\n```'],
    ['extra separator', 'undecided _Project_ = ```md\n  Text\n---md\n---md\n---md\n```'],
    ['legacy separator', 'undecided _Project_ = ```md\n  Text\n--\n  Contract\n```'],
    ['outside prose', 'This is not a comment.'],
  ])('diagnoses %s', (_name, text) => {
    const result = parse(text);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({ file: 'sample.trm' });
    expect(result.diagnostics[0]!.line).toBeGreaterThan(0);
  });
  test('allows Markdown Contract after an opaque TypeScript Term Declaration', () => {
    const parsed = parse(
      'undecided _Project_Interface_ = ```ts\n  interface Project { name: string }\n---md\n  See _Project_.\n```',
      new AtermSchema('Typed identity', [
        { name: 'definition', type: 'ts' },
        { name: 'contract', type: 'md' },
        { name: 'remarks', type: 'md' },
      ]),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.termDeclarations[0]).toMatchObject({
      contract: 'See _Project_.',
      references: [{ name: '_Project_', section: 'contract', line: 5 }],
    });
  });
  test('treats code inside blockquotes and lists as opaque Markdown code', () => {
    const parsed = parse(
      'undecided _A_ = ````md\n  > ```md\n  > _NotAReference_\n  > ```\n  - Example:\n\n        _NotAReferenceEither_\n\n  Uses _B_.\n````',
    );
    expect(parsed.termDeclarations[0]?.references.map((r) => r.name)).toEqual(['_B_']);
  });
});

describe('keyed declarations', () => {
  test('resolve filetypes from Schema and retain locations and opaque code', () => {
    const schema = new AtermSchema('Fixture', [
      { name: 'definition', type: 'md' },
      { name: 'contract', type: 'ts' },
      { name: 'remarks', type: 'md' },
    ]);
    const source =
      'undecided _Term_ = {\n  Uses _Root_†.\n.contract\n  interface Term { name: "_Opaque_" }\n.remarks\n  More _Root_.\n}\n';
    const result = new AtermParser(as(schema)).parse('test.trm', source);
    expect(result.diagnostics).toEqual([]);
    expect(result.termDeclarations[0]).toMatchObject({
      name: '_Term_',
      termKind: 'undecided',
      line: 2,
      endLine: 8,
      fence: '}',
      sections: [
        { key: 'definition', filetype: 'md', line: 2, content: 'Uses _Root_†.' },
        { key: 'contract', filetype: 'ts', line: 4 },
        { key: 'remarks', filetype: 'md', line: 6 },
      ],
    });
    expect(result.termDeclarations[0]!.references.map((r) => [r.name, r.line, r.column])).toEqual([
      ['_Root_', 3, 8],
      ['_Root_', 7, 8],
    ]);
    expect(
      new TermDeclarationProjection()
        .termDeclaration(result.termDeclarations[0]!, false)
        .sourceLines?.map((l) => l.line),
    ).toEqual([2, 3, 4, 5, 8]);
  });
  test('delimiters are column-zero, keys follow Schema order, and first field is required', () => {
    for (const body of [
      '.definition ts\n  Identity.',
      '.unknown\n  Identity.',
      '.remarks\n  Identity.',
      '.definition\n  Identity.\n  Again.',
      '.definition\n  Identity.\n.remarks\n  Remark.\n.contract\n  Late.',
      '.contract\n  Contract without a definition.',
    ]) {
      const bad = new AtermParser().parse('bad.trm', 'undecided _Bad_ = {\n' + body + '\n}');
      expect(bad.diagnostics.length).toBeGreaterThan(0);
      expect(() => new TermDeclarationProjection().file(bad)).not.toThrow();
    }
    const source =
      'undecided _Good_ = {\n  Identity.\n.remarks\n  ```ts\n  }\n  .contract\n  ```\n}\n';
    expect(new AtermParser().parse('good.trm', source).diagnostics).toEqual([]);
    expect(
      new AtermParser().parse('bad.trm', 'undecided _Bad_ = {\n  Identity.').diagnostics[0]
        ?.message,
    ).toContain('Unclosed');
  });
  test('a one-line Term Declaration holds only its definition; the definition header is rejected', () => {
    const parsed = new AtermParser().parse(
      'line.trm',
      'concept _One_ = { A one-line definition of _Two_. }\nconcept _Two_ = {\n  Block.\n}\n',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.termDeclarations[0]).toMatchObject({
      name: '_One_',
      line: 2,
      endLine: 2,
      sections: [{ key: 'definition', line: 2, content: 'A one-line definition of _Two_.' }],
    });
    expect(parsed.termDeclarations[0]!.references.map((r) => [r.name, r.line])).toEqual([
      ['_Two_', 2],
    ]);
    for (const source of [
      'concept _Bad_ = {\n.definition\n  Old header.\n}',
      'concept _Bad_ = { }',
      'concept _Bad_ = { text\n.contract\n  Mixed.\n}',
    ])
      expect(new AtermParser().parse('bad.trm', source).diagnostics.length).toBeGreaterThan(0);
  });
});

describe('reserved relations section', () => {
  test('every Schema exposes the same reserved section after definition', () => {
    const schema = new AtermSchema('No contract', [
      { name: 'definition', type: 'md' },
      { name: 'notes', type: 'md' },
    ]);
    expect(schema.sections.map((s) => s.name)).toEqual(['definition', 'relations', 'notes']);
    const parsed = new AtermParser(as(schema)).parse(
      'x.trm',
      'concept _X_ = {\n  Identity.\n.relations\n  names _Other_†\n.notes\n  See _Other_.\n}',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.relations).toMatchObject([
      {
        source: '_fixture:X_',
        phrase: 'names',
        target: '_fixture:Other_',
        required: true,
        line: 5,
      },
    ]);
  });
  test('Schemas cannot redeclare the reserved section', () => {
    expect(
      () =>
        new AtermSchema('Bad', [
          { name: 'definition', type: 'md' },
          { name: 'relations', type: 'md' },
        ]),
    ).toThrow('relations');
  });
  test('relations are optional but occur once between definition and schema content', () => {
    for (const body of [
      '.relations\n  uses _Y_\n.relations\n  uses _Z_',
      '.contract\n  Rules.\n.relations\n  uses _Y_',
    ])
      expect(
        new AtermParser().parse('bad.trm', 'concept _X_ = {\n  Identity.\n' + body + '\n}')
          .diagnostics.length,
      ).toBeGreaterThan(0);
  });
});

describe('sections', () => {
  const projected = (parsed: ReturnType<AtermParser['parse']>) =>
    new TermDeclarationProjection().file(parsed).termDeclarations[0];
  test('section languages preserve TypeScript as opaque code and resume Markdown references', () => {
    const parsed = new AtermParser(
      as(
        new AtermSchema('Mixed', [
          { name: 'definition', type: 'md' },
          { name: 'contract', type: 'ts' },
          { name: 'remarks', type: 'md' },
        ]),
      ),
    ).parse(
      'typed.trm',
      [
        'undecided _Shape_ = ```md',
        '  A data shape.',
        '---ts',
        '  interface Shape { value: "_NotAReference_" }',
        '---md',
        '  See _Example_.',
        '```',
      ].join('\n'),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(projected(parsed)).toMatchObject({
      language: 'md',
      contractLanguage: 'ts',
      remarksLanguage: 'md',
      contractLine: 4,
      remarksLine: 6,
      contract: 'interface Shape { value: "_NotAReference_" }',
      references: [{ name: '_Example_', section: 'remarks', line: 7 }],
    });
  });
  test('legacy section labels match fixed Schema types; unsupported and excess separators fail', () => {
    const parser = new AtermParser(
      as(
        new AtermSchema('Mixed', [
          { name: 'definition', type: 'ts' },
          { name: 'contract', type: 'md' },
          { name: 'remarks', type: 'ts' },
        ]),
      ),
    );
    const parsed = parser.parse(
      'typed.trm',
      'undecided _A_ = ```ts\n  type A = "_Opaque_";\n---md\n  - Uses _B_.\n---ts\n  const example = "_Opaque_";\n```',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(projected(parsed)).toMatchObject({
      contractLanguage: 'md',
      remarksLanguage: 'ts',
      references: [{ name: '_B_', section: 'contract' }],
    });
    for (const separator of ['---json', '---ts\n---md\n---ts'])
      expect(
        parser.parse('bad.trm', 'undecided _A_ = ```md\n  A.\n' + separator + '\n```').diagnostics
          .length,
      ).toBeGreaterThan(0);
  });
  test('section positions are not guessed; empty Contract is allowed but empty Term Declaration is not', () => {
    const parser = new AtermParser();
    expect(
      projected(parser.parse('a', 'undecided _A_ = ```md\n  A.\n---md\n  Contract.\n```')),
    ).toMatchObject({ contract: 'Contract.', remarks: undefined });
    expect(
      projected(parser.parse('a', 'undecided _A_ = ```md\n  A.\n---md\n---md\n  Reason.\n```')),
    ).toMatchObject({ contract: '', remarks: 'Reason.' });
    expect(
      parser.parse('a', 'undecided _A_ = ```md\n---md\n  Rules.\n```').diagnostics.length,
    ).toBeGreaterThan(0);
    expect(
      parser.parse('a', 'undecided _A_ = ```md\n  A.\n---md\n---md\n---md\n```').diagnostics.length,
    ).toBeGreaterThan(0);
  });
});

describe('kinds and Relations', () => {
  test('Schema selects declaration kinds without creating separate name spaces', () => {
    const schema = new AtermSchema(
      'Fixture',
      specSchema.sections.filter((s) => s.name !== 'relations'),
    );
    const parser = new AtermParser(as(schema, ['entity', 'action']));
    expect(
      parser.parse('x.trm', 'entity _X_ = {\n  Identity.\n}').termDeclarations[0],
    ).toMatchObject({
      name: '_X_',
      termKind: 'entity',
    });
    expect(parser.parse('x.trm', 'concept _X_ = {\n  Identity.\n}').diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Term Kind') }),
      ]),
    );
  });
  test('declarations supply implicit Source and keep qualified targets and physical locations', () => {
    const result = new AtermParser().parse(
      'x.trm',
      [
        'concept _X_ = {',
        '  Identity.',
        '.relations',
        '  contains _Y_',
        '  reads _other:Z_†',
        '.contract',
        '  ```md',
        '  **Relation**: _X_ ignores _Code_',
        '  ```',
        '}',
      ].join('\n'),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.relations?.map((r) => [r.source, r.phrase, r.target, r.line])).toEqual([
      ['_fixture:X_', 'contains', '_fixture:Y_', 5],
      ['_fixture:X_', 'reads', '_other:Z_', 6],
    ]);
  });
  test('malformed declarations and legacy assertions are rejected', () => {
    for (const line of [
      '_Y_',
      '??? _Y_',
      'uses _Y_ trailing',
      'uses _Y_ and _Z_',
      '- uses _Y_',
      '_X_ uses _Y_',
    ])
      expect(
        new AtermParser().parse('x.trm', `concept _X_ = {\n  X.\n.relations\n  ${line}\n}`)
          .diagnostics.length,
      ).toBeGreaterThan(0);
    for (const section of ['definition', 'contract', 'remarks']) {
      const body = section === 'definition' ? '' : `Identity.\n.${section}\n  `;
      expect(
        new AtermParser().parse('x.trm', `concept _X_ = {\n  ${body}**Relation**: _X_ uses _Y_\n}`)
          .diagnostics.length,
      ).toBeGreaterThan(0);
    }
  });
  test('dagger annotates an immediate reference occurrence, never its name or opaque code', () => {
    const block = (name: string, body: string) =>
      `undecided ${name} = \`\`\`\`md\n  ${body}\n\`\`\`\`\n`;
    const parsed = new AtermParser(
      as(
        new AtermSchema('Mixed', [
          { name: 'definition', type: 'md' },
          { name: 'contract', type: 'ts' },
          { name: 'remarks', type: 'md' },
        ]),
      ),
    ).parse(
      'sample.trm',
      block(
        '_Root_',
        [
          '_A_†, _A_, _A_ †, `_B_†`, \\_Escaped_†, prefix_A_†.',
          '  ```md',
          '  _Fenced_†',
          '  ```',
          '---ts',
          '  type T = "_Typed_†";',
          '---md',
          '  _Remark_†',
        ].join('\n'),
      ),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.termDeclarations[0]?.references.map((r) => r.column)).toEqual([3, 9, 14, 22, 3]);
    expect(
      parsed.termDeclarations[0]?.references.map(({ column, ...reference }) => reference),
    ).toEqual([
      {
        name: '_A_',
        id: '_fixture:A_',
        file: 'sample.trm',
        line: 3,
        section: 'definition',
        required: true,
      },
      { name: '_A_', id: '_fixture:A_', file: 'sample.trm', line: 3, section: 'definition' },
      { name: '_A_', id: '_fixture:A_', file: 'sample.trm', line: 3, section: 'definition' },
      {
        name: '_B_',
        id: '_fixture:B_',
        file: 'sample.trm',
        line: 3,
        section: 'definition',
        required: true,
      },
      {
        name: '_Remark_',
        id: '_fixture:Remark_',
        file: 'sample.trm',
        line: 10,
        section: 'remarks',
        required: true,
      },
    ]);
  });
});

test('Knowledge scope preserves Markdown and physical bounds without shifting Term Declaration source', () => {
  const result = new AtermParser().parse(
    'scope.trm',
    [
      '\uFEFF// Title',
      '@viewpoints specification',
      '@scope {',
      '  Observable behavior.',
      '',
      '  - Include defaults.',
      '    Preserve nested Markdown.',
      '}',
      'concept _A_ = { A thing. }',
    ].join('\r\n'),
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.scope).toEqual({
    content: 'Observable behavior.\n\n- Include defaults.\n  Preserve nested Markdown.',
    line: 4,
    endLine: 9,
  });
  expect(result.termDeclarations[0]).toMatchObject({ line: 10, endLine: 10, scope: result.scope });
});

test.each([
  '@viewpoints specification\n@scope {\n}\n',
  '@viewpoints specification\n@scope { inline }\n',
  '@viewpoints specification\n@scope {\n Missing indentation.\n}\n',
  '@viewpoints specification\n@scope {\n  Missing close.\n',
  '@scope {\n  Before viewpoints.\n}\n@viewpoints specification\n',
  '@viewpoints specification\nconcept _A_ = { A. }\n@scope {\n  Too late.\n}\n',
  '@viewpoints specification\n@scope {\n  One.\n}\n@scope {\n  Two.\n}\n',
])('refuses malformed or misplaced scope: %s', (source) => {
  expect(new AtermParser().parse('scope.trm', source).diagnostics.length).toBeGreaterThan(0);
});

test('a reference records the column it occupies in its own source line, one-line Term Declarations included', () => {
  const result = new AtermParser(as(specSchema)).parse(
    'sample.trm',
    ['concept _Inline_ = { Uses _Root_ once. }', 'concept _Root_ = { A root. }'].join('\n'),
  );
  const [reference] = result.termDeclarations[0]!.references;
  expect([reference!.line, reference!.column]).toEqual([2, 27]);
  // The column addresses the physical line, so a rename can replace the token in place.
  expect(
    'concept _Inline_ = { Uses _Root_ once. }'.slice(
      reference!.column! - 1,
      reference!.column! - 1 + reference!.name.length,
    ),
  ).toBe('_Root_');
});

test('Term Declaration Group paths survive block, inline and legacy parsing without changing identity', () => {
  for (const [termKind, body] of [
    ['concept', '{\n  Identity.\n}'],
    ['procedure', '{ Identity. }'],
    ['undecided', '```md\n  Identity.\n```'],
  ]) {
    const result = parse(`${termKind} _Run_Test_ in test.procedures = ${body}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.termDeclarations[0]).toMatchObject({
      id: '_fixture:Run_Test_',
      group: 'test.procedures',
      termKind,
    });
  }
  expect(parse('concept _Run_Test_ = { Identity. }').termDeclarations[0]).not.toHaveProperty(
    'group',
  );
});

test.each([
  'Test',
  'test..procedures',
  '.test',
  'test.',
  'test/procedures',
  'test-procedures',
  'test procedures',
  '',
])('rejects invalid Group path %s', (group) => {
  expect(parse(`concept _Test_ in ${group} = { Identity. }`).diagnostics[0]?.message).toContain(
    'group.path',
  );
});

// Exercise the reader boundaries through the public Parser, not private helpers.
test('duplicate metadata is consumed without replacing the first value or leaking state to another parse', () => {
  const parser = new SourceParser();
  const result = parser.parse(
    'first.trm',
    [
      '@knowledge first',
      '@viewpoints specification',
      '@scope {',
      '  First scope.',
      '}',
      '@scope {',
      '  Discarded scope.',
      '}',
      'concept _One_ = { A declaration. }',
    ].join('\n'),
  );
  expect(result.scope?.content).toBe('First scope.');
  expect(result.termDeclarations.map((d) => [d.id, d.line, d.endLine])).toEqual([
    ['_first:One_', 9, 9],
  ]);
  expect(result.diagnostics.map((d) => d.message)).toEqual(['A Knowledge declares @scope once.']);
  const next = parser.parse(
    'next.trm',
    '@knowledge next\n@viewpoints specification\nconcept _Two_ = { Another declaration. }',
  );
  expect(next.scope).toBeUndefined();
  expect(next.termDeclarations[0]).toMatchObject({ id: '_next:Two_', line: 3, endLine: 3 });
  expect(next.diagnostics).toEqual([]);
});

test('section interpretation preserves diagnostic phase order and physical Reference coordinates', () => {
  const schema = new AtermSchema('Mixed content', [
    { name: 'definition', type: 'md' },
    { name: 'data', type: 'json' },
    { name: 'notes', type: 'md' },
  ]);
  const result = new SourceParser(as(schema)).parse(
    'mixed.trm',
    [
      '@knowledge mixed',
      '@viewpoints test',
      'concept _One_ = {',
      '  **Relation**: legacy marker.',
      '.data',
      '  {broken',
      '.notes',
      '  Prefix _Two_.definition†',
      '}',
      'concept _Two_ = { Target. }',
    ].join('\n'),
  );
  expect(result.diagnostics.map((d) => d.message)).toEqual([
    expect.stringContaining('Legacy **Relation** declaration'),
    expect.stringContaining('Invalid json section data'),
    expect.stringContaining('Section expansion must occupy a line by itself'),
  ]);
  expect(result.termDeclarations[0]?.references).toEqual([
    expect.objectContaining({
      name: '_Two_',
      id: '_mixed:Two_',
      section: 'notes',
      line: 8,
      column: 10,
      required: true,
      targetSection: 'definition',
    }),
  ]);
});
