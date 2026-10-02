import { installedNames } from './skill-fixture.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  AtermApplication,
  AtermScanner,
  SkillInstallation,
  viewpointSource,
  type IKnowledgeResult,
  type ISkillResult,
} from '../src/index.js';
import { fixture } from './fixture.js';

test('Knowledge discovery retains empty Knowledges and counts one Term Declaration per Term', async () => {
  const f = await fixture();
  await f.write('docs/empty.trm', '@knowledge empty\n@viewpoints spec\n');
  await f.write(
    'docs/model.trm',
    '@knowledge model\n@viewpoints spec\n@scope {\n  Model operations.\n}\nconcept _Order_ in model.entities = { Order. }\nprocedure _Process_Order_ in model.actions = { Process order. }\n',
  );
  const app = await f.app();
  const list = (await app.query({ operation: 'knowledge-list' })) as IKnowledgeResult;
  expect(list.knowledges.map((k) => [k.id, k.termCount, k.termDeclarationCount])).toEqual([
    ['empty', 0, 0],
    ['model', 2, 2],
  ]);
  const view = (await app.query({
    operation: 'knowledge-view',
    knowledgeIds: ['m*', 'model'],
  })) as IKnowledgeResult;
  expect(view.knowledges).toHaveLength(1);
  expect(view.knowledges[0]?.scope?.content).toBe('Model operations.');
  expect(view.knowledges[0]?.termDeclarations.map((e) => e.group)).toEqual([
    'model.entities',
    'model.actions',
  ]);
  expect(
    (
      (await app.query({
        operation: 'knowledge-view',
        knowledgeIds: ['absent*'],
      })) as IKnowledgeResult
    ).knowledges,
  ).toEqual([]);
  await expect(
    app.query({ operation: 'knowledge-view', knowledgeIds: ['absent'] }),
  ).rejects.toThrow('Unknown Knowledge absent');
  await expect(app.query({ operation: 'knowledge-view' })).rejects.toThrow('requires at least one');
  await f.write(
    'docs/broken.trm',
    '@knowledge broken\n@viewpoints spec\nconcept _Broken_ = { _Missing_. }',
  );
  await expect(app.query({ operation: 'knowledge-view', knowledgeIds: ['empty'] })).rejects.toThrow(
    'Unresolved reference',
  );
});

test('Knowledge and corpus Skill reads use one supplied published scan while local reads remain fresh', async () => {
  const f = await fixture();
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  await f.write(
    '.aterm/aterm.yaml',
    config + '\n  skill: ' + join(viewpointSource, 'skill.md') + '\n',
  );
  const before =
    '@knowledge example\n@viewpoints skill\nskill _Skill_Read_ = {\n  Before.\n.description\n  Read before.\n.body\n  Before instructions.\n}\n';
  await f.write('docs/skill.trm', before);
  const local = await f.app();
  const scan = await new AtermScanner().scan(local.config);
  const snapshot = new AtermApplication(local.config, scan);
  await f.write(
    'docs/skill.trm',
    before.replaceAll('Before', 'After').replaceAll('before', 'after'),
  );
  const input = { operation: 'skill-view' as const, skillTerms: ['_example:Skill_Read_'] };
  expect(((await snapshot.query(input)) as ISkillResult).skills[0]?.markdown).toContain('Before.');
  expect(((await local.query(input)) as ISkillResult).skills[0]?.markdown).toContain('After.');
  await f.write('docs/new.trm', '@knowledge added\n@viewpoints spec\n');
  expect(
    ((await snapshot.query({ operation: 'knowledge-list' })) as IKnowledgeResult).knowledges.map(
      (k) => k.id,
    ),
  ).toEqual(['example']);
  expect(
    ((await local.query({ operation: 'knowledge-list' })) as IKnowledgeResult).knowledges.map(
      (k) => k.id,
    ),
  ).toEqual(['added', 'example']);
});
