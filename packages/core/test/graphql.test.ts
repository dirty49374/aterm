import { expect, test } from 'vitest';
import { getIntrospectionQuery } from 'graphql';
import { AtermApplication, atermQuery, type AtermQuery } from '../src/index.js';
import { fixture, type IFixture } from './fixture.js';

const knowledgeSource = `@knowledge sample
@viewpoints spec
@description {
  A small machine.
}
@scope {
  Its observable behavior.
}
concept _Machine_ = {
  A machine using _Motor_.
.relations
  has_part _Motor_†
  reads _Sensor_
.contract
  Keep _Motor_ available.
}
concept _Motor_ = { A motor. }
concept _Sensor_ = { A sensor. }
`;
async function setup() {
  const f = await fixture();
  await f.write('docs/sample.trm', knowledgeSource);
  return f;
}
async function query(
  f: IFixture | AtermApplication,
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string,
) {
  const app = f instanceof AtermApplication ? f : await f.app();
  const result = await app.query({
    operation: 'graphql',
    graphql: { query, variables, operationName },
  });
  if (!('operation' in result) || result.operation !== 'graphql')
    throw new Error('Expected GraphQL.');
  return JSON.parse(JSON.stringify(result.response));
}

test('GraphQL selects requested fields from the single Term Declaration of a Term', async () => {
  const f = await setup();
  const result = await query(
    f,
    `{ term(id: "_sample:Machine_") {
    id termDeclarations { termKind { qualifiedName } definition }
  } }`,
  );
  expect(result).toEqual({
    data: {
      term: {
        id: '_sample:Machine_',
        termDeclarations: [
          { termKind: { qualifiedName: 'spec.concept' }, definition: 'A machine using _Motor_.' },
        ],
      },
    },
  });
});

test('GraphQL exposes canonical Term Declaration and Term Kind names without former aliases', async () => {
  const f = await setup();
  const result = await query(
    f,
    `{
    declaration: __type(name: "TermDeclaration") { fields { name } }
    termKind: __type(name: "TermKind") { name }
    formerDeclaration: __type(name: "Entry") { name }
    formerKind: __type(name: "Kind") { name }
  }`,
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.termKind.name).toBe('TermKind');
  expect(result.data.declaration.fields.map((field: { name: string }) => field.name)).toContain(
    'termKind',
  );
  expect(result.data.formerDeclaration).toBeNull();
  expect(result.data.formerKind).toBeNull();
  for (const document of [
    '{ term(id: "_sample:Machine_") { entries { id } } }',
    '{ term(id: "_sample:Machine_") { termDeclarations { kind { name } } } }',
    '{ terms(kind: "concept") { totalCount } }',
    '{ viewpoints(knowledge: "sample") { kinds { name } } }',
  ]) {
    const refused = await query(f, document);
    expect(refused.data).toBeUndefined();
    expect(refused.errors).toBeDefined();
  }
});

test('structured corpus and vocabulary results use the same canonical property names', async () => {
  const f = await setup();
  const app = await f.app();
  for (const request of [
    { operation: 'list' },
    { operation: 'search', searchText: 'motor' },
    { operation: 'knowledge-list' },
    { operation: 'overview', termPatterns: ['*'] },
    { operation: 'viewpoint', viewpoints: ['spec'] },
  ] satisfies AtermQuery[]) {
    const result = JSON.parse(JSON.stringify(await app.query(request)));
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        expect(['entry', 'entries', 'entryCount', 'kind', 'kinds']).not.toContain(key);
        check(child);
      }
    };
    check(result);
    if (request.operation === 'list')
      expect(result.termDeclarations[0]).toMatchObject({
        id: '_sample:Machine_',
        termKind: 'concept',
      });
    if (request.operation === 'search') {
      expect(result.matches[0].termDeclaration).toMatchObject({ termKind: 'concept' });
      expect(result.matches[0]).not.toHaveProperty('definition');
    }
    if (request.operation === 'knowledge-list')
      expect(result.knowledges[0].termDeclarationCount).toBe(3);
    if (request.operation === 'viewpoint')
      expect(result.viewpoints[0].termKinds[0].name).toBe('concept');
  }
});

