import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermServer, type AtermQuery } from '../src/index.js';
import { fixture } from './fixture.js';
import { serverProtocol } from '../src/server-module/protocol.js';

async function setup() {
  const f = await fixture();
  await f.write(
    'docs/SPEC-data.trm',
    `@knowledge sample
@viewpoints spec
concept _Root_ = {
  Alpha literal [value].
.relations
  Contains _Child_
.contract
  Read _Child_.
}
concept _Child_ = { alpha child. }
`,
  );
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  await f.write('.aterm/aterm.yaml', config + '\nexternalSources: { code: "src/**/*.ts" }\n');
  await f.write('src/ref.ts', '// 😀 Alpha [value]\n// alpha\n// _sample:Root_ _SAMPLE:root_\n');
  return f;
}

test('all Term read selectors, Knowledge and graph filters default to insensitive matching', async () => {
  const f = await setup();
  for (const operation of ['list', 'show', 'view'] as const) {
    const result = await f.read({ operation, termPatterns: ['_root_'], knowledge: 'SAMPLE' });
    expect(result.termDeclarations.map((term) => term.id)).toEqual(['_sample:Root_']);
    await expect(
      f.read({ operation, termPatterns: ['_root_'], caseSensitive: true }),
    ).rejects.toThrow('Unknown Term');
    expect(
      (await f.read({ operation, termPatterns: ['_ROOT*'], caseSensitive: true })).termDeclarations,
    ).toEqual([]);
  }
  expect(
    (await f.read({ operation: 'list', viewpoints: ['SPEC'], excludeViewpoints: ['sPe*'] }))
      .termDeclarations,
  ).toEqual([]);
  await expect(
    f.read({ operation: 'list', viewpoints: ['SPEC'], caseSensitive: true }),
  ).rejects.toThrow('Unknown Viewpoint');
  const relations = {
    operation: 'relations' as const,
    termPatterns: ['_root_'],
    relationPhrases: ['contains'],
  };
  expect((await f.read(relations)).relations).toMatchObject([
    { source: '_sample:Root_', phrase: 'Contains', target: '_sample:Child_' },
  ]);
  expect(
    (await f.read({ ...relations, termPatterns: ['_Root_'], caseSensitive: true })).relations,
  ).toEqual([]);
  expect(
    (await f.read({ operation: 'path', from: '_ROOT_', to: '_child_', knowledge: 'SAMPLE' })).paths,
  ).toEqual([['_sample:Root_', '_sample:Child_']]);
  expect(
    (await f.read({ operation: 'list', roots: ['_root_'], knowledge: 'SAMPLE' })).termDeclarations,
  ).toEqual([]);
  expect(
    (await f.read({ operation: 'list', roots: ['_roo*'], knowledge: 'SAMPLE' })).termDeclarations,
  ).toEqual([]);
  expect(
    (await f.read({ operation: 'overview', termPatterns: ['_roo*'] })).conceptMap?.selected,
  ).toEqual(['_sample:Root_']);
  expect(
    (await f.read({ operation: 'connect', termPatterns: ['_ROOT_', '_child_'] })).conceptMap
      ?.selected,
  ).toEqual(['_sample:Root_', '_sample:Child_']);
  expect(
    (await f.read({ operation: 'check', roots: ['_root_'], knowledge: 'SAMPLE' })).diagnostics,
  ).toEqual([]);
  const overview = await f.read({ operation: 'overview', files: ['DOCS/spec-DATA.TRM'] });
  expect(overview.conceptMap?.selected).toHaveLength(2);
  await expect(
    f.read({ operation: 'overview', files: ['DOCS/spec-DATA.TRM'], caseSensitive: true }),
  ).rejects.toThrow('Unknown Aterm file');
});

