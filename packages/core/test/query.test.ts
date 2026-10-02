import { expect, test } from 'vitest';
import { atermQuery, byText, localTerm } from '../src/index.js';
import { fixture } from './fixture.js';

const block = (name: string, body: string, targets: string[] = []) => {
  const [definition, ...sections] = body.split('\n---md');
  return `undecided ${name} = \`\`\`\`md\n  ${definition}${targets.length ? '\n.relations\n' + targets.map((target) => '  references ' + target).join('\n') : ''}${sections.map((section) => '\n---md' + section).join('')}\n\`\`\`\`\n`;
};

test('view includes transitive required context once, across files and sources', async () => {
  const f = await fixture();
  await f.write(
    'shared/GUIDE-required.trm',
    block('_B_', 'Guide source; _docs_spec_required:Leaf_† and _docs_spec_required:Root_†.', [
      '_docs_spec_required:Leaf_',
      '_docs_spec_required:Root_',
    ]),
  );
  await f.write(
    'docs/SPEC-required.trm',
    block(
      '_Root_',
      '_A_ and _Plain_.\n---md\n  - Read _A_†, _shared_guide_required:B_† and _Root_†.\n---md\n  _Remark_†',
      ['_A_', '_Plain_', '_shared_guide_required:B_', '_Remark_'],
    ) +
      block('_A_', 'Read _Leaf_†.', ['_Leaf_']) +
      block(
        '_Leaf_',
        'Leaf identity.\n---md\n  ```ts\n  interface Leaf {}\n  ```\n---md\n  Leaf explanation.',
      ) +
      block('_Plain_', 'Not required.') +
      block('_Remark_', 'Optional context; _RemarkLeaf_†.', ['_RemarkLeaf_']) +
      block('_RemarkLeaf_', 'Remark leaf.') +
      block('_Child_', 'Child uses _Plain_†.', ['_Plain_']),
  );
  const query = (operation: 'view' | 'show' | 'list', extra = {}) =>
    f.read({ operation, termPatterns: ['_Root_'], remarks: false, ...extra });
  const viewed = await query('view');
  expect(viewed.termDeclarations.map((d) => d.name)).toEqual(['_Root_', '_A_', '_B_', '_Leaf_']);
  expect(viewed.termDeclarations[2]?.definition).toContain('Guide source');
  expect(viewed.termDeclarations[2]?.viewpoint).toBe('guide');
  expect(viewed.termDeclarations[3]).toMatchObject({
    contractLanguage: 'md',
    contract: '```ts\ninterface Leaf {}\n```',
  });
  expect(viewed.termDeclarations.every((d) => d.sourceLines?.length && !d.remarks)).toBe(true);
  expect(viewed.edges).toContainEqual(
    expect.objectContaining({
      source: '_docs_spec_required:Root_',
      target: '_docs_spec_required:A_',
      section: 'contract',
      required: true,
    }),
  );
  expect((await query('show')).termDeclarations.map((d) => d.name)).toEqual(['_Root_']);
  expect((await query('list')).termDeclarations.map((d) => d.name)).toEqual(['_Root_']);
  const remarks = await query('view', { remarks: true });
  expect(remarks.termDeclarations.map((d) => d.name)).toEqual([
    '_Root_',
    '_A_',
    '_B_',
    '_Remark_',
    '_Leaf_',
    '_RemarkLeaf_',
  ]);
  expect(remarks.termDeclarations.find((d) => d.name === '_Leaf_')?.remarks).toBe(
    'Leaf explanation.',
  );
  const union = await query('view', { termPatterns: ['_Root_', '_L*', '_Root_'] });
  expect(union.termDeclarations.map((d) => d.name)).toEqual(['_Leaf_', '_Root_', '_A_', '_B_']);
  await f.write('docs/SPEC-invalid.trm', block('_MissingUser_', '_Missing_†', ['_Missing_']));
  await expect(query('view')).rejects.toThrow('Unresolved reference _docs_spec_invalid:Missing_');
  await f.write(
    'docs/SPEC-invalid.trm',
    '@knowledge docs_spec_required\n@viewpoints spec\n' + block('_A_', 'Duplicate.'),
  );
  await expect(query('view')).rejects.toThrow('Duplicate Knowledge docs_spec_required');
});

