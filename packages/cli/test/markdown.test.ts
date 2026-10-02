import { expect, test } from 'vitest';
import { fixture } from '../../core/test/fixture.js';
import { CliOutput, outputSelection } from '../src/presentation-module/output.js';
import type { AtermResult } from '@agent-workshop/aterm-core';
import { AtermParser, AtermSchema, TermDeclarationProjection } from '@agent-workshop/aterm-core';

function render(result: AtermResult, options = {}): string {
  let text = '';
  new CliOutput(
    { output: 'markdown' },
    {
      stdout: (chunk) => {
        text += chunk;
      },
      stderr: () => {},
    },
  ).result(result, options);
  return text;
}

test('Markdown reads preserve authored text and end in two blank lines', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-test.trm',
    '@knowledge example\n@viewpoints spec\n@scope {\n  Scope text.\n}\nconcept _Slot_ in inventory.parts = {\n  Holds one _Product_.\n.relations\n  contains _Product_\n.contract\n  - Keep stock positive.\n.remarks\n  A note.\n}\nconcept _Product_ = { A product. }\n',
  );
  const result = await f.read({ operation: 'show', termPatterns: ['_Slot_'] });
  const before = JSON.stringify(result);
  expect(render(result)).toBe(
    '## concept _Slot_\n\nHolds one _Product_.\n\n### relations\n\n- contains _Product_\n\n### contract\n\n- Keep stock positive.\n\n### remarks\n\nA note.\n\n\n',
  );
  expect(JSON.stringify(result)).toBe(before);
  expect(render(result, { section: 'contract' })).toBe('- Keep stock positive.\n\n\n');
  expect(
    render(
      { ...result, warnings: [{ file: 'ignored.trm', line: 1, message: 'Ignored.' }] },
      { section: 'contract' },
    ),
  ).toBe('- Keep stock positive.\n\n\n');
  expect(
    render(await f.read({ operation: 'show', termPatterns: ['_Slot_'], remarks: false })),
  ).not.toContain('### remarks');
  expect(render(result, { withFileline: true })).toContain('Source: ');
});

test('several Knowledges use qualified headings and selected expansion resources are not duplicated', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    '@knowledge one\n@viewpoints spec\nconcept _Same_ = {\n  _two:Same_.definition†\n.relations\n  references _two:Same_\n}\n',
  );
  await f.write(
    'docs/SPEC-two.trm',
    '@knowledge two\n@viewpoints spec\nconcept _Same_ = { Other identity. }\n',
  );
  const result = await f.read({ operation: 'show', termPatterns: ['*'] });
  const output = render(result);
  expect(output).toContain('## concept _one:Same_\n\nOther identity.');
  expect(output).toContain('## concept _two:Same_\n\nOther identity.');
  expect(output.match(/^## concept /gm)).toHaveLength(2);
});

test('nested cross-Knowledge section expansion inserts content at every occurrence without wrappers', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-root.trm',
    '@knowledge root\n@viewpoints spec\nconcept _Apply_ = {\n  Apply.\n.relations\n  references _rules:Custom_Rule_\n.contract\n\n  ## Apply _rules:Custom_Rule_\n\n  _rules:Custom_Rule_.contract†\n\n  Again:\n\n  _rules:Custom_Rule_.contract†\n}\n',
  );
  await f.write(
    'docs/SPEC-rules.trm',
    '@knowledge rules\n@viewpoints spec\nconcept _Custom_Rule_ = {\n  Rule.\n.relations\n  references _Naming_\n.contract\n  - Use canonical names.\n\n  _Naming_.contract†\n.remarks\n  Not included.\n}\nconcept _Naming_ = {\n  Naming.\n.contract\n  - Reuse the existing name.\n}\n',
  );
  for (const operation of ['show', 'view'] as const) {
    const result = await f.read({ operation, termPatterns: ['_Apply_'] });
    const markdown = render(result, { section: 'contract' });
    expect(markdown).toBe(
      '## Apply _rules:Custom_Rule_\n\n- Use canonical names.\n\n- Reuse the existing name.\n\nAgain:\n\n- Use canonical names.\n\n- Reuse the existing name.\n\n\n',
    );
    expect(result.termDeclarations).toHaveLength(1);
    expect(result.termDeclarations[0]!.contract).toContain('_rules:Custom_Rule_.contract†');
    expect(result.sectionContext).toHaveLength(2);
  }
});