test('literal search and grep share query case mode while retaining source spelling and UTF-16 columns', async () => {
  const f = await setup();
  const insensitive = await f.read({ operation: 'search', searchText: 'ALPHA' });
  expect(insensitive.matches).toHaveLength(2);
  expect(insensitive.externalMatches).toHaveLength(2);
  const sensitive = await f.read({ operation: 'search', searchText: 'Alpha', caseSensitive: true });
  expect(sensitive.matches).toHaveLength(1);
  expect(sensitive.externalMatches).toMatchObject([{ text: '// 😀 Alpha [value]', column: 7 }]);
  expect(
    (await f.read({ operation: 'search', searchText: '[VALUE]' })).externalMatches,
  ).toHaveLength(1);
  expect(
    (await f.read({ operation: 'search', searchText: '[VALUE]', caseSensitive: true }))
      .externalMatches,
  ).toEqual([]);
  expect(
    (await f.read({ operation: 'grep', referencePattern: '_root_' })).externalOccurrences?.map(
      (item) => item.term,
    ),
  ).toEqual(['_sample:Root_', '_SAMPLE:root_']);
  expect(
    (
      await f.read({ operation: 'grep', referencePattern: '_Root_', caseSensitive: true })
    ).externalOccurrences?.map((item) => item.term),
  ).toEqual(['_sample:Root_']);
});

test('case-only distinct Terms remain distinct and exact insensitive selectors report all candidates', async () => {
  const f = await setup();
  const path = join(f.docs, 'SPEC-data.trm');
  const original = (await readFile(path, 'utf8')) + '\nconcept _ROOT_ = { A distinct subject. }\n';
  await f.write('docs/SPEC-data.trm', original);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  for (const selector of ['_Root_', '_root_', '_SAMPLE:ROOT_']) {
    const result = await f.read({ operation: 'view', termPatterns: [selector] });
    expect(result.ambiguity?.candidates.map((item) => item.id)).toEqual([
      '_sample:ROOT_',
      '_sample:Root_',
    ]);
    expect(result.termDeclarations).toEqual([]);
  }
  expect(
    (await f.read({ operation: 'list', termPatterns: ['_root*'] })).termDeclarations,
  ).toHaveLength(2);
  expect(
    (
      await f.read({ operation: 'view', termPatterns: ['_Root_'], caseSensitive: true })
    ).termDeclarations.map((item) => item.id),
  ).toEqual(['_sample:Root_']);
  await expect(f.author({ operation: 'rename', from: '_root_', to: '_Changed_' })).rejects.toThrow(
    'Unknown Term',
  );
  await expect(
    f.author({ operation: 'rename', from: '_Root_', to: '_Changed_', caseSensitive: false }),
  ).rejects.toThrow('does not accept caseSensitive');
  expect(await readFile(path, 'utf8')).toBe(original);
});

test('Knowledge, Viewpoint and lexical discovery selectors use the same case setting', async () => {
  const f = await setup();
  const app = await f.app();
  expect(await app.query({ operation: 'knowledge-view', knowledgeIds: ['SAMPLE'] })).toMatchObject({
    knowledges: [{ id: 'sample' }],
  });
  await expect(
    app.query({ operation: 'knowledge-view', knowledgeIds: ['SAMPLE'], caseSensitive: true }),
  ).rejects.toThrow('Unknown Knowledge');
  expect(await app.query({ operation: 'viewpoint', viewpoints: ['SPEC'] })).toMatchObject({
    viewpoints: [{ name: 'spec' }],
  });
  const discovery = {
    operation: 'discover' as const,
    question: 'Alpha',
    searchMode: 'lexical' as const,
    searchSections: ['DEFINITION'],
  };
  expect(await app.query(discovery)).toMatchObject({
    totalCandidates: 2,
    searchSections: ['definition'],
  });
  expect(
    await app.query({ ...discovery, searchSections: ['definition'], caseSensitive: true }),
  ).toMatchObject({ totalCandidates: 1, candidates: [{ id: '_sample:Root_' }] });
  await expect(app.query({ ...discovery, caseSensitive: true })).rejects.toThrow(
    'Unknown search section',
  );
});