test('the Viewpoint comes from the @viewpoints line, never from the filename or a comment', async () => {
  const f = await fixture();
  const block = (name: string) =>
    '// Viewpoint: guide\n' + 'undecided ' + name + ' = ```md\n  Identity.\n```';
  await f.write('docs/SPEC-core.trm', '@viewpoints guide\n' + block('_GuideNamedButSpec_'));
  await f.write('docs/GUIDE-core.trm', block('_Instructions_'));
  const result = await f.read({ operation: 'view' });
  expect(Object.fromEntries(result.termDeclarations.map((d) => [d.name, d.viewpoint]))).toEqual({
    _GuideNamedButSpec_: 'guide',
    _Instructions_: 'guide',
  });
  const searched = await f.read({ operation: 'search', searchText: 'Identity' });
  expect(searched.matches?.map((m) => m.termDeclaration.viewpoint)).toEqual(
    result.termDeclarations.map((d) => d.viewpoint),
  );
  // A Knowledge without the line has no vocabulary, and that is an error, not a silent skip.
  await f.write('docs/ordinary.trm', block('_Unclassified_'));
  await expect(f.read({ operation: 'list' })).rejects.toThrow('no @viewpoints line');
  await f.write('docs/ordinary.trm', '@viewpoints nosuch\n' + block('_Unclassified_'));
  await expect(f.read({ operation: 'list' })).rejects.toThrow('Unbound Viewpoint nosuch');
});

test('reads every .trm under the sources, exclude outside directories, and handle Remarks selection', async () => {
  const f = await fixture();
  const block = (name: string, text: string) =>
    'undecided ' + name + ' = ```md\n  ' + text + '\n```\n';
  await f.write('shared/OTHER-shared.trm', block('_Shared_', 'A shared definition.'));
  await f.write(
    'docs/SPEC-core.trm',
    '// # Core entries\n' +
      block(
        '_Introduction_',
        'Uses _shared_other_shared:Shared_ and _docs_other_loose:Loose_.\n.relations\n  references _shared_other_shared:Shared_\n  references _docs_other_loose:Loose_',
      ),
  );
  await f.write('docs/OTHER-loose.trm', block('_Loose_', 'A classified custom definition.'));
  await f.write('docs/SPEC-old.specmd', block('_Introduction_', 'Ignored.'));
  await f.write('archive/SPEC-hidden.trm', block('_Introduction_', 'Ignored outside sources.'));
  const result = await f.read({ operation: 'check', roots: ['_Introduction_'] });
  expect(result.diagnostics).toEqual([]);
  expect(result.termDeclarations).toHaveLength(3);
  await f.write(
    'docs/OTHER-loose.trm',
    block('_Loose_', 'A classified custom definition.').replace(
      '\n```',
      '\n---md\n---md\n  Informative only.\n```',
    ),
  );
  const without = await f.read({ operation: 'show', termPatterns: ['_Loose_'], remarks: false });
  expect(without.termDeclarations[0]).not.toHaveProperty('remarks');
  const withRemarks = await f.read({ operation: 'show', termPatterns: ['_Loose_'] });
  expect(withRemarks.termDeclarations[0]?.remarks).toBe('Informative only.');
  const search = await f.read({ operation: 'search', searchText: 'Informative' });
  expect(search.matches?.[0]).toMatchObject({ section: 'remarks', text: 'Informative only.' });
  const none = await f.read({ operation: 'search', searchText: 'Informative', remarks: false });
  expect(none.matches).toEqual([]);
  await f.write('docs/OTHER-broken.trm', block('_Loose_', 'Uses _Missing_.'));
  await expect(f.read({ operation: 'show', termPatterns: ['_Introduction_'] })).rejects.toThrow(
    /Duplicate|Unresolved/,
  );
  const check = await f.read({ operation: 'check' });
  expect(check.diagnostics.map((d) => d.message).join('\n')).toMatch(
    /Unresolved reference _docs_other_broken:Missing_/,
  );
});

