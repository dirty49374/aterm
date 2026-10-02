import { expect, test, vi } from 'vitest';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { atermQuery, AtermServer, serverProtocol } from '../src/index.js';
import { TermRetrieval } from '../src/retrieval-module/retrieval.js';
import { VectorCache } from '../src/file-module/vector-cache.js';
import { discoveryChunks, rankDiscovery } from '../src/query-module/discovery.js';
import {
  NativeEmbedding,
  embeddingWindows,
  type ITextEmbedding,
} from '../src/file-module/embedding.js';
import { fixture } from './fixture.js';

class EmbeddingFixture implements ITextEmbedding {
  available = false;
  passages = 0;
  fail = false;
  async ready() {
    return this.available;
  }
  async embed(texts: readonly string[], role: 'query' | 'passage', download = false) {
    if (download) this.available = true;
    if (!this.available) throw new Error('Model not prepared');
    if (this.fail) throw new Error('Inference failed');
    if (role === 'passage') this.passages += texts.length;
    return texts.map((text) => {
      const vector = Array<number>(384).fill(0);
      vector[0] = /compare|comparison/.test(text) ? 1 : 0.1;
      vector[1] = /payment|money/.test(text) ? 1 : 0.1;
      return vector;
    });
  }
}

test('Model windows preserve long multilingual input including surrogate pairs and the tail', () => {
  const text = '한글 abc 🙂 '.repeat(200) + 'important tail';
  const windows = embeddingWindows(text, (value) => Array.from(value).length <= 128);
  expect(windows.join('')).toBe(text);
  expect(
    windows.every((value) => Array.from(value).length <= 128 && !/[\uD800-\uDFFF]/u.test(value)),
  ).toBe(true);
  expect(windows.at(-1)).toContain('important tail');
});

async function corpus() {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    `@knowledge one
@viewpoints spec
concept _Compare_ = {
  Compare several concepts together.
.contract
  Preserve comparison context.
.remarks
  UniqueRemark
}
concept _Payment_ = { Accept money for a product. }
`,
  );
  await f.write(
    'shared/OTHER-two.trm',
    '@knowledge two\n@viewpoints other\nconcept _Compare_ = { Compare money and payment. }\n',
  );
  return f;
}

test('lexical discovery needs no Model, ranks exact names first and retains the selected Term Kind', async () => {
  const f = await corpus();
  const app = await f.app();
  const result = await app.query({
    operation: 'discover',
    question: '_one:Compare_',
    searchMode: 'lexical',
    limit: 1,
  });
  expect(result).toMatchObject({
    operation: 'discover',
    limit: 1,
    truncated: true,
    candidates: [{ id: '_one:Compare_', rank: 1, exactName: true, termKinds: ['spec.concept'] }],
  });
  const remarks = await app.query({
    operation: 'discover',
    question: 'UniqueRemark',
    searchMode: 'lexical',
    remarks: false,
  });
  expect(remarks).toMatchObject({ candidates: [], totalCandidates: 0 });
  expect(await app.query({ operation: 'index-status' })).toMatchObject({
    ready: false,
    modelReady: false,
    cachedChunks: 0,
  });
  await expect(app.query({ operation: 'discover', question: 'Compare' })).rejects.toThrow(
    'corpus index build',
  );
});

test('discovery validates request shape, complete corpus and selectors before filtering', async () => {
  for (const input of [
    { operation: 'discover' },
    { operation: 'discover', question: ' ' },
    { operation: 'discover', question: 'x', limit: 101 },
    { operation: 'discover', question: 'x', searchMode: 'unknown' },
    { operation: 'discover', question: 'x', externalSources: { core: '*.ts' } },
    { operation: 'discover', question: 'x', relationPhrases: ['uses'] },
    { operation: 'index-build', knowledge: 'one' },
    { operation: 'search', question: 'x' },
  ])
    expect(atermQuery.safeParse(input).success).toBe(false);
  const f = await corpus();
  expect(
    await (
      await f.app()
    ).query({
      operation: 'discover',
      question: 'compare',
      searchMode: 'lexical',
      termPatterns: ['_Compare_'],
    }),
  ).toMatchObject({
    ambiguity: { candidates: [{ id: '_one:Compare_' }, { id: '_two:Compare_' }] },
  });
  expect(
    await (
      await f.app()
    ).query({
      operation: 'discover',
      question: 'compare',
      searchMode: 'lexical',
      viewpoints: ['other'],
      knowledge: 'two',
    }),
  ).toMatchObject({ candidates: [{ id: '_two:Compare_' }] });
  await f.write('shared/OTHER-broken.trm', 'concept _Broken_ = { _Missing_ }');
  await expect(
    (await f.app()).query({
      operation: 'discover',
      question: 'compare',
      knowledge: 'one',
      searchMode: 'lexical',
    }),
  ).rejects.toThrow();
});

