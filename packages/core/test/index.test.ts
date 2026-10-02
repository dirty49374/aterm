import { expect, test } from 'vitest';
import {
  AtermParser,
  ConceptMap,
  TermDeclarationGraph,
  TermDeclarationIndex,
  localTerm,
} from '../src/index.js';

const file = (name: string, body = 'A source repository.', remarks = '') =>
  `undecided ${localTerm(name)} = \`\`\`md\n  ${body}\n${remarks ? '---md\n---md\n  ' + remarks + '\n' : ''}\`\`\``;
const fragments = (texts: string[]) => indexOf(texts.join('\n'));

test('prefixes do not infer ownership', () => {
  const index = fragments([file('_test:Root_'), file('_test:Root_Child_')]);
  expect(index.diagnostics).toEqual([]);
  expect(index.select(['_test:Root_']).map((d) => d.id)).toEqual(['_test:Root_']);
});

test('list filters names; search includes Remarks unless explicitly excluded', () => {
  const index = fragments([
    file('_test:Project_', 'A source repository.', 'Allows recreation.'),
    file('_test:Project_Interface_'),
  ]);
  expect(index.list(['*Interface*']).map((definition) => definition.id)).toEqual([
    '_test:Project_Interface_',
  ]);
  expect(index.search('SOURCE')).toHaveLength(2);
  expect(index.search('recreation', false)).toEqual([]);
  expect(index.search('recreation')[0]?.section).toBe('remarks');
  expect(() => index.get('_project_')).toThrow('Unknown Term Declaration');
});

test('selects exact names and globs consistently, with deterministic deduplication', () => {
  const index = fragments([
    file('_test:Project_'),
    file('_test:Project_Interface_'),
    file('_test:Other_'),
  ]);
  expect(index.select(['_P?oject_*', '_test:Other_', '_test:Project_']).map((d) => d.id)).toEqual([
    '_test:Other_',
    '_test:Project_',
    '_test:Project_Interface_',
  ]);
  expect(index.select(['_{Project,Other}_'])).toHaveLength(2);
  expect(index.select(['_[OP]*_'])).toHaveLength(3);
  expect(index.select(['*project*'])).toEqual([]);
  expect(() => index.select(['_test:Missing_', '*'])).toThrow('Unknown Term Declaration');
});

test('diagnoses duplicate symbols and unresolved references including Remarks', () => {
  const index = fragments([
    file('_test:Project_'),
    file('_test:Project_'),
    file('_test:Other_', 'Uses _project_.', 'See _test:Missing_.'),
  ]);
  expect(index.diagnostics).toHaveLength(5);
  const messages = index.diagnostics.map((diagnostic) => diagnostic.message).join('\n');
  expect(messages).toContain('Duplicate Term _test:Project_');
  expect(messages).toContain('Unresolved reference _test:project_');
  expect(messages).toContain('Unresolved reference _test:Missing_');
});

test('accepts forward and mutual references without inferring inheritance or execution cycles', () => {
  const index = fragments([
    declaration('_test:Left_', ['references _test:Right_'], 'Uses _test:Right_.'),
    declaration('_test:Right_', ['references _test:Left_'], 'Uses _test:Left_.'),
  ]);
  expect(index.diagnostics).toEqual([]);
});

test('enumerates paths in BFS order without cycles or duplicate edge-kind paths', () => {
  const graph = new TermDeclarationGraph(
    fragments([
      file('_test:Introduction_', 'Uses _test:A_ and _test:B_.'),
      file('_test:A_', 'Uses _test:B_ and _test:Target_.'),
      file('_test:B_', 'Uses _test:A_ and _test:Target_.'),
      file('_test:Target_', 'Uses _test:Introduction_.'),
      file('_test:Alone_', 'Disconnected.'),
    ]),
  );
  expect(graph.paths('_test:Introduction_', '_test:Target_')).toEqual([
    ['_test:Introduction_', '_test:A_', '_test:Target_'],
    ['_test:Introduction_', '_test:B_', '_test:Target_'],
    ['_test:Introduction_', '_test:A_', '_test:B_', '_test:Target_'],
    ['_test:Introduction_', '_test:B_', '_test:A_', '_test:Target_'],
  ]);
  expect(graph.paths('_test:Introduction_', '_test:Introduction_')).toEqual([
    ['_test:Introduction_'],
  ]);
  expect(graph.paths('_test:Introduction_', '_test:Alone_')).toEqual([]);
  expect(graph.paths('_test:Absent_', '_test:Target_')).toEqual([]);
});