test('overview file selection resolves workspace-relative paths and globs against admitted Knowledges', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-one.trm',
    'undecided _One_ = {\n  One uses _docs_nested_spec_two:Two_.\n.relations\n  references _docs_nested_spec_two:Two_\n}\nundecided _Alone_ = {\n  Alone.\n}\n',
  );
  await f.write(
    'docs/nested/SPEC-two.trm',
    'undecided _Two_ = {\n  Two.\n.relations\n  feeds _Three_\n.contract\n}\nundecided _Three_ = {\n  Three uses _Two_.\n.relations\n  references _Two_\n}\n',
  );
  const map = async (files: string[]) => {
    const { conceptMap } = await f.read({ operation: 'overview', files });
    if (!conceptMap) throw new Error('Overview returned no concept map.');
    return conceptMap;
  };
  const one = await map(['docs/SPEC-one.trm']);
  expect(one.selected.map(localTerm)).toEqual(['_Alone_', '_One_']);
  expect(one.relations.filter((r) => r.source !== r.target)).toMatchObject([
    { source: '_docs_spec_one:One_', phrase: 'references', target: '_docs_nested_spec_two:Two_' },
  ]);
  expect((await map(['docs/**/SPEC-*.trm'])).selected.map(localTerm)).toEqual([
    '_Three_',
    '_Two_',
    '_Alone_',
    '_One_',
  ]);
  expect((await map(['docs/SPEC-none-*.trm'])).selected).toEqual([]);
  await expect(map(['docs/SPEC-missing.trm'])).rejects.toThrow(
    /Unknown Aterm file docs\/SPEC-missing.trm/,
  );
  await expect(f.read({ operation: 'overview' })).rejects.toThrow(/--file/);
});

async function searchSpace() {
  const f = await fixture();
  await f.write(
    'docs/SPEC-test.trm',
    'undecided _A_ = {\n  A uses _C_.\n.relations\n  produces _C_\n.contract\n}\nundecided _C_ = {\n  C uses _A_.\n.relations\n  references _A_\n}\n',
  );
  await f.write(
    'shared/GUIDE-test.trm',
    'undecided _B_ = {\n  B uses _docs_spec_test:A_ and _docs_spec_test:C_.\n.relations\n  references _docs_spec_test:A_\n  references _docs_spec_test:C_\n}\n',
  );
  return { ...f, query: f.read };
}

test('the Viewpoint search space filters both endpoints and intermediate Terms, exclusions win', async () => {
  const { query, write } = await searchSpace();
  expect(
    (
      await query({ operation: 'list', viewpoints: ['spec', 'guide'], excludeViewpoints: ['gu*'] })
    ).termDeclarations.map((d) => d.name),
  ).toEqual(['_A_', '_C_']);
  expect(
    (
      await query({ operation: 'search', searchText: 'uses', viewpoints: ['guide'] })
    ).termDeclarations.map((d) => d.name),
  ).toEqual(['_B_']);
  expect(
    (await query({ operation: 'list', viewpoints: ['spec'], excludeViewpoints: ['spec'] }))
      .termDeclarations,
  ).toEqual([]);
  await expect(
    query({ operation: 'connect', termPatterns: ['_A_', '_B_'], excludeViewpoints: ['guide'] }),
  ).rejects.toThrow('outside the search space');
  const throughGuide = {
    operation: 'connect' as const,
    termPatterns: ['_A_', '_C_'],
    edgeOrigins: ['relation' as const],
    excludeRelations: ['produces'],
  };
  await write(
    'docs/SPEC-test.trm',
    'undecided _A_ = {\n  A uses _C_.\n.relations\n  produces _C_\n.contract\n}\nundecided _C_ = {\n  C.\n}\n',
  );
  expect((await query(throughGuide)).conceptMap?.paths).toEqual([
    ['_docs_spec_test:A_', '_shared_guide_test:B_', '_docs_spec_test:C_'],
  ]);
  expect((await query({ ...throughGuide, viewpoints: ['spec'] })).conceptMap?.disconnected).toEqual(
    [['_docs_spec_test:A_', '_docs_spec_test:C_']],
  );
  const overview = await query({
    operation: 'overview',
    termPatterns: ['_A_'],
    excludeViewpoints: ['guide'],
  });
  expect(
    overview.conceptMap?.relations.every((r) => r.source !== '_B_' && r.target !== '_B_'),
  ).toBe(true);
});

test('Relation listing honors origin, phrase selectors and precedence before filters', async () => {
  const { query } = await searchSpace();
  const explicit = await query({ operation: 'relations', relationPhrases: ['produces'] });
  expect(explicit.termDeclarations).toEqual([]);
  expect(explicit.relations).toMatchObject([
    { source: '_docs_spec_test:A_', phrase: 'produces', target: '_docs_spec_test:C_' },
  ]);
  const references = await query({
    operation: 'relations',
    edgeOrigins: ['reference'],
    excludeRelations: ['produces'],
  });
  expect(
    references.relations?.some(
      (r) => r.source === '_docs_spec_test:A_' && r.target === '_docs_spec_test:C_',
    ),
  ).toBe(false);
  expect(
    references.relations?.some(
      (r) => r.source === '_docs_spec_test:C_' && r.target === '_docs_spec_test:A_',
    ),
  ).toBe(false);
  expect(
    (
      await query({
        operation: 'relations',
        termPatterns: ['_C_'],
        relationPhrases: ['references'],
      })
    ).relations,
  ).toHaveLength(2);
  expect(
    (
      await query({
        operation: 'relations',
        relationPhrases: ['produces'],
        excludeRelations: ['produces'],
      })
    ).relations,
  ).toEqual([]);
  expect((await query({ operation: 'relations', termPatterns: ['_Nothing*'] })).relations).toEqual(
    [],
  );
});