test('Markdown respects opaque code, empty sections and excluded Remarks', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-test.trm',
    '@knowledge example\n@viewpoints spec\nconcept _Apply_ = {\n  Apply.\n.relations\n  references _Rule_\n.contract\n  ```md\n  _Missing_.contract†\n  ```\n\n  _Rule_.contract†\n\n  _Rule_.remarks†\n}\nconcept _Rule_ = {\n  Rule.\n.contract\n.remarks\n  A note.\n}\n',
  );
  const result = await f.read({ operation: 'show', termPatterns: ['_Apply_'], remarks: false });
  const text = render(result, { section: 'contract' });
  expect(text).toBe('```md\n_Missing_.contract†\n```\n\n\n');
});

test('output selectors accept Markdown consistently and reject mixed formats', () => {
  expect(outputSelection({ output: ['markdown', 'markdown'] })).toBe('markdown');
  expect(() => outputSelection({ output: ['markdown', 'json'] })).toThrow('Conflicting output');
});

test('opaque sections stay fenced, even when transcluded content contains backticks', () => {
  const schema = new AtermSchema('Code', [
    { name: 'definition', type: 'md' },
    { name: 'body', type: 'ts' },
  ]);
  const parsed = new AtermParser([
    { name: 'resource', description: 'Code', viewpoint: 'test', schema },
  ]).parse(
    'test.trm',
    '@knowledge example\nresource _Apply_ = {\n  _Code_.body†\n.relations\n  references _Code_\n}\nresource _Code_ = {\n  Code.\n.body\n  const fence = "```";\n}\n',
  );
  expect(parsed.diagnostics).toEqual([]);
  const termDeclarations = new TermDeclarationProjection().file(parsed).termDeclarations;
  const result = {
    operation: 'show' as const,
    termDeclarations: [termDeclarations[0]!],
    sectionContext: termDeclarations,
    files: [],
    edges: [],
    diagnostics: [],
    includeRemarks: true,
  };
  expect(render(result, { section: 'definition' })).toBe(
    '````ts\nconst fence = "```";\n````\n\n\n',
  );
});

test('Markdown listing, hierarchy, Relations, search, checks and paths keep command meaning', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-test.trm',
    '@knowledge example\n@viewpoints spec\nconcept _Slot_ in machine.parts = {\n  Holds _Product_.\n.relations\n  contains _Product_\n}\nconcept _Product_ = { A product. }\n'.replace(
      '= {\n  Holds _Product_.\n',
      '= {\n  Holds _Product_.\n',
    ),
  );
  expect(render(await f.read({ operation: 'list' }))).toMatch(
    /\| Term\s+\| Term Kind\s+\| Viewpoint\s+\|/,
  );
  expect(render(await f.read({ operation: 'list' }), { tree: true })).toContain(
    '  - machine (1)\n    - parts (1)\n      - concept _Slot_',
  );
  expect(render(await f.read({ operation: 'relations' }))).toContain(
    '| _example:Slot_ | contains | _example:Product_ |',
  );
  expect(render(await f.read({ operation: 'search', searchText: 'Holds' }))).toContain(
    'Holds _Product_.',
  );
  expect(render(await f.read({ operation: 'check' }))).toContain('No diagnostics.');
  expect(render(await f.read({ operation: 'path', from: '_Slot_', to: '_Product_' }))).toContain(
    '_example:Slot_ → _example:Product_',
  );
});