test('limits BFS paths to ten and keeps shorter paths ahead of longer alternatives', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => `_test:Branch${String(i).padStart(2, '0')}_`);
  const graph = new TermDeclarationGraph(
    fragments([
      file('_test:Introduction_', nodes.join(' ') + ' _test:Target_'),
      ...nodes.map((name) => file(name, 'Uses _test:Target_.')),
      file('_test:Target_', 'Uses _test:Introduction_.'),
    ]),
  );
  expect(graph.paths('_test:Introduction_', '_test:Target_')).toEqual([
    ['_test:Introduction_', '_test:Target_'],
    ...nodes.slice(0, 9).map((name) => ['_test:Introduction_', name, '_test:Target_']),
  ]);
});

test('retains explicit reference locations without inferring prefix edges', () => {
  const index = fragments([
    file('_test:A_B_C_', 'A field.'),
    file('_test:A_B_', 'Uses _test:A_.'),
    file('_test:A_', 'Uses _test:A_B_ and _test:A_B_.', 'See _test:Other_.'),
    file('_test:Other_', 'Other concept.'),
  ]);
  const graph = new TermDeclarationGraph(index);
  expect(graph.outgoing('_test:A_', false).map(({ target, origin }) => [target, origin])).toEqual([
    ['_test:A_B_', 'explicit'],
  ]);
  expect(graph.outgoing('_test:A_')[0]?.locations).toHaveLength(2);
  expect(
    graph.outgoing('_test:A_', true).find((edge) => edge.target === '_test:Other_'),
  ).toMatchObject({
    section: 'remarks',
    locations: [{ file: 'test.trm', line: 12 }],
  });
  expect(graph.incoming('_test:A_B_C_')).toEqual([]);
  expect(graph.incoming('_test:A_')).toMatchObject([{ source: '_test:A_B_', origin: 'explicit' }]);
});

test('finds unreachable cycles although only Introduction is unreferenced; self references do not count', () => {
  const index = fragments([
    file('_test:Introduction_', 'Uses _test:Project_.'),
    file('_test:Project_', 'Uses _test:Project_Field_.'),
    file('_test:Project_Field_', 'Uses _test:Project_.'),
    file('_test:A_', 'Uses _test:B_.'),
    file('_test:B_', 'Uses _test:A_.'),
  ]);
  const graph = new TermDeclarationGraph(index);
  expect(graph.unreferenced().map((definition) => definition.id)).toEqual(['_test:Introduction_']);
  expect(graph.unreachableFrom(['_test:Introduction_']).map((definition) => definition.id)).toEqual(
    ['_test:A_', '_test:B_'],
  );
  expect(graph.unreachableFrom(['_test:Introduction_', '_test:A_'])).toEqual([]);
  const self = new TermDeclarationGraph(fragments([file('_test:Self_', 'Uses _test:Self_.')]));
  expect(self.unreferenced().map((definition) => definition.id)).toEqual(['_test:Self_']);
  expect(() => graph.unreachableFrom(['_test:Missing_'])).toThrow('Unknown Term Declaration');
  expect(() => graph.unreachableFrom(['_Missing*'])).toThrow('No root Terms');
});

