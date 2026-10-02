import { expect, test } from 'vitest';
import { fixture } from './fixture.js';

const knowledgeSource = (body: string) => '@knowledge example\n@viewpoints spec\n' + body;
const caller = (reference: string) =>
  `concept _Apply_ = {\n  Apply rules.\n.relations\n  references _Rule_\n.contract\n  ${reference}\n}\n`;
const rule = 'concept _Rule_ = {\n  Rule identity.\n.contract\n  - Use one name.\n}\n';

test('section references keep Term identity, exact physical location and the actual dagger', async () => {
  const f = await fixture();
  await f.write('docs/SPEC-example.trm', knowledgeSource(caller('_Rule_.contract†') + rule));
  const result = await f.read({ operation: 'show', termPatterns: ['_Apply_'] });
  const ref = result.termDeclarations[0]!.references.find((r) => r.targetSection)!;
  expect(ref).toMatchObject({
    name: '_Rule_',
    id: '_example:Rule_',
    targetSection: 'contract',
    required: true,
    line: 8,
    column: 3,
    contentOffset: 0,
  });
  expect(result.termDeclarations.map((e) => e.name)).toEqual(['_Apply_']);
  expect(result.sectionContext?.map((e) => e.name)).toEqual(['_Rule_']);
  expect(
    (await f.read({ operation: 'view', termPatterns: ['_Apply_'] })).termDeclarations.map(
      (e) => e.name,
    ),
  ).toEqual(['_Apply_']);
  await f.write('docs/SPEC-example.trm', knowledgeSource(caller('_Rule_.contract+') + rule));
  const plain = await f.read({ operation: 'show', termPatterns: ['_Apply_'] });
  expect(
    plain.termDeclarations[0]!.references.find((r) => r.targetSection)?.required,
  ).toBeUndefined();
  expect(plain.sectionContext).toEqual([]);
});

test.each([
  ['_Rule_.absent†', rule, 'Missing section'],
  [
    '_Rule_.contract†',
    rule + 'procedure _Rule_ = {\n  Other rule.\n.contract\n  Other.\n}\n',
    'Duplicate Term',
  ],
  ['Apply _Rule_.contract† here.', rule, 'must occupy a line by itself'],
  [
    '_Rule_.contract†',
    'concept _Rule_ = {\n  A rule.\n.contract\n  _Rule_.contract†\n}\n',
    'Section expansion cycle',
  ],
])('check rejects invalid section expansion %s', async (reference, target, message) => {
  const f = await fixture();
  await f.write('docs/SPEC-example.trm', knowledgeSource(caller(reference) + target));
  const result = await f.read({ operation: 'check' });
  expect(result.diagnostics.some((d) => d.message.includes(message))).toBe(true);
  await expect(f.read({ operation: 'show', termPatterns: ['_Apply_'] })).rejects.toThrow(message);
});

test('fenced and escaped section references stay opaque, while empty sections remain valid', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-example.trm',
    knowledgeSource(
      caller('```md\n  _Absent_.contract†\n  ```\n  \\_Absent_.contract†\n  _Rule_.contract†') +
        'concept _Rule_ = {\n  A rule.\n.contract\n}\n',
    ),
  );
  const result = await f.read({ operation: 'check' });
  expect(result.diagnostics).toEqual([]);
  expect(result.termDeclarations[0]!.references.filter((r) => r.targetSection)).toHaveLength(1);
});

test('nested required context follows only the selected section', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-example.trm',
    knowledgeSource(
      caller('_Rule_.contract†') +
        'concept _Rule_ = {\n  A rule.\n.relations\n  references _Detail_\n  references _Other_\n.contract\n  Use _Detail_†.\n.remarks\n  Read _Other_†.\n}\nconcept _Detail_ = { Detail. }\nconcept _Other_ = { Other. }\n',
    ),
  );
  const result = await f.read({ operation: 'view', termPatterns: ['_Apply_'] });
  expect(result.termDeclarations.map((e) => e.name)).toEqual(['_Apply_', '_Detail_']);
  expect(result.sectionContext?.map((e) => [e.name, e.termKind])).toEqual([['_Rule_', 'concept']]);
});

test('rename and rename-knowledge preserve section selectors and daggers', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-example.trm',
    knowledgeSource(caller('_example:Rule_.contract†') + rule),
  );
  await f.author({ operation: 'rename', from: '_Rule_', to: '_Policy_' });
  let result = await f.read({ operation: 'show', termPatterns: ['_Apply_'] });
  expect(result.termDeclarations[0]!.contract).toBe('_example:Policy_.contract†');
  await f.author({ operation: 'rename-knowledge', from: 'example', to: 'renamed' });
  result = await f.read({ operation: 'show', termPatterns: ['_Apply_'] });
  expect(result.termDeclarations[0]!.contract).toBe('_renamed:Policy_.contract†');
  expect(result.sectionContext?.[0]?.id).toBe('_renamed:Policy_');
});
