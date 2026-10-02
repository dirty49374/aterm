import { packagedSkills } from './skill-fixture.js';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import {
  AtermConfigReader,
  WorkspaceFiles,
  AtermApplication,
  SourceAuthoring,
  SkillCatalog,
  installedViewpoints,
  viewpointSource,
} from '../src/index.js';
import { GuidanceCatalog } from '../src/skill-module/guidance-catalog.js';
import { fixture } from './fixture.js';

const hidden = 'sources: [docs]\nuseViewpoints: []\nuseDefaultKnowledge: false\n';

test('built-in Viewpoint selection is explicit, ordered and independent of Knowledge inclusion', async () => {
  expect(await readdir(viewpointSource)).toEqual(
    expect.arrayContaining(installedViewpoints.map((name) => name + '.md')),
  );
  expect((await readdir(viewpointSource)).filter((name) => name.endsWith('.md')).sort()).toEqual([
    'domain.md',
    'generic.md',
    'skill.md',
    'specification.md',
  ]);
  const f = await fixture(
    'sources: [docs]\nuseViewpoints: [specification, generic, specification]\n',
  );
  let app = await f.app();
  expect(app.config.viewpoints.map((v) => v.name)).toEqual(['specification', 'generic']);
  expect(app.config.viewpoints.every((v) => v.readOnly)).toBe(true);
  await f.write(
    'docs/item.trm',
    '@knowledge item\n@viewpoints domain\nentity _Item_ = { A project subject. }\n',
  );
  expect((await f.read({ operation: 'check' })).diagnostics[0]?.message).toContain(
    'Unbound Viewpoint domain',
  );
  await f.write(
    '.aterm/aterm.yaml',
    'sources: [docs]\nuseViewpoints: [domain]\nuseDefaultKnowledge: false\n',
  );
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  app = await f.app();
  for (const yaml of [
    'useViewpoints: [ui]',
    'useViewpoints: specification',
    'useDefaultKnowledge: "false"',
    'allowDefaultWrites: "true"',
    'defaultTerms: false',
    'skills: { source: newskill }',
  ]) {
    await f.write('.aterm/aterm.yaml', 'sources: [docs]\n' + yaml + '\n');
    await expect(new AtermConfigReader().read(app.home)).rejects.toThrow(
      yaml.startsWith('defaultTerms') ? 'renamed to useDefaultKnowledge' : 'aterm.yaml',
    );
  }
});

test('hidden default Knowledge and Viewpoints remain available only through guidance operations', async () => {
  const f = await fixture(hidden);
  let app = await f.app();
  expect(app.config.viewpoints).toEqual([]);
  expect((await f.read({ operation: 'list' })).termDeclarations).toEqual([]);
  expect(await app.query({ operation: 'knowledge-list' })).toMatchObject({ knowledges: [] });
  expect(await app.query({ operation: 'viewpoint' })).toMatchObject({ viewpoints: [] });
  expect(await app.query({ operation: 'skill-list' })).toMatchObject({
    skills: expect.arrayContaining([
      {
        term: expect.any(String),
        description: expect.any(String),
        prerequisites: expect.any(Array),
        hasReminder: expect.any(Boolean),
      },
    ]),
  });
  const list = await app.query({ operation: 'skill-list' });
  expect('skills' in list && list.skills).toHaveLength(packagedSkills.length);
  const id = '_aterm_skills:Corpus_Reading_Skill_';
  for (const operation of ['skill-toc', 'skill-view', 'skill-remind'] as const) {
    const result = await app.query({ operation, skillTerms: [id] });
    expect('skills' in result && result.skills[0]?.markdown).toContain(id);
  }
  expect(await new SkillCatalog().read(app.config)).toHaveLength(packagedSkills.length);
  expect(
    await app.query({
      operation: 'graphql',
      graphql: { query: '{ terms { totalCount } knowledges { totalCount } }' },
    }),
  ).toMatchObject({
    response: { data: { terms: { totalCount: 0 }, knowledges: { totalCount: 0 } } },
  });
  // Reading private guidance never enables it in ordinary corpus operations.
  expect((await f.read({ operation: 'list' })).termDeclarations).toEqual([]);
});