test('section selection limits lexical content and name priority, preserving every eligible Definition', async () => {
  const f = await corpus();
  const app = await f.app();
  expect(
    await app.query({
      operation: 'discover',
      question: 'context',
      searchMode: 'lexical',
      searchSections: ['definition'],
    }),
  ).toMatchObject({ candidates: [] });
  const definitions = await app.query({
    operation: 'discover',
    question: 'Compare',
    knowledge: 'one',
    searchMode: 'lexical',
    searchSections: ['definition', 'definition'],
  });
  expect(definitions).toMatchObject({
    searchSections: ['definition'],
    candidates: [
      {
        id: '_one:Compare_',
        exactName: false,
        definitions: [{ termKind: 'spec.concept', text: 'Compare several concepts together.' }],
      },
    ],
  });
  expect(
    await app.query({
      operation: 'discover',
      question: 'UniqueRemark',
      searchMode: 'lexical',
      searchSections: ['remarks'],
      remarks: false,
    }),
  ).toMatchObject({ candidates: [] });
  await expect(
    app.query({ operation: 'discover', question: 'x', searchSections: ['definiton'] }),
  ).rejects.toThrow('Unknown search section definiton');
  expect(
    atermQuery.safeParse({ operation: 'discover', question: 'x', searchSections: [] }).success,
  ).toBe(false);
  expect(atermQuery.safeParse({ operation: 'list', searchSections: ['definition'] }).success).toBe(
    false,
  );
  await f.write('docs/SPEC-name.trm', 'concept _NameOnlyNeedle_ = { Plain body. }');
  const nameOnly = await f.app();
  expect(
    await nameOnly.query({
      operation: 'discover',
      question: 'NameOnlyNeedle',
      searchMode: 'lexical',
    }),
  ).toMatchObject({ candidates: [{ id: '_docs_spec_name:NameOnlyNeedle_' }] });
  expect(
    await nameOnly.query({
      operation: 'discover',
      question: 'NameOnlyNeedle',
      searchMode: 'lexical',
      searchSections: ['definition'],
    }),
  ).toMatchObject({ candidates: [] });
});

test('section filtering precedes semantic ranking and never embeds unselected bodies', async () => {
  const f = await corpus();
  const embedding = new EmbeddingFixture();
  const retrieval = new TermRetrieval(f.home, embedding);
  const source = await f.read({ operation: 'list' });
  await retrieval.index(source, true);
  const prepared = embedding.passages;
  const result = await retrieval.discover(source, 'compare', 'hybrid', 10, true, ['definition']);
  expect(embedding.passages).toBe(prepared);
  expect(result.searchSections).toEqual(['definition']);
  expect(
    result.candidates.every((candidate) =>
      candidate.evidence.every((e) => e.section === 'definition'),
    ),
  ).toBe(true);
  const contractChunks = discoveryChunks(source.termDeclarations, true, ['contract']);
  expect(
    contractChunks.every((chunk) => !chunk.input.includes('Compare several concepts together.')),
  ).toBe(true);
  expect(contractChunks.map((chunk) => chunk.definition)).toContain(
    'Compare several concepts together.',
  );
});

test('source chunks cover long sections, preserve section provenance and fuse ranks by Term', async () => {
  const f = await corpus();
  const result = await f.read({ operation: 'list', knowledge: 'one' });
  const chunks = discoveryChunks(result.termDeclarations);
  for (const termDeclaration of result.termDeclarations)
    for (const section of termDeclaration.sections) {
      const owned = chunks.filter(
        (chunk) =>
          chunk.term === termDeclaration.id &&
          chunk.termKind.endsWith('.' + termDeclaration.termKind) &&
          chunk.section === section.key,
      );
      expect(owned.map((c) => c.excerpt).join('')).toBe(section.content);
      expect(
        owned.every(
          (c) =>
            c.line >= termDeclaration.line &&
            c.endLine <= termDeclaration.endLine &&
            c.endLine >= c.line,
        ),
      ).toBe(true);
    }
  const long = {
    ...result.termDeclarations[0]!,
    sections: [
      {
        key: 'definition',
        filetype: 'md' as const,
        line: 3,
        content: '한글 comparison. '.repeat(200),
      },
    ],
  };
  expect(
    discoveryChunks([long])
      .map((chunk) => chunk.excerpt)
      .join(''),
  ).toBe(long.sections[0]!.content);
  const ranked = rankDiscovery(
    chunks,
    '_Payment_',
    'hybrid',
    1,
    'fingerprint',
    chunks.map(() => 0.1),
  );
  expect(ranked.candidates[0]?.id).toBe('_one:Payment_');
  expect(ranked.candidates[0]?.evidence.length).toBeLessThanOrEqual(3);
});