test('Term and Term Declaration relations describe the same declaration and required marker', async () => {
  const f = await setup();
  const result = await query(
    f,
    `{ term(id: "_Machine_") {
    outgoing(origin: relation) { nodes { phrase required locations { line } } }
    termDeclarations { termKind { name } outgoing(origin: relation) { nodes { phrase required target { id } locations { line } } } }
  } }`,
  );
  expect(result.errors).toBeUndefined();
  const term = result.data.term;
  expect(term.outgoing.nodes).toHaveLength(2);
  expect(term.outgoing.nodes[0]).toMatchObject({ phrase: 'has_part', required: true });
  expect(term.outgoing.nodes[0].locations).toHaveLength(1);
  expect(term.termDeclarations).toHaveLength(1);
  expect(term.termDeclarations[0].outgoing.nodes).toEqual([
    {
      phrase: 'has_part',
      required: true,
      target: { id: '_sample:Motor_' },
      locations: [{ line: 12 }],
    },
    {
      phrase: 'reads',
      required: false,
      target: { id: '_sample:Sensor_' },
      locations: [{ line: 13 }],
    },
  ]);
  const incoming = await query(
    f,
    `{ term(id: "_Motor_") {
    incoming(origin: relation, structural: true) { nodes { source { id } type } }
    incomingReferences: incoming(origin: reference) { nodes { section phrase } }
  } }`,
  );
  expect(incoming.data.term.incoming.nodes).toEqual([
    { source: { id: '_sample:Machine_' }, type: 'parthood' },
  ]);
  expect(incoming.data.term.incomingReferences.nodes).toEqual([
    { section: 'definition', phrase: 'references' },
    { section: 'contract', phrase: 'references' },
  ]);
  const filtered = await query(
    f,
    '{ term(id: "_Machine_") { termDeclarations(viewpoint: "sp*") { termKind { name } } outgoing(phrase: "has_*", origin: relation) { nodes { phrase } } } }',
  );
  expect(filtered.errors).toBeUndefined();
  expect(filtered.data.term.termDeclarations).toHaveLength(1);
  expect(filtered.data.term.outgoing.nodes).toEqual([{ phrase: 'has_part' }]);
  expect(
    (await query(f, '{ terms(viewpoint: "absent*") { totalCount } }')).data.terms.totalCount,
  ).toBe(0);
});

test('variables, aliases, fragments and operation selection use standard GraphQL semantics', async () => {
  const f = await setup();
  const source = `query First { term(id: "_Sensor_") { id } }
    query Selected($id: ID!, $include: Boolean!) { subject: term(id: $id) { ...Identity termDeclarations @include(if: $include) { definition } } }
    fragment Identity on Term { id name }`;
  expect(await query(f, source, { id: '_Machine_', include: false }, 'Selected')).toEqual({
    data: { subject: { id: '_sample:Machine_', name: '_Machine_' } },
  });
  expect((await query(f, source)).errors).toBeDefined();
  expect((await query(f, source, { include: true }, 'Selected')).errors).toBeDefined();
  expect((await query(f, '{ unknown }')).errors[0].message).toContain('Cannot query field');
  expect((await query(f, '{')).errors[0].message).toContain('Syntax Error');
  expect((await query(f, '{ ...Missing }')).errors[0].message).toContain('Unknown fragment');
  expect(
    (await query(f, '{ ...Loop } fragment Loop on Query { ...Loop }')).errors[0].message,
  ).toContain('cycle');
});

test('same-named Home and package Viewpoints retain independent schema bindings', async () => {
  const f = await fixture(`useDefaultKnowledge: true
sources: [docs]
viewpoints:
  specification: ./viewpoint-specification.md
`);
  await f.write(
    '.aterm/viewpoint-specification.md',
    `---
name: specification
description: Home vocabulary.
termKinds:
  - name: concept
    description: Home concept.
    sections:
      - name: definition
        type: md
      - name: custom
        type: json
---
`,
  );
  await f.write(
    'docs/project.trm',
    '@knowledge project\n@viewpoints specification\nconcept _Custom_ = {\n  A Home concept.\n.custom\n  {"value": 1}\n}\n',
  );
  const result = await query(
    f,
    `{
    home: term(id: "_project:Custom_") { termDeclarations { termKind { qualifiedName sections { key } } } }
    packaged: term(id: "_aterm:HTTP_Server_") { termDeclarations { termKind { qualifiedName sections { key } } } }
  }`,
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.home.termDeclarations[0].termKind.qualifiedName).toBe('specification.concept');
  expect(result.data.packaged.termDeclarations[0].termKind.qualifiedName).toBe(
    'specification.concept',
  );
  expect(result.data.home.termDeclarations[0].termKind.sections).toContainEqual({ key: 'custom' });
  expect(result.data.packaged.termDeclarations[0].termKind.sections).not.toContainEqual({
    key: 'custom',
  });
  expect(result.data.packaged.termDeclarations[0].termKind.sections).toContainEqual({
    key: 'contract',
  });
});