test('Remarks-only references establish default coverage but not normative-only coverage', () => {
  const graph = new TermDeclarationGraph(
    fragments([
      file('_test:Introduction_', 'A system.', 'Uses _test:Hidden_.'),
      file('_test:Hidden_', 'A concept.'),
    ]),
  );
  expect(
    graph.unreachableFrom(['_test:Introduction_'], false).map((definition) => definition.id),
  ).toEqual(['_test:Hidden_']);
  expect(graph.unreachableFrom(['_test:Introduction_'])).toEqual([]);
  expect(graph.unreferenced(false)).toHaveLength(2);
  expect(graph.unreferenced()).toHaveLength(1);
});

const declaration = (
  name: string,
  relations: string[] = [],
  definition = 'Identity.',
  remarks = '',
) =>
  `concept ${localTerm(name)} = {\n  ${definition}${relations.length ? '\n.relations\n' + relations.map((r) => '  ' + r).join('\n') : ''}\n.remarks\n  ${remarks}\n}\n`;
const indexOf = (text: string) =>
  new TermDeclarationIndex([new AtermParser().parse('test.trm', '@knowledge test\n' + text)]);

test('owned assertions normalize spaces and tabs and retain every occurrence location', () => {
  const index = indexOf(
    declaration('_test:A_', ['projects\t_B_', 'projects _test:B_', 'supplies\tinput to _test:B_']) +
      declaration('_test:B_'),
  );
  expect(index.diagnostics).toEqual([]);
  expect(index.relations.map((r) => r.phrase)).toEqual([
    'projects',
    'projects',
    'supplies input to',
  ]);
  const graph = new TermDeclarationGraph(index);
  expect(graph.outgoing('_test:A_').find((e) => e.phrase === 'projects')?.locations).toHaveLength(
    2,
  );
  expect(graph.incoming('_test:B_').map((e) => e.origin)).toEqual(['relation', 'relation']);
  expect(index.relations[0]).toMatchObject({
    source: '_test:A_',
    target: '_test:B_',
    file: 'test.trm',
    line: 5,
  });
});

test('invalid phrase, foreign source and unresolved target are diagnosed; ordinary prose is not a Relation', () => {
  for (const r of [
    '_test:B_',
    'one two three four five six _test:B_',
    'names! _test:B_',
    'names _test:B_ trailing',
    '_test:B_ names _test:A_',
  ])
    expect(
      indexOf(declaration('_test:A_', [r]) + declaration('_test:B_')).diagnostics.length,
    ).toBeGreaterThan(0);
  expect(
    indexOf(declaration('_test:A_', ['names _test:Missing_'])).diagnostics.some((d) =>
      d.message.includes('_test:Missing_'),
    ),
  ).toBe(true);
  expect(
    indexOf(declaration('_test:A_', [], 'names _test:B_') + declaration('_test:B_')).relations,
  ).toEqual([]);
});

test('connect selects deterministic cycle-free alternatives and three-Term paths in either direction', () => {
  const branches = ['_test:B_', '_test:C_', '_test:D_', '_test:E_', '_test:F_', '_test:G_'];
  const index = indexOf(
    declaration(
      '_test:A_',
      branches.map((n) => `feeds ${n}`),
    ) +
      branches
        .map((n) =>
          declaration(n, ['feeds _test:Z_', ...(n === '_test:B_' ? ['feeds _test:C_'] : [])]),
        )
        .join('') +
      declaration('_test:Z_') +
      declaration('_test:Alone_'),
  );
  const map = new ConceptMap(index);
  expect(map.connect(['_test:A_', '_test:Z_'], ['relation']).paths).toEqual(
    branches.slice(0, 5).map((n) => ['_test:A_', n, '_test:Z_']),
  );
  const paths = map.connect(['_test:A_', '_test:Z_'], ['relation'], true, 20).paths!;
  expect(paths.map((p) => p.length)).toEqual([3, 3, 3, 3, 3, 3, 4, 4]);
  expect(paths.every((p) => new Set(p).size === p.length)).toBe(true);
  expect(map.connect(['_test:Z_', '_test:A_'], ['relation'], true, 1).paths).toEqual([
    ['_test:Z_', '_test:B_', '_test:A_'],
  ]);
  expect(map.connect(['_test:A_', '_test:Alone_']).disconnected).toEqual([
    ['_test:A_', '_test:Alone_'],
  ]);
  for (const limit of [0, -1, 1.5, NaN, Infinity])
    expect(() => map.connect(['_test:A_', '_test:Z_'], undefined, true, limit)).toThrow(
      'positive integer',
    );
  expect(() => map.connect(['_test:A_', '_test:Missing_'])).toThrow('Unknown');
  expect(() => map.connect(['_test:A_', '_test:A_'])).toThrow('distinct');
});