test('filters never hide corpus errors; path honors the search space; the query schema rejects misuse', async () => {
  const { query, write } = await searchSpace();
  expect((await query({ operation: 'list', viewpoints: ['spec'] })).diagnostics).toEqual([]);
  expect(
    (await query({ operation: 'path', from: '_B_', to: '_C_', excludeRelations: ['references'] }))
      .paths,
  ).toEqual([]);
  await expect(
    query({ operation: 'path', from: '_B_', to: '_C_', excludeViewpoints: ['guide'] }),
  ).rejects.toThrow('outside the search space');
  expect(
    (await query({ operation: 'connect', termPatterns: ['_A_', '_C_'] })).conceptMap?.paths,
  ).toHaveLength(2);
  expect(
    (await query({ operation: 'connect', termPatterns: ['_A_', '_C_'], limit: 1 })).conceptMap
      ?.paths,
  ).toHaveLength(1);
  expect(() => atermQuery.parse({ operation: 'connect', limit: 0 })).toThrow();
  // One rule for every field: an operation that does not use it refuses it and names who does.
  const refused = atermQuery.safeParse({ operation: 'list', limit: 1 });
  expect(refused.success).toBe(false);
  if (!refused.success) expect(refused.error.issues[0]?.path).toEqual(['limit']);
  expect(() => atermQuery.parse({ operation: 'list', limit: 1 })).toThrow(
    'Operation list does not accept limit; discover, connect does.',
  );
  expect(() => atermQuery.parse({ operation: 'format', viewpoints: ['spec'] })).toThrow(
    'does not accept viewpoints',
  );
  // A Viewpoint selection restricts a skill's composition; the search space exclusions never do.
  expect(() => atermQuery.parse({ operation: 'skill-view', viewpoints: ['spec'] })).toThrow();
  expect(() => atermQuery.parse({ operation: 'skill-view', excludeViewpoints: ['spec'] })).toThrow(
    'does not accept excludeViewpoints',
  );
  expect(() => atermQuery.parse({ operation: 'viewpoint', termPatterns: ['spec'] })).toThrow(
    'does not accept termPatterns',
  );
  expect(() => atermQuery.parse({ operation: 'show', relationPhrases: ['names'] })).toThrow(
    'does not accept relationPhrases',
  );
  expect(() => atermQuery.parse({ operation: 'show', unreferenced: true })).toThrow(
    'Operation show does not accept unreferenced; list does.',
  );
  expect(() => atermQuery.parse({ operation: 'grep', commit: 'HEAD' })).toThrow(
    'does not accept commit',
  );
  await expect(query({ operation: 'list', limit: 1 })).rejects.toThrow('does not accept limit');
  await write(
    'docs/SPEC-bad.trm',
    'undecided _Bad_ = {\n  Uses _Missing_.\n.relations\n  references _Missing_\n}\n',
  );
  await expect(query({ operation: 'list', viewpoints: ['guide'] })).rejects.toThrow('Unresolved');
});

test('required context carries each owning Knowledge scope through reads and authoring', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-scope.trm',
    '@viewpoints spec\n@scope {\n  Define behavior.\n}\nconcept _Root_ = {\n  Needs _shared_guide_scope:Leaf_†.\n.relations\n  references _shared_guide_scope:Leaf_\n}\n',
  );
  await f.write(
    'shared/GUIDE-scope.trm',
    '@viewpoints guide\n@scope {\n  Explain usage.\n}\nconcept _Leaf_ = { Context. }\n',
  );
  const viewed = await f.read({ operation: 'view', termPatterns: ['_Root_'], remarks: false });
  expect(viewed.termDeclarations.map((termDeclaration) => termDeclaration.scope?.content)).toEqual([
    'Define behavior.',
    'Explain usage.',
  ]);
  expect(viewed.termDeclarations.map((termDeclaration) => termDeclaration.line)).toEqual([6, 6]);
  await f.author({ operation: 'rename', from: '_Leaf_', to: '_Context_' });
  const renamed = await f.read({ operation: 'view', termPatterns: ['_Root_'] });
  expect(renamed.termDeclarations.map((termDeclaration) => termDeclaration.scope?.content)).toEqual(
    ['Define behavior.', 'Explain usage.'],
  );
});