test('connections paginate canonical order and reject stale, malformed or differently filtered cursors', async () => {
  const f = await setup();
  const source = `query($after: String) { terms(first: 1, after: $after) { nodes { id } totalCount pageInfo { endCursor hasNextPage } } }`;
  const first = await query(f, source);
  expect(first.data.terms.nodes).toEqual([{ id: '_sample:Machine_' }]);
  expect(first.data.terms).toMatchObject({ totalCount: 3, pageInfo: { hasNextPage: true } });
  const cursor = first.data.terms.pageInfo.endCursor;
  expect((await query(f, source, { after: cursor })).data.terms.nodes).toEqual([
    { id: '_sample:Motor_' },
  ]);
  const wrongCollection = await query(
    f,
    `query($c: String) { terms(termKind: "spec.concept", after: $c) { nodes { id } } }`,
    { c: cursor },
  );
  expect(wrongCollection.errors[0].message).toContain('cursor');
  expect((await query(f, source, { after: 'garbage' })).errors[0].message).toContain('cursor');
  await f.write('docs/sample.trm', knowledgeSource.replace('A motor.', 'A changed motor.'));
  expect((await query(f, source, { after: cursor })).errors[0].message).toContain('stale');
  for (const first of [0, -1, 101])
    expect(
      (await query(f, `{ terms(first: ${first}) { totalCount } }`)).errors[0].message,
    ).toContain('1 and 100');
});

test('Knowledge metadata and vocabulary have their own context, including empty Knowledges', async () => {
  const f = await setup();
  await f.write('docs/empty.trm', '@knowledge empty\n@viewpoints other\n');
  const result = await query(
    f,
    `{ knowledges { nodes { id description scope readOnly terms { totalCount } viewpoints { nodes { name termKinds { nodes { qualifiedName sections { key format } } } } } } } }`,
  );
  expect(result.errors).toBeUndefined();
  expect(result.data.knowledges.nodes.map((node: { id: string }) => node.id)).toEqual([
    'empty',
    'sample',
  ]);
  expect(result.data.knowledges.nodes[0].terms.totalCount).toBe(0);
  expect(result.data.knowledges.nodes[1]).toMatchObject({
    description: 'A small machine.',
    scope: 'Its observable behavior.',
    readOnly: false,
  });
  expect(result.data.knowledges.nodes[0].viewpoints.nodes[0]).toMatchObject({
    name: 'other',
    termKinds: {
      nodes: [
        { qualifiedName: 'other.concept' },
        { qualifiedName: 'other.procedure' },
        { qualifiedName: 'other.undecided' },
      ],
    },
  });
});

test('filters use canonical identity, whole-name globs and literal search without picking ambiguous Terms', async () => {
  const f = await setup();
  await f.write(
    'docs/other.trm',
    '@knowledge other\n@viewpoints other\nconcept _Machine_ = { Another machine. }\n',
  );
  const ambiguity = (await query(f, '{ term(id: "_Machine_") { id } }')).errors[0];
  expect(ambiguity.message).toContain('Ambiguous');
  expect(ambiguity.extensions.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
    '_other:Machine_',
    '_sample:Machine_',
  ]);
  expect(
    (await query(f, '{ terms(match: "_Machine_", termKind: "spec.procedure") { totalCount } }'))
      .errors[0].message,
  ).toContain('Ambiguous');
  const result = await query(
    f,
    '{ terms(knowledge: "sample", match: "_M*_", termKind: "spec.concept", text: "motor") { nodes { id } } }',
  );
  expect(result.data.terms.nodes).toEqual([{ id: '_sample:Machine_' }, { id: '_sample:Motor_' }]);
  for (const args of [
    'knowledge: "missing"',
    'termKind: "missing"',
    'viewpoint: "missing"',
    'match: "_Missing_"',
    'text: ""',
  ])
    expect((await query(f, `{ terms(${args}) { totalCount } }`)).errors).toBeDefined();
});

