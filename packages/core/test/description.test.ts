import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermParser, type IKnowledgeResult } from '../src/index.js';
import { fixture } from './fixture.js';

test('Knowledge Description and Scope share block syntax but remain separate metadata', () => {
  const source =
    '\uFEFF@knowledge example\r\n@viewpoints specification\r\n@description {\r\n  Inventory and _Missing_ examples.\r\n\r\n  A second paragraph.\r\n}\r\n@scope {\r\n  Specify stock changes only.\r\n}\r\nconcept _Stock_ = { Available stock. }\r\n';
  const parsed = new AtermParser().parse('example.trm', source);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.description).toEqual({
    content: 'Inventory and _Missing_ examples.\n\nA second paragraph.',
    line: 3,
    endLine: 7,
  });
  expect(parsed.scope).toEqual({ content: 'Specify stock changes only.', line: 8, endLine: 10 });
  expect(parsed.termDeclarations[0]).toMatchObject({
    line: 11,
    endLine: 11,
    references: [],
    scope: parsed.scope,
  });
  expect(parsed.relations).toEqual([]);
  const reversed = new AtermParser().parse(
    'empty.trm',
    '@knowledge empty\n@viewpoints specification\n@scope {\n  Cover contracts.\n}\n@description {\n  Contracts for readers.\n}\n',
  );
  expect(reversed.diagnostics).toEqual([]);
  expect(reversed.description?.content).toBe('Contracts for readers.');
  expect(reversed.termDeclarations).toEqual([]);
  expect(
    new AtermParser().parse('absent.trm', '@knowledge empty\n@viewpoints specification\n')
      .description,
  ).toBeUndefined();
});

test.each([
  '@description {\n}\n',
  '@description { Inline. }\n',
  '@description text\n',
  '@description {\n No indentation.\n}\n',
  '@description {\n  Unclosed.\n',
  '@description {\n  First.\n}\n@description {\n  Duplicate.\n}\n',
  'concept _A_ = { A. }\n@description {\n  Too late.\n}\n',
])('invalid Description fails checking: %s', (body) => {
  const parsed = new AtermParser().parse(
    'bad.trm',
    '@knowledge bad\n@viewpoints specification\n' + body,
  );
  expect(parsed.diagnostics.length).toBeGreaterThan(0);
});

test('Description must follow Viewpoints and parsing recovers before the next Term Declaration', () => {
  const parser = new AtermParser();
  expect(
    parser
      .parse('bad.trm', '@knowledge bad\n@description {\n  Early.\n}\n@viewpoints specification\n')
      .diagnostics.map((d) => d.message),
  ).toContain('@description must follow @viewpoints and precede the first Term Declaration.');
  const recovered = parser.parse(
    'bad.trm',
    '@knowledge bad\n@viewpoints specification\n@description {\n  Open.\nconcept _A_ = { A. }\n',
  );
  expect(recovered.diagnostics.some((d) => d.message.includes('Unclosed @description'))).toBe(true);
  expect(recovered.termDeclarations[0]?.name).toBe('_A_');
});

test('Knowledge reads and catalogs expose Description independently of Scope and preserve it through authoring', async () => {
  const f = await fixture();
  const source =
    '@knowledge inventory\n@viewpoints spec\n@description {\n  Inventory examples.\n}\n@scope {\n  Cover stock only.\n}\nconcept _Stock_ = { Available stock. }\n';
  await f.write('docs/inventory.trm', source);
  await f.write(
    'docs/empty.trm',
    '@knowledge empty\n@viewpoints spec\n@description {\n  Future examples.\n}\n',
  );
  const app = await f.app();
  for (const operation of ['knowledge-list', 'knowledge-view'] as const) {
    const result = (await app.query({
      operation,
      ...(operation === 'knowledge-view' ? { knowledgeIds: ['*'] } : {}),
    })) as IKnowledgeResult;
    expect(result.knowledges.map((k) => k.description?.content)).toEqual([
      'Future examples.',
      'Inventory examples.',
    ]);
    expect(result.knowledges[0]?.scope).toBeUndefined();
    expect(result.knowledges[1]?.scope?.content).toBe('Cover stock only.');
  }
  const catalog = await f.read({ operation: 'list', knowledge: 'inventory' });
  expect(catalog.knowledges?.map((k) => k.description?.content)).toEqual([
    'Future examples.',
    'Inventory examples.',
  ]);
  await f.author({ operation: 'rename', from: '_Stock_', to: '_Inventory_' });
  await f.author({ operation: 'format' });
  await f.author({ operation: 'rename-knowledge', from: 'inventory', to: 'stock' });
  expect(await readFile(join(f.docs, 'inventory.trm'), 'utf8')).toBe(
    source.replace('@knowledge inventory', '@knowledge stock').replace('_Stock_', '_Inventory_'),
  );
});