test('one ordering for every presented result: code unit, and the same in list and relations', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-order.trm',
    [
      '@viewpoints spec',
      'undecided _Search_ = {',
      '  Uses _Zed_.',
      '.relations',
      '  reads _Zed_',
      '}',
      'undecided _SearchSpace_ = {',
      '  Uses _Zed_.',
      '.relations',
      '  reads _Zed_',
      '}',
      'undecided _Zed_ = { A target. }',
    ].join('\n'),
  );
  // `_SearchSpace_` precedes `_Search_` because `S` precedes `_`; English collation reverses it.
  const listed = (await f.read({ operation: 'list' })).termDeclarations.map(
    (termDeclaration) => termDeclaration.name,
  );
  expect(listed).toEqual([...listed].sort(byText));
  expect(listed.indexOf('_SearchSpace_')).toBeLessThan(listed.indexOf('_Search_'));
  const sources = (await f.read({ operation: 'relations' })).relations!.map((r) =>
    localTerm(r.source),
  );
  expect(sources.indexOf('_SearchSpace_')).toBeLessThan(sources.indexOf('_Search_'));
});

test('semantic query fields cannot be substituted across operations or use retired aliases', async () => {
  const f = await fixture();
  await f.write(
    'docs/SPEC-fields.trm',
    'concept _Target_ = { A literal needle. }\nconcept _Owner_ = {\n  Uses _Target_.\n.relations\n  references _Target_\n}',
  );
  expect(
    (
      await f.read({ operation: 'search', searchText: 'needle', termPatterns: ['_Target_'] })
    ).termDeclarations.map((e) => e.name),
  ).toEqual(['_Target_']);
  expect(
    (
      await f.read({ operation: 'grep', referencePattern: '_Tar*', termPatterns: ['_Owner_'] })
    ).occurrences?.map((o) => localTerm(o.term)),
  ).toEqual(['_Owner_', '_Owner_']);
  for (const query of [
    { operation: 'search', referencePattern: '_Target_' },
    { operation: 'grep', searchText: 'needle' },
    { operation: 'changes', termPatterns: ['docs/*'] },
    { operation: 'skill-view', termPatterns: ['modeling'] },
    { operation: 'viewpoint', skillTerms: ['spec'] },
    { operation: 'view', patterns: ['_Target_'] },
    { operation: 'search', text: 'needle' },
  ])
    expect(atermQuery.safeParse(query).success).toBe(false);
});

test('Viewpoint selectors use bound exact names and globs consistently across operations', async () => {
  const f = await fixture();
  await f.write('docs/SPEC-one.trm', 'concept _One_ = { One. }');
  const app = await f.app();
  const result = await app.query({ operation: 'viewpoint', viewpoints: ['sp*', 'spec'] });
  expect('viewpoints' in result && result.viewpoints.map((v) => v.name)).toEqual(['spec']);
  await expect(
    app.query({ operation: 'skill-view', skillTerms: ['modeling'], viewpoints: ['sp*'] }),
  ).rejects.toThrow('does not accept');
  expect(
    (await f.read({ operation: 'list', viewpoints: ['sp*'] })).termDeclarations.map((e) => e.name),
  ).toEqual(['_One_']);
  // A bound vocabulary with no Term Declarations is still a valid selector.
  expect((await f.read({ operation: 'list', viewpoints: ['other'] })).termDeclarations).toEqual([]);
  for (const operation of ['list', 'viewpoint'] as const) {
    await expect(
      app.query({
        operation,
        viewpoints: ['absent'],
      }),
    ).rejects.toThrow('Unknown Viewpoint absent');
    const empty = await app.query({
      operation,
      viewpoints: ['absent*'],
    });
    if ('termDeclarations' in empty) expect(empty.termDeclarations).toEqual([]);
    if ('viewpoints' in empty) expect(empty.viewpoints).toEqual([]);
  }
  await expect(app.query({ operation: 'list', excludeViewpoints: ['absent'] })).rejects.toThrow(
    'Unknown Viewpoint absent',
  );
});