test('JSON sections remain raw authored content and missing section keys are refused', async () => {
  const f = await setup();
  await f.write(
    '.aterm/viewpoint-spec.md',
    `---
name: spec
description: Structured vocabulary.
termKinds:
  - name: concept
    description: Thing.
    sections:
      - name: definition
        type: md
      - name: booking
        type: json
---
`,
  );
  await f.write(
    'docs/sample.trm',
    `@knowledge sample
@viewpoints spec
concept _Stay_ = {
  A stay.
.booking
  {"price": 100, "status": "reserved"}
}
`,
  );
  expect(
    await query(
      f,
      '{ term(id: "_Stay_") { termDeclarations { sections(keys: ["booking"]) { key format content } } } }',
    ),
  ).toEqual({
    data: {
      term: {
        termDeclarations: [
          {
            sections: [
              { key: 'booking', format: 'json', content: '{"price": 100, "status": "reserved"}' },
            ],
          },
        ],
      },
    },
  });
  expect(
    (
      await query(
        f,
        '{ term(id: "_Stay_") { termDeclarations { sections(keys: ["missing"]) { content } } } }',
      )
    ).errors,
  ).toBeDefined();
});

test('introspection is usable while writes and unsafe shapes are refused', async () => {
  const f = await setup();
  const schema = await query(f, getIntrospectionQuery());
  expect(schema.errors).toBeUndefined();
  expect(schema.data.__schema.queryType.name).toBe('Query');
  expect(schema.data.__schema.mutationType).toBeNull();
  expect((await query(f, 'mutation { __typename }')).errors[0].message).toContain(
    'Only GraphQL queries',
  );
  expect((await query(f, 'subscription { __typename }')).errors).toBeDefined();
  expect(atermQuery.safeParse({ operation: 'graphql' }).success).toBe(false);
  expect(
    atermQuery.safeParse({
      operation: 'graphql',
      graphql: { query: '{__typename}' },
      knowledge: 'sample',
    }).success,
  ).toBe(false);
});

test('depth, expanded fragments, variables and output work are bounded without partial success', async () => {
  const f = await setup();
  const deep =
    '{ term(id: "_Machine_") { ' +
    'termDeclarations { term { '.repeat(9) +
    'id' +
    ' } }'.repeat(9) +
    ' } }';
  expect((await query(f, deep)).errors[0].extensions.code).toBe('graphql.limit');
  const fragment =
    '{' +
    Array.from({ length: 400 }, (_, i) => `t${i}: term(id: "_Machine_") { ...T }`).join('\n') +
    '} fragment T on Term { id name }';
  expect((await query(f, fragment)).errors[0].message).toContain('selection count');
  expect(
    (await query(f, '{ __typename }', { huge: 'x'.repeat(65537) })).errors[0].extensions.code,
  ).toBe('graphql.limit');
  const recursive =
    '{ terms(first: 100) { nodes { ' +
    'termDeclarations { term { '.repeat(6) +
    'id' +
    ' } }'.repeat(6) +
    ' } } }';
  // Repeated aliases multiply execution work while staying below the static limit.
  const many =
    '{' + Array.from({ length: 40 }, (_, i) => `a${i}: ${recursive.slice(1, -1)}`).join(' ') + '}';
  await f.write(
    'docs/sample.trm',
    knowledgeSource +
      Array.from({ length: 25 }, (_, i) => `concept _Extra_${i}_ = { Extra. }\n`).join(''),
  );
  const limited = await query(f, many);
  expect(limited.data).toBeUndefined();
  expect(limited.errors[0].extensions.code).toBe('graphql.limit');
  await f.write(
    'docs/sample.trm',
    '@knowledge sample\n@viewpoints spec\nconcept _Large_ = {\n  ' + 'x'.repeat(1050000) + '\n}\n',
  );
  const large = await query(
    f,
    '{ terms { nodes { termDeclarations { a: definition b: definition } } } }',
  );
  expect(large.data).toBeUndefined();
  expect(large.errors[0].message).toContain('2 MiB');
});

test('invalid corpus refuses GraphQL reads and a captured application retains its snapshot', async () => {
  const f = await setup();
  const app = await f.app();
  const captured = new AtermApplication(app.config, await app.scan());
  await f.write('docs/sample.trm', knowledgeSource.replace('A motor.', 'Changed.'));
  const source = '{ term(id: "_Motor_") { termDeclarations { definition } } }';
  expect((await query(captured, source)).data.term.termDeclarations[0].definition).toBe('A motor.');
  expect((await query(f, source)).data.term.termDeclarations[0].definition).toBe('Changed.');
  await f.write(
    'docs/sample.trm',
    knowledgeSource.replace('has_part _Motor_', 'has_part _Missing_'),
  );
  const invalid = await query(f, '{ __typename }');
  expect(invalid.data).toBeUndefined();
  expect(invalid.errors[0].extensions.code).toBe('aterm.invalid');
});