test('native cosine distance, cache reuse, incremental edits and deletions use the current snapshot', async () => {
  const f = await corpus();
  const embedding = new EmbeddingFixture();
  const retrieval = new TermRetrieval(f.home, embedding);
  const source = await f.read({ operation: 'list' });
  const built = await retrieval.index(source, true);
  expect(built).toMatchObject({ ready: true, missingChunks: 0 });
  const initial = embedding.passages;
  expect((await retrieval.discover(source, 'compare', 'semantic', 2)).candidates[0]?.id).toBe(
    '_one:Compare_',
  );
  await retrieval.index(source, true);
  expect(embedding.passages).toBe(initial);
  const path = join(f.workspace, 'docs/SPEC-one.trm');
  const text = await readFile(path, 'utf8');
  await writeFile(path, '\n\n' + text);
  const shifted = await f.read({ operation: 'list' });
  const shiftedSearch = await retrieval.discover(shifted, 'compare', 'hybrid', 2);
  expect(embedding.passages).toBe(initial);
  expect(shiftedSearch.corpusFingerprint).not.toBe(built.corpusFingerprint);
  expect(shiftedSearch.candidates[0]?.evidence[0]?.line).toBeGreaterThan(3);
  await writeFile(
    path,
    text.replace('Preserve comparison context.', 'Preserve comparison context and selection.'),
  );
  expect(await retrieval.index(await f.read({ operation: 'list' }), false)).toMatchObject({
    missingChunks: 1,
    ready: false,
  });
  await retrieval.discover(await f.read({ operation: 'list' }), 'compare', 'semantic', 10);
  expect(embedding.passages).toBe(initial + 1);
  await unlink(join(f.workspace, 'shared/OTHER-two.trm'));
  const removed = await retrieval.discover(
    await f.read({ operation: 'list' }),
    'compare',
    'semantic',
    10,
  );
  expect(removed.candidates.map((candidate) => candidate.id)).not.toContain('_two:Compare_');
  const selected = await f.read({ operation: 'list', termPatterns: ['_one:Payment_'] });
  expect(
    (await retrieval.discover(selected, 'compare', 'semantic', 1)).candidates.map((c) => c.id),
  ).toEqual(['_one:Payment_']);
});

test('failed inference preserves completed cache and reports failure without lexical fallback', async () => {
  const f = await corpus();
  const embedding = new EmbeddingFixture();
  const retrieval = new TermRetrieval(f.home, embedding);
  const source = await f.read({ operation: 'list' });
  await retrieval.index(source, true);
  embedding.fail = true;
  await expect(retrieval.discover(source, 'compare', 'hybrid', 5)).rejects.toThrow(
    'Inference failed',
  );
  expect(await retrieval.index(source, false)).toMatchObject({ ready: true, missingChunks: 0 });
  expect(
    (await retrieval.discover(source, 'compare', 'lexical', 5)).candidates.length,
  ).toBeGreaterThan(0);
});

test('native cache rejects invalid vectors transactionally and computes exact cosine distance', () => {
  const cache = new VectorCache(':memory:', 2);
  try {
    cache.put(
      new Map([
        ['a', [1, 0]],
        ['b', [0, 1]],
      ]),
    );
    expect(
      cache.distances(
        [
          [1, 0],
          [0, 1],
          [-1, 0],
        ],
        [1, 0],
      ),
    ).toEqual([0, 1, 2]);
    expect(() =>
      cache.put(
        new Map([
          ['c', [1, 0]],
          ['broken', [NaN, 0]],
        ]),
      ),
    ).toThrow('Invalid Embedding');
    expect([...cache.read(['a', 'b', 'c']).keys()]).toEqual(['a', 'b']);
  } finally {
    cache.close();
  }
});

test('unprepared native Model refuses without network access', async () => {
  const f = await corpus();
  const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  try {
    await expect(
      new NativeEmbedding(join(f.home, 'missing')).embed(['compare'], 'query'),
    ).rejects.toThrow('corpus index build');
    expect(request).not.toHaveBeenCalled();
  } finally {
    request.mockRestore();
  }
});

test('HTTP discovery equals local discovery and Index build stays local', async () => {
  const f = await corpus();
  const app = await f.app();
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const server = new AtermServer({
    ...app.config,
    server: { port, host: '127.0.0.1', debounceMs: 10, watchExternal: false },
  });
  await server.start();
  const send = async (query: unknown) =>
    fetch(server.url + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': String(serverProtocol) },
      body: JSON.stringify({ home: f.home, query }),
    });
  try {
    const query = {
      operation: 'discover' as const,
      question: 'compare concepts',
      searchMode: 'lexical' as const,
      limit: 2,
      searchSections: ['definition'],
    };
    expect(await (await send(query)).json()).toEqual(await app.query(query));
    const rejected = await send({ operation: 'index-build' });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: 'server.readonly' } });
    expect(await (await send({ operation: 'index-status' })).json()).toMatchObject({
      ready: false,
    });
  } finally {
    await server.close();
  }
});
