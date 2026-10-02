import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermParser, TermDeclarationIndex } from '../src/index.js';
import { fixture } from './fixture.js';

const index = (...sources: string[]) =>
  new TermDeclarationIndex(sources.map((text, i) => new AtermParser().parse(`${i}.trm`, text)));
const knowledgeSource = (body: string, knowledge = 'test') =>
  `@knowledge ${knowledge}\n@viewpoints spec\n${body}`;

test('declarations cover all content sections by canonical target, independent of occurrence order', () => {
  const parsed = index(
    knowledgeSource(`concept _A_ = {
  _A_ uses _B_.
.relations
  uses _test:B_
.contract
  _B_ follows _A_.
.remarks
  _test:B_ supplies context.
}
concept _B_ = { A target. }`),
  );
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.relations).toMatchObject([
    { source: '_test:A_', phrase: 'uses', target: '_test:B_' },
  ]);
  expect(
    parsed
      .get('_A_')[0]!
      .references.filter((r) => r.id === '_test:B_')
      .map((r) => r.section),
  ).toEqual(['definition', 'relations', 'contract', 'remarks']);
});

test('an existing but undeclared target is refused in definition, contract and remarks; self is allowed', () => {
  const parsed = index(
    knowledgeSource(`concept _A_ = {
  _A_ refers to _B_.
.contract
  _B_ is required.
.remarks
  Read _B_.
}
concept _B_ = { A target. }`),
  );
  expect(parsed.diagnostics.map((d) => [d.line, d.message])).toEqual([
    [4, expect.stringContaining('Undeclared reference _test:B_')],
    [6, expect.stringContaining('Undeclared reference _test:B_')],
    [8, expect.stringContaining('Undeclared reference _test:B_')],
  ]);
  expect(index(knowledgeSource('concept _A_ = { Defines _A_. }')).diagnostics).toEqual([]);
});

test('declaration scope belongs to one Term Declaration and is not shared by other Terms', () => {
  const parsed = index(
    knowledgeSource(`concept _A_ = {
  A concept.
.relations
  uses _B_
}
procedure _Act_ = {
  Uses _B_.
}
concept _B_ = { A target. }`),
  );
  expect(parsed.diagnostics).toMatchObject([
    { line: 9, message: expect.stringContaining('in procedure _test:Act_') },
  ]);
});

test('declarations are neither transitive imports nor aliases for another Knowledge', () => {
  const parsed = index(
    knowledgeSource(`concept _A_ = {
  Uses _remote:B_ and _B_.
.relations
  uses _remote:B_
}
concept _B_ = { A local target. }`),
    knowledgeSource(
      `concept _B_ = {
  Uses _C_.
.relations
  uses _C_
}
concept _C_ = { A remote target. }`,
      'remote',
    ),
  );
  expect(parsed.diagnostics).toMatchObject([
    { message: expect.stringContaining('Undeclared reference _test:B_') },
  ]);
});

test('a declaration can stand alone but its target must resolve', () => {
  expect(
    index(
      knowledgeSource(`concept _A_ = {
  An owner.
.relations
  references _B_
}
concept _B_ = { A target. }`),
    ).diagnostics,
  ).toEqual([]);
  const missing = index(
    knowledgeSource(`concept _A_ = {
  An owner.
.relations
  uses _Missing_
}`),
  );
  expect(missing.diagnostics.some((d) => d.message.includes('Unresolved'))).toBe(true);
  expect(missing.diagnostics.some((d) => d.message.includes('Undeclared'))).toBe(false);
});

test('opaque examples and escaped tokens need no declaration', () => {
  const parsed = index(
    knowledgeSource(
      'concept _A_ = {\n  A definition with \\_Escaped_.\n.contract\n  ```trm\n  **Relation**: _Old_ uses _Missing_\n  ```\n}\n',
    ),
  );
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.get('_A_')[0]!.references).toEqual([]);
});

test('authoring rejects an undeclared dependency without writing and accepts declaration plus prose atomically', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    knowledgeSource(
      'concept _A_ = {\n  A.\n.relations\n.contract\n  Original.\n}\nconcept _B_ = { B. }',
    ),
  );
  const path = join(f.docs, 'SPEC-one.trm');
  const before = await readFile(path, 'utf8');
  const content = '*** Update Term: _A_.contract\n@@\n-  Original.\n+  Uses _B_.\n';
  await expect(
    f.author({ operation: 'edit', patch: '*** Begin Patch\n' + content + '*** End Patch' }),
  ).rejects.toThrow('Undeclared reference');
  expect(await readFile(path, 'utf8')).toBe(before);
  await f.author({
    operation: 'edit',
    patch:
      '*** Begin Patch\n*** Update Term: _A_.relations\n@@\n+  uses _B_\n' +
      content +
      '*** End Patch',
  });
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  expect(
    (await f.read({ operation: 'grep', referencePattern: '_B_', termPatterns: ['_A_'] }))
      .occurrences,
  ).toHaveLength(2);
  expect((await f.read({ operation: 'relations', edgeOrigins: ['reference'] })).relations).toEqual(
    [],
  );
});