test('custom Viewpoint bindings override built-ins; deleting an override also deselects the built-in', async () => {
  const f = await fixture('sources: [docs]\nuseViewpoints: [generic]\n');
  const app = await f.app();
  const author = new SourceAuthoring(app.home);
  const source = await readFile(join(viewpointSource, 'generic.md'), 'utf8');
  const before = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  for (const dryRun of [true, false]) {
    await expect(
      author.execute({ operation: 'viewpoint-edit', name: 'generic', text: source, dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      author.execute({ operation: 'viewpoint-delete', name: 'generic', dryRun }),
    ).rejects.toThrow('read-only');
  }
  expect(await readFile(join(f.home, 'aterm.yaml'), 'utf8')).toBe(before);
  await f.write('.aterm/local.md', source.replace('# Generic', '# Custom Generic'));
  await f.write('.aterm/aterm.yaml', before + 'viewpoints: { generic: ./local.md }\n');
  expect((await f.app()).config.viewpoints).toMatchObject([
    { name: 'generic', path: join(f.home, 'local.md') },
  ]);
  expect((await f.app()).config.viewpoints[0]?.readOnly).toBeUndefined();
  await author.execute({ operation: 'viewpoint-delete', name: 'generic' });
  expect((await f.app()).config.viewpoints).toEqual([]);
  expect(await readFile(join(viewpointSource, 'generic.md'), 'utf8')).toBe(source);
});

test('explicit package bindings and raw writes share the opt-in protection', async () => {
  const source = join(viewpointSource, 'generic.md');
  const f = await fixture(hidden + `viewpoints: { generic: ${JSON.stringify(source)} }\n`);
  let app = await f.app();
  expect(app.config.allowDefaultWrites).toBe(false);
  expect(app.config.viewpoints[0]?.readOnly).toBe(true);
  const before = await readFile(source, 'utf8');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  // The package lives inside this Workspace; only the Home configuration is isolated.
  const raw = new WorkspaceFiles({ ...app.home, workspace: repo });
  const knowledge = fileURLToPath(new URL('../docs/vending-machine.trm', import.meta.url));
  for (const path of [source, knowledge]) {
    for (const operation of ['file-write', 'file-delete'] as const) {
      await expect(
        raw.execute({ operation, path: relative(repo, path), text: 'changed', dryRun: true }),
      ).rejects.toThrow('allowDefaultWrites');
    }
  }
  await f.write(
    '.aterm/aterm.yaml',
    hidden + `allowDefaultWrites: true\nviewpoints: { generic: ${JSON.stringify(source)} }\n`,
  );
  app = await f.app();
  expect(app.config.viewpoints[0]?.readOnly).toBeUndefined();
  for (const path of [source, knowledge]) {
    expect(
      await raw.execute({
        operation: 'file-write',
        path: relative(repo, path),
        text: 'changed',
        dryRun: true,
      }),
    ).toMatchObject({ saved: false, dryRun: true, after: 'changed' });
  }
  expect(await readFile(source, 'utf8')).toBe(before);
});

test('package write opt-in permits guarded semantic previews without changing catalog origin', async () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const homePath = await mkdtemp(join(repo, '.aterm-write-test-'));
  const home = {
    home: homePath,
    workspace: repo,
    configPath: join(homePath, 'aterm.yaml'),
    origin: 'option' as const,
  };
  const knowledge = fileURLToPath(new URL('../docs/vending-machine.trm', import.meta.url));
  const viewpoint = join(viewpointSource, 'generic.md');
  const knowledgeText = await readFile(knowledge, 'utf8');
  const viewpointText = await readFile(viewpoint, 'utf8');
  const configText = 'sources: [packages/core/docs]\nuseDefaultKnowledge: false\n';
  const author = new SourceAuthoring(home);
  try {
    await writeFile(home.configPath, configText);
    const requests = [
      {
        operation: 'knowledge-edit' as const,
        name: 'vending_machine',
        text: knowledgeText + '\n',
        dryRun: true,
      },
      {
        operation: 'viewpoint-edit' as const,
        name: 'generic',
        text: viewpointText + '\n',
        dryRun: true,
      },
      {
        operation: 'knowledge-create' as const,
        name: 'protection_trial',
        path: 'packages/core/docs/protection-trial.trm',
        text: '@knowledge protection_trial\n@viewpoints generic\nterm _Subject_ = { A temporary preview. }\n',
        dryRun: true,
      },
    ];
    for (const request of requests)
      await expect(author.execute(request)).rejects.toThrow('read-only');
    await writeFile(home.configPath, configText + 'allowDefaultWrites: true\n');
    for (const request of requests)
      expect(await author.execute(request)).toMatchObject({ saved: false, dryRun: true });
    const app = await AtermApplication.open({ home: homePath, cwd: repo, env: {} });
    const catalog = await new GuidanceCatalog().read(app.config, () => app.scan());
    expect(
      catalog.sources.filter((s) => s.termDeclarations.length).every((s) => s.origin === 'package'),
    ).toBe(true);
    expect(await readFile(knowledge, 'utf8')).toBe(knowledgeText);
    expect(await readFile(viewpoint, 'utf8')).toBe(viewpointText);
  } finally {
    await rm(homePath, { recursive: true, force: true });
  }
});
