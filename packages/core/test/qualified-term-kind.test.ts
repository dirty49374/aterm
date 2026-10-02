import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermParser, AtermSchema, type AtermTermKind } from '../src/syntax-module/index.js';
import { TermDeclarationIndex } from '../src/query-module/registry.js';
import { fixture } from './fixture.js';

const termKinds: AtermTermKind[] = ['domain', 'skill'].map((viewpoint) => ({
  name: 'procedure',
  viewpoint,
  description: viewpoint,
  schema: new AtermSchema(viewpoint, [
    { name: 'definition', type: 'md' },
    { name: viewpoint === 'domain' ? 'rules' : 'procedure', type: 'md' },
  ]),
}));
const header = '@knowledge example\n@viewpoints domain skill\n';

test('qualified Term Kinds choose their own Schema in block, inline and legacy Term Declarations', () => {
  const body = [
    'skill.procedure _Work_ in actions = {',
    '  Perform work.',
    '.procedure',
    '  1. Do it.',
    '}',
    'domain.procedure _Domain_Work_ = {',
    '  Domain work.',
    '.rules',
    '  - Obey the domain.',
    '}',
    'skill.procedure _Inline_ = { Handle _Inline_. }',
    'domain.procedure _Legacy_ = ```md',
    '  Legacy body.',
    '---md',
    '  Legacy rule.',
    '```',
  ].join('\n');
  const parsed = new AtermParser(termKinds).parse('example.trm', header + body);
  expect(parsed.diagnostics).toEqual([]);
  expect(
    parsed.termDeclarations.map((e) => [e.termKind, e.viewpoint, e.sections.at(-1)!.key]),
  ).toEqual([
    ['skill.procedure', 'skill', 'procedure'],
    ['domain.procedure', 'domain', 'rules'],
    ['skill.procedure', 'skill', 'definition'],
    ['domain.procedure', 'domain', 'rules'],
  ]);
  expect(new TermDeclarationIndex([parsed]).diagnostics).toEqual([]);
  const wrong = new AtermParser(termKinds).parse(
    'example.trm',
    header + 'skill.procedure _Work_ = {\n  Work.\n.rules\n  Wrong vocabulary.\n}',
  );
  expect(wrong.diagnostics.some((d) => d.message.includes('Unknown or excess section'))).toBe(true);
});

test('short names require one owner; undeclared owners and malformed qualifiers fail', () => {
  const parser = new AtermParser(termKinds);
  const short = parser.parse('example.trm', header + 'procedure _Work_ = { Work. }');
  expect(short.diagnostics[0]?.message).toBe(
    'Ambiguous Term Kind procedure; qualify it with its Viewpoint: domain.procedure, skill.procedure.',
  );
  for (const spelling of [
    'absent.procedure',
    'skill.absent',
    'skill..procedure',
    'skill.procedure.more',
    '.procedure',
  ])
    expect(
      parser.parse('example.trm', header + `${spelling} _Work_ = { Work. }`).diagnostics.length,
    ).toBeGreaterThan(0);
  expect(
    new AtermParser([termKinds[0]!]).parse(
      'example.trm',
      '@knowledge example\n@viewpoints domain\nprocedure _Work_ = { Work. }',
    ).diagnostics,
  ).toEqual([]);
  expect(
    new AtermParser([termKinds[0]!]).parse(
      'example.trm',
      '@knowledge example\n@viewpoints domain\nskill.procedure _Work_ = { Work. }',
    ).diagnostics[0]?.message,
  ).toContain('Unknown Term Kind skill.procedure');
});

test('short and qualified spellings of the same Term Kind are duplicate Term Declarations', () => {
  const parsed = new AtermParser([termKinds[1]!]).parse(
    'example.trm',
    '@knowledge example\n@viewpoints skill\nprocedure _Work_ = { Work. }\nskill.procedure _Work_ = { Work again. }',
  );
  expect(parsed.diagnostics).toEqual([]);
  expect(new TermDeclarationIndex([parsed]).diagnostics[0]?.message).toContain(
    'Duplicate Term _example:Work_',
  );
});

test('edit can guard a single Term Declaration by qualified Term Kind while rename preserves its spelling', async () => {
  const f = await fixture();
  const before =
    '@knowledge example\n@viewpoints spec other\nother.procedure _Work_ in work.actions = { Handle _Work_. }\n';
  await f.write('docs/model.trm', before);
  const patch = (selector: string) =>
    `*** Begin Patch\n*** Update Term: ${selector} _example:Work_\n@@\n-other.procedure _Work_ in work.actions = { Handle _Work_. }\n+other.procedure _Work_ in work.actions = { Updated work. }\n*** End Patch\n`;
  await expect(f.author({ operation: 'edit', patch: patch('spec.procedure') })).rejects.toThrow(
    'Unknown',
  );
  expect(await readFile(join(f.docs, 'model.trm'), 'utf8')).toBe(before);
  await f.author({ operation: 'edit', patch: patch('other.procedure'), dryRun: true });
  expect(await readFile(join(f.docs, 'model.trm'), 'utf8')).toBe(before);
  await f.author({ operation: 'edit', patch: patch('other.procedure') });
  await f.author({ operation: 'rename', from: '_Work_', to: '_Run_' });
  await f.author({ operation: 'format', termPatterns: ['_Run_'] });
  expect(await readFile(join(f.docs, 'model.trm'), 'utf8')).toContain(
    'other.procedure _Run_ in work.actions = { Updated work. }',
  );
  expect(
    (await f.read({ operation: 'view', termPatterns: ['_Run_'] })).termDeclarations.map(
      (e) => e.termKind,
    ),
  ).toEqual(['other.procedure']);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('move qualifies a short name only when the destination adds ambiguity and preserves the owner', async () => {
  const f = await fixture();
  const before =
    '@knowledge source\n@viewpoints spec\nprocedure _Work_ in actions = { Handle _Work_. }\n';
  await f.write('docs/source.trm', before);
  await f.write('docs/target.trm', '@knowledge target\n@viewpoints spec other\n');
  const input = { operation: 'move' as const, termPatterns: ['_source:Work_'], to: 'target' };
  const preview = await f.author({ ...input, dryRun: true });
  expect(preview.files.some((f) => f.after.includes('spec.procedure _Work_ in actions'))).toBe(
    true,
  );
  expect(await readFile(join(f.docs, 'source.trm'), 'utf8')).toBe(before);
  await f.author(input);
  expect(
    (await f.read({ operation: 'show', termPatterns: ['_target:Work_'] })).termDeclarations[0],
  ).toMatchObject({ termKind: 'spec.procedure', viewpoint: 'spec', group: 'actions' });
  await f.author({ operation: 'move', termPatterns: ['_target:Work_'], to: 'source' });
  expect(await readFile(join(f.docs, 'source.trm'), 'utf8')).toContain('spec.procedure _Work_');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});