test.each(['keyed', 'fenced-content', 'fenced-end'])(
  'format sorts declaration groups consistently: %s',
  async (form) => {
    const f = await fixture();
    const first = form === 'keyed' ? 'concept _A_ = {' : 'concept _A_ = ```md';
    const tail =
      form === 'keyed'
        ? '.contract\n  Prose.\n}'
        : form === 'fenced-content'
          ? '---md\n  Prose.\n```'
          : '```';
    const body =
      first +
      '\n  A.\n.relations\n  zips _A_\n  accepts _A_\n\n  yields _A_\n  builds _A_\n' +
      tail;
    await f.write('docs/SPEC-one.trm', knowledgeSource(body));
    const path = join(f.docs, 'SPEC-one.trm');
    const before = await readFile(path, 'utf8');
    await f.author({ operation: 'format' });
    expect(await readFile(path, 'utf8')).toBe(
      before
        .replace('  zips _A_\n  accepts _A_', '  accepts _A_\n  zips _A_')
        .replace('  yields _A_\n  builds _A_', '  builds _A_\n  yields _A_'),
    );
    expect((await f.author({ operation: 'format' })).files).toEqual([]);
  },
);

test('a declared unresolved target remains an explicit draft warning while check stays invalid', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    knowledgeSource('concept _A_ = {\n  A.\n.relations\n.contract\n  Original.\n}'),
  );
  const result = await f.author({
    operation: 'edit',
    patch:
      '*** Begin Patch\n*** Update Term: _A_.relations\n@@\n+  uses _Future_\n*** Update Term: _A_.contract\n@@\n-  Original.\n+  Uses _Future_.\n*** End Patch',
  });
  expect(result.warnings.some((warning) => warning.includes('Unresolved'))).toBe(true);
  expect(result.warnings.every((warning) => !warning.includes('Undeclared'))).toBe(true);
  const checked = await f.read({ operation: 'check' });
  expect(checked.diagnostics.some((d) => d.message.includes('Unresolved'))).toBe(true);
  expect(await readFile(join(f.docs, 'SPEC-one.trm'), 'utf8')).toContain('  uses _Future_');
});

test.each([
  ['is_a', 'generalization', true],
  ['instance_of', 'instantiation', false],
  ['has_part', 'parthood', true],
  ['has_member', 'membership', true],
  ['has_state', 'state_membership', true],
  ['has_property', 'property', false],
  ['depends_on', 'dependency', false],
  ['realizes', 'realization', false],
  ['references', 'reference', false],
  ['is a', 'association', false],
  ['Realizes', 'association', false],
  ['is configured by', 'association', false],
])(
  'classifies %s without changing authored direction or required context',
  (phrase, type, structural) => {
    const parsed = index(
      knowledgeSource(
        `concept _A_ = {\n  A.\n.relations\n  ${phrase} _B_†\n}\nconcept _B_ = { B. }`,
      ),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.relations).toMatchObject([
      { source: '_test:A_', target: '_test:B_', phrase, type, structural, required: true, line: 6 },
    ]);
  },
);

test.each(['has_parts', 'IS_A', 'part_of', 'has_states', 'HAS_STATE'])(
  'refuses unregistered underscore name %s with the accepted vocabulary',
  (phrase) => {
    const parsed = index(knowledgeSource(`concept _A_ = {\n  A.\n.relations\n  ${phrase} _A_\n}`));
    expect(parsed.relations).toEqual([]);
    expect(parsed.diagnostics).toMatchObject([
      { line: 6, message: expect.stringContaining(`Unknown built-in Relation ${phrase}`) },
    ]);
    expect(parsed.diagnostics[0]!.message).toContain('is_a, instance_of, has_part, has_member');
  },
);

test.each([
  ['has_part', 'parthood'],
  ['has_state', 'state_membership'],
])('%s semantics survive filtering, required reads, format and rename', async (phrase, type) => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    knowledgeSource(`concept _A_ = {
  Uses _B_.
.relations
  uses _B_
  ${phrase} _B_†
}
concept _B_ = { B. }`),
  );
  const result = await f.read({ operation: 'relations', relationPhrases: ['has_*'] });
  expect(result.relations).toMatchObject([
    {
      phrase,
      type,
      structural: true,
      source: '_test:A_',
      target: '_test:B_',
    },
  ]);
  const view = await f.read({ operation: 'view', termPatterns: ['_A_'] });
  expect(view.termDeclarations.map((e) => e.name)).toEqual(['_A_', '_B_']);
  expect(view.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ origin: 'explicit', type: 'reference', structural: false }),
      expect.objectContaining({
        phrase,
        type,
        structural: true,
        required: true,
      }),
    ]),
  );
  await f.author({ operation: 'format' });
  await f.author({ operation: 'rename', from: '_B_', to: '_Part_' });
  const source = await readFile(join(f.docs, 'SPEC-one.trm'), 'utf8');
  expect(source).toContain(`  ${phrase} _Part_†\n  uses _Part_`);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  expect(
    (await f.read({ operation: 'relations', relationPhrases: [phrase] })).relations,
  ).toMatchObject([{ phrase, type, structural: true, target: '_test:Part_' }]);
});
