import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './fixture.js';

const knowledgeSource = `@knowledge source
@viewpoints spec
concept _Source_ = {
  Source meaning.
}
concept _First_ = {
  First explanation.
.relations
  derived_from _Source_
}
concept _Second_ = {
  Second explanation.
.relations
  derived_from _Source_
}
concept _Shared_ = {
  Combined explanation.
.relations
  derived_from _First_
  derived_from _Second_
}
concept _Unrelated_ = { Unrelated. }
`;
async function setup() {
  const f = await fixture();
  await f.write('docs/source.trm', knowledgeSource);
  await f.write('docs/target.trm', '@knowledge target\n@viewpoints spec\n');
  return f;
}
const patch = (before = 'Source meaning.', after = 'Revised source meaning.') =>
  `*** Begin Patch\n*** Update Term: _source:Source_.definition\n@@\n-  ${before}\n+  ${after}\n*** End Patch`;

test('derived_from is nonstructural and reports transitive diamond impacts without modifying explanations', async () => {
  const f = await setup();
  const checked = await f.read({ operation: 'check' });
  expect(checked.diagnostics).toEqual([]);
  const graph = await f.read({ operation: 'relations', termPatterns: ['_source:Source_'] });
  expect(
    graph.edges
      .filter((e) => e.phrase === 'derived_from')
      .every((e) => e.type === 'derivation' && !e.structural),
  ).toBe(true);
  const before = await readFile(join(f.docs, 'source.trm'), 'utf8');
  const preview = await f.author({ operation: 'edit', patch: patch(), dryRun: true });
  expect(preview.derivedImpacts).toEqual(
    ['First', 'Second', 'Shared'].map((name) => ({
      term: `_source:${name}_`,
      sources: ['_source:Source_'],
    })),
  );
  expect(await readFile(join(f.docs, 'source.trm'), 'utf8')).toBe(before);
  const saved = await f.author({ operation: 'edit', patch: patch() });
  expect(saved.derivedImpacts).toEqual(preview.derivedImpacts);
  expect(await readFile(join(f.docs, 'source.trm'), 'utf8')).toBe(
    before.replace('Source meaning.', 'Revised source meaning.'),
  );
  expect(
    (
      await f.author({
        operation: 'edit',
        patch: patch('Revised source meaning.', 'Revised source meaning.'),
      })
    ).derivedImpacts,
  ).toEqual([]);
});

test.each(['rename', 'move', 'rename-knowledge'] as const)(
  '%s maps derivation impacts to the resulting identities in preview and save',
  async (operation) => {
    const f = await setup();
    const query =
      operation === 'move'
        ? { operation, termPatterns: ['_source:Source_'], to: 'target' }
        : operation === 'rename-knowledge'
          ? { operation, from: 'source', to: 'renamed' }
          : { operation, from: '_source:Source_', to: '_Origin_' };
    const preview = await f.author({ ...query, dryRun: true });
    const saved = await f.author(query);
    expect(saved.derivedImpacts).toEqual(preview.derivedImpacts);
    const source =
      operation === 'move'
        ? '_target:Source_'
        : operation === 'rename'
          ? '_source:Origin_'
          : '_renamed:Source_';
    const knowledge = operation === 'rename-knowledge' ? 'renamed' : 'source';
    expect(saved.derivedImpacts).toEqual(
      expect.arrayContaining(
        ['First', 'Second', 'Shared'].map((name) =>
          expect.objectContaining({
            term: `_${knowledge}:${name}_`,
            sources: expect.arrayContaining([source]),
          }),
        ),
      ),
    );
    expect(JSON.stringify(saved.derivedImpacts)).not.toContain('Unrelated');
    expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  },
);

test.each([
  'concept _A_ = {\n  A.\n.relations\n  derived_from _A_\n}',
  'concept _A_ = {\n  A.\n.relations\n  derived_from _B_\n}\nconcept _B_ = {\n  B.\n.relations\n  derived_from _A_\n}',
])('checking refuses self-derivation and cycles with source locations', async (body) => {
  const f = await fixture();
  await f.write('docs/source.trm', '@knowledge source\n@viewpoints spec\n' + body);
  const result = await f.read({ operation: 'check' });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      line: expect.any(Number),
      file: expect.stringContaining('source.trm'),
      message: expect.stringContaining('Derivation cycle'),
    }),
  );
});

test('an unchanged source in a multi-Term patch does not report false derived impacts', async () => {
  const f = await setup();
  const input = patch('Source meaning.', 'Source meaning.').replace(
    '*** End Patch',
    '*** Update Term: _source:Unrelated_\n@@\n-concept _Unrelated_ = { Unrelated. }\n+concept _Unrelated_ = { More unrelated detail. }\n*** End Patch',
  );
  const result = await f.author({ operation: 'edit', patch: input });
  expect(result.files).toHaveLength(1);
  expect(result.derivedImpacts).toEqual([]);
});