test('explicit Relations replace only the same directed generic reference and do not manufacture self edges', () => {
  const index = indexOf(
    declaration('_test:A_', ['produces _test:B_', 'configures _test:B_'], 'Uses _test:B_†.') +
      declaration('_test:B_', [], 'Uses _test:A_.'),
  );
  const map = new ConceptMap(index);
  expect(map.overview(['_test:A_']).relations.map((r) => [r.source, r.phrase, r.target])).toEqual([
    ['_test:A_', 'configures', '_test:B_'],
    ['_test:A_', 'produces', '_test:B_'],
    ['_test:B_', 'references', '_test:A_'],
  ]);
  expect(
    map.overview(['_test:A_'], ['reference']).relations.map((r) => [r.source, r.target]),
  ).toEqual([['_test:B_', '_test:A_']]);
  expect(
    new TermDeclarationGraph(index).requiredContext(index.get('_test:A_')).map((d) => d.id),
  ).toEqual(['_test:A_', '_test:B_']);
});

test('file discovery retains every selected Term, external endpoints, bounds and Remarks filtering', () => {
  const p = new AtermParser();
  const index = new TermDeclarationIndex([
    p.parse(
      'one.trm',
      '@knowledge test\n' +
        declaration('_test:Root_', ['owns _test:Child_']) +
        declaration('_test:Child_') +
        declaration('_test:Alone_') +
        declaration('_test:Uses_', [], 'Uses _far:Far_.'),
    ),
    p.parse(
      'two.trm',
      '@knowledge far\n' + declaration('_far:Far_', [], 'Far.', 'See _test:Root_.'),
    ),
  ]);
  const map = new ConceptMap(index);
  const result = map.overview([], undefined, true, ['one.trm']);
  expect(result.selected).toEqual(['_test:Alone_', '_test:Child_', '_test:Root_', '_test:Uses_']);
  expect(result.relations.map((r) => [r.source, r.phrase, r.target])).toEqual([
    ['_test:Root_', 'owns', '_test:Child_'],
    ['_far:Far_', 'references', '_test:Root_'],
    ['_test:Uses_', 'references', '_far:Far_'],
  ]);
  expect(map.connect(['_far:Far_', '_test:Root_'], ['reference'], false).disconnected).toEqual([
    ['_far:Far_', '_test:Root_'],
  ]);
  expect(() => map.overview([])).toThrow('requires');
  const large = new ConceptMap(
    indexOf(Array.from({ length: 101 }, (_, i) => declaration(`_N${i}_`)).join('')),
  );
  expect(() => large.overview(['*'])).toThrow('100');
  expect(large.overview([], undefined, true, ['test.trm']).terms).toHaveLength(101);
});

test('a dagger after the Relation target marks a required reference and stays out of the target', () => {
  const index = indexOf(
    'concept _KindFilter_ = {\n  A filter.\n.relations\n  is a _test:SearchFilter_†\n}\nconcept _SearchFilter_ = { A general filter. }\n',
  );
  expect(index.diagnostics).toEqual([]);
  expect(index.relations.map((r) => [r.source, r.phrase, r.target])).toEqual([
    ['_test:KindFilter_', 'is a', '_test:SearchFilter_'],
  ]);
  expect(index.relations[0]?.required).toBe(true);
  expect(
    new TermDeclarationGraph(index)
      .requiredContext(index.get('_test:KindFilter_'))
      .map((d) => d.id),
  ).toEqual(['_test:KindFilter_', '_test:SearchFilter_']);
});