test('Skill selectors preserve canonical output', async () => {
  const f = await fixture('sources: [docs]\nviewpoints:\n  skill: ./skill.md\n');
  await f.write(
    '.aterm/skill.md',
    await readFile(new URL('../viewpoints/skill.md', import.meta.url), 'utf8'),
  );
  await f.write(
    'docs/trial.trm',
    `@knowledge trial
@viewpoints skill
skill _Reading_Skill_ = {
  A reading Skill.
.description
  Use for reading.
.body
  Read the source.
.reminder
  Read again when needed.
}
`,
  );
  const app = await f.app();
  for (const operation of ['skill-toc', 'skill-view', 'skill-remind'] as const) {
    expect(
      await app.query({ operation, skillTerms: ['_READING_SKILL_'], knowledge: 'TRIAL' }),
    ).toMatchObject({ skills: [{ term: '_trial:Reading_Skill_' }] });
    await expect(
      app.query({ operation, skillTerms: ['_reading_skill_'], caseSensitive: true }),
    ).rejects.toThrow('unknown');
  }
}, 10000);

test('GraphQL case arguments cover lookup, filters, sections, relations and pagination scope', async () => {
  const app = await (await setup()).app();
  const read = async (document: string, caseSensitive?: boolean) => {
    const result = await app.query({
      operation: 'graphql',
      graphql: { query: document },
      caseSensitive,
    });
    if (!('response' in result)) throw new Error('Expected GraphQL.');
    return result.response as any;
  };
  const document = `{ term(id: "_SAMPLE:root_") { id termDeclarations(termKind: "SPEC.CONCEPT", viewpoint: "SPEC") { sections(keys: ["DEFINITION"]) { key } } outgoing(phrase: "contains", type: "ASSOCIATION") { totalCount } } }`;
  const result = await read(document);
  expect(result.errors).toBeUndefined();
  expect(result.data.term.id).toBe('_sample:Root_');
  expect(result.data.term.termDeclarations[0].sections).toEqual([{ key: 'definition' }]);
  expect(result.data.term.outgoing.totalCount).toBe(1);
  expect(
    (await read('{ term(id: "_Root_") { outgoing(phrase: "contains") { totalCount } } }')).data.term
      .outgoing.totalCount,
  ).toBe(1);
  expect(
    (
      await read(
        '{ term(id: "_Root_") { outgoing(phrase: "contains", caseSensitive: true) { totalCount } } }',
      )
    ).data.term.outgoing.totalCount,
  ).toBe(0);
  expect((await read(document, true)).errors).toBeDefined();
  expect((await read('{ term(id: "_root_", caseSensitive: true) { id } }')).errors).toBeDefined();
  expect(
    (await read('{ knowledge(id: "SAMPLE") { id } terms(text: "ALPHA") { totalCount } }')).data,
  ).toMatchObject({ knowledge: { id: 'sample' }, terms: { totalCount: 2 } });
  expect(
    (await read('{ terms(text: "ALPHA", caseSensitive: true) { totalCount } }')).data.terms
      .totalCount,
  ).toBe(0);
  const first = await read('{ terms(first: 1) { pageInfo { endCursor } } }');
  expect(
    (
      await read(
        `{ terms(first: 1, after: ${JSON.stringify(first.data.terms.pageInfo.endCursor)}, caseSensitive: true) { totalCount } }`,
      )
    ).errors[0].message,
  ).toContain('cursor');
});

test('HTTP dispatch and GraphQL expose both case modes without changing the published corpus', async () => {
  const f = await setup();
  const app = await f.app();
  // Use an available fixed port so server.url and Host validation agree.
  const { createServer } = await import('node:net');
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const listening = new AtermServer({
    ...app.config,
    server: { port, host: '127.0.0.1', debounceMs: 10, watchExternal: true },
  });
  await listening.start();
  try {
    for (const caseSensitive of [false, true]) {
      const query: AtermQuery = { operation: 'list', termPatterns: ['_root*'], caseSensitive };
      const response = await fetch(listening.url + '/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': String(serverProtocol) },
        body: JSON.stringify({ home: app.home.home, query }),
      });
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(await app.query(query))));
      const responseGraph = await fetch(listening.url + '/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ terms(match: "_root*", caseSensitive: ${caseSensitive}) { totalCount } }`,
        }),
      });
      expect((await responseGraph.json()).data.terms.totalCount).toBe(caseSensitive ? 0 : 1);
    }
  } finally {
    await listening.close();
  }
});
