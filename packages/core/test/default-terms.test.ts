import { packagedSkills } from './skill-fixture.js';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  AtermApplication,
  AtermInitialization,
  AtermScanner,
  SourceAuthoring,
  SkillCatalog,
  shippedConfig,
  type ITermDeclarationResult,
  type IKnowledgeResult,
  type ISkillResult,
  type IAtermEditResult,
  type IDiscoveryResult,
} from '../src/index.js';
import { AtermSnapshot } from '../src/server-module/snapshot.js';

async function setup() {
  const workspace = await mkdtemp(join(tmpdir(), 'aterm-defaults-'));
  const created = await new AtermInitialization().create(workspace);
  const config = parse(await readFile(created.configPath, 'utf8'));
  delete config.server;
  delete config.skills;
  const save = () => writeFile(created.configPath, stringify(config));
  await save();
  const app = () => AtermApplication.open({ cwd: workspace, env: {} });
  return { workspace, config, save, app, configPath: created.configPath };
}

test('default Knowledge appears in ordinary reads without copying or changing sources', async () => {
  const f = await setup();
  delete f.config.useDefaultKnowledge;
  await f.save();
  const before = await readFile(f.configPath, 'utf8');
  const app = await f.app();
  expect(app.config.useDefaultKnowledge).toBe(true);
  expect(app.config.sources).toEqual([join(f.workspace, 'docs')]);
  const knowledges = (await app.query({ operation: 'knowledge-list' })) as IKnowledgeResult;
  expect(knowledges.knowledges.map((k) => k.id)).toEqual([
    'aterm',
    'aterm_skills',
    'vending_machine',
  ]);
  const term = (await app.query({
    operation: 'view',
    termPatterns: ['_aterm:Term_'],
  })) as ITermDeclarationResult;
  expect(term.termDeclarations.map((e) => e.id)).toContain('_aterm:Term_');
  expect(
    ((await app.query({ operation: 'list', knowledge: 'aterm' })) as ITermDeclarationResult)
      .termDeclarations.length,
  ).toBeGreaterThan(100);
  expect(((await app.query({ operation: 'check' })) as ITermDeclarationResult).diagnostics).toEqual(
    [],
  );
  const graph = await app.query({ operation: 'overview', termPatterns: ['_aterm:Term_'] });
  expect(JSON.stringify(graph)).toContain('_aterm:Term_');
  expect(await readFile(f.configPath, 'utf8')).toBe(before);
  await expect(readFile(join(f.workspace, 'docs/aterm.trm'), 'utf8')).rejects.toThrow();
  const scan = await app.scan();
  expect(scan.trmFiles.every((trmFile) => trmFile.readOnly)).toBe(true);
});

test('useDefaultKnowledge false hides ordinary Knowledge but preserves complete Skill operations', async () => {
  const f = await setup();
  f.config.useDefaultKnowledge = false;
  await f.save();
  const app = await f.app();
  expect(
    ((await app.query({ operation: 'list' })) as ITermDeclarationResult).termDeclarations,
  ).toEqual([]);
  expect(
    ((await app.query({ operation: 'knowledge-list' })) as IKnowledgeResult).knowledges,
  ).toEqual([]);
  const list = (await app.query({ operation: 'skill-list' })) as ISkillResult;
  expect(list.skills).toHaveLength(packagedSkills.length);
  for (const operation of ['skill-view', 'skill-remind', 'skill-toc'] as const) {
    const result = (await app.query({
      operation,
      skillTerms: ['_aterm_skills:Runtime_Management_Skill_'],
    })) as ISkillResult;
    expect(result.skills[0]?.markdown).toContain('_aterm_skills:Runtime_Management_Skill_');
  }
  expect(await new SkillCatalog().read(app.config)).toHaveLength(packagedSkills.length);
  await writeFile(
    join(f.workspace, 'docs/duplicate.trm'),
    '@knowledge project\n@viewpoints specification\nconcept _Same_ = { Same. }\nprocedure _Same_ = { Operate. }\n',
  );
  await expect((await f.app()).query({ operation: 'skill-list' })).rejects.toThrow(
    'Duplicate Term',
  );
});

test('project references use default Knowledge; guidance retains those references after opting out', async () => {
  const f = await setup();
  await writeFile(
    join(f.workspace, 'docs/project.trm'),
    `@knowledge project
@viewpoints specification skill
concept _Subject_ = {
  A project use of _aterm:Term_.
.relations
  references _aterm:Term_
}
skill _Read_Subject_ = {
  Read a project subject.
.relations
  requires _aterm_skills:Corpus_Reading_Skill_
.description
  Use when reading project subjects.
.body
  Read the requested subject.
}
`,
  );
  expect(
    ((await (await f.app()).query({ operation: 'check' })) as ITermDeclarationResult).diagnostics,
  ).toEqual([]);
  const formatted = (await (
    await f.app()
  ).query({ operation: 'format', dryRun: true })) as IAtermEditResult;
  expect(formatted.files.every((file) => file.path === 'docs/project.trm')).toBe(true);
  f.config.useDefaultKnowledge = false;
  await f.save();
  const app = await f.app();
  expect(
    ((await app.query({ operation: 'check' })) as ITermDeclarationResult).diagnostics.some((d) =>
      d.message.includes('Unresolved'),
    ),
  ).toBe(true);
  const result = (await app.query({
    operation: 'skill-view',
    skillTerms: ['_project:Read_Subject_'],
  })) as ISkillResult;
  expect(result.skills[0]?.markdown).toContain('Read the requested subject.');
  expect(result.skills[0]?.prerequisites).toContain('_aterm_skills:Corpus_Reading_Skill_');
});

test('implicit package writes refuse before saving either package or project files', async () => {
  const f = await setup();
  const path = join(f.workspace, 'docs/project.trm');
  const text =
    '@knowledge project\n@viewpoints specification domain\nconcept _Subject_ = {\n  Subject.\n.relations\n  references _aterm:Term_\n}\n';
  await writeFile(path, text);
  const app = await f.app();
  const pkg = (await app.scan()).trmFiles.find((d) => d.parsed?.knowledge === 'aterm')!;
  const author = new SourceAuthoring(app.home);
  for (const dryRun of [true, false]) {
    await expect(
      app.query({ operation: 'rename', from: '_aterm:Term_', to: '_Library_Term_', dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      app.query({ operation: 'rename-knowledge', from: 'aterm', to: 'library', dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      app.query({ operation: 'move', termPatterns: ['_aterm:Term_'], to: 'project', dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      app.query({ operation: 'move', termPatterns: ['_project:Subject_'], to: 'aterm', dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      app.query({
        operation: 'edit',
        patch:
          '*** Begin Patch\n*** Update Term: _aterm:Term_.definition\n@@\n+  Added text.\n*** End Patch',
        dryRun,
      }),
    ).rejects.toThrow('read-only');
    await expect(
      author.execute({ operation: 'knowledge-edit', name: 'aterm', text: pkg.text, dryRun }),
    ).rejects.toThrow('read-only');
    await expect(
      author.execute({ operation: 'knowledge-delete', name: 'aterm', dryRun }),
    ).rejects.toThrow('read-only');
  }
  await expect(
    author.execute({
      operation: 'knowledge-create',
      name: 'aterm',
      path: 'docs/duplicate.trm',
      text: pkg.text,
    }),
  ).rejects.toThrow('already exists');
  expect(await readFile(path, 'utf8')).toBe(text);
  expect(await readFile(pkg.absolutePath, 'utf8')).toBe(pkg.text);
});

test('package vocabulary remains independent of Home bindings and participates in query filters', async () => {
  const f = await setup();
  f.config.viewpoints = {};
  await f.save();
  const app = await f.app();
  expect(
    ((await app.query({ operation: 'list', viewpoints: ['skill'] })) as ITermDeclarationResult)
      .termDeclarations.length,
  ).toBeGreaterThan(0);
  const result = (await app.query({
    operation: 'discover',
    question: 'guidance',
    searchMode: 'lexical',
    searchSections: ['explanation'],
  })) as IDiscoveryResult;
  expect(result.candidates.length).toBeGreaterThan(0);
  expect(((await app.query({ operation: 'check' })) as ITermDeclarationResult).diagnostics).toEqual(
    [],
  );
});

test('explicit package sources stay protected until opted in, deduplicate and honor candidate deletion', async () => {
  const f = await setup();
  const packaged = await shippedConfig();
  f.config.sources.push(...packaged.sources);
  await f.save();
  const scanner = new AtermScanner();
  expect((await scanner.scan((await f.app()).config)).trmFiles.every((file) => file.readOnly)).toBe(
    true,
  );
  f.config.allowDefaultWrites = true;
  await f.save();
  const config = (await f.app()).config;
  const scan = await scanner.scan(config);
  expect(scan.trmFiles).toHaveLength(3);
  expect(scan.trmFiles.every((trmFile) => !trmFile.readOnly)).toBe(true);
  const file = scan.trmFiles.find((d) => d.parsed?.knowledge === 'aterm')!;
  expect(
    (await scanner.scan(config, new Map([[file.absolutePath, null]]))).trmFiles.some(
      (d) => d.absolutePath === file.absolutePath,
    ),
  ).toBe(false);
  f.config.useDefaultKnowledge = false;
  await f.save();
  expect(
    ((await (await f.app()).query({ operation: 'list' })) as ITermDeclarationResult)
      .termDeclarations.length,
  ).toBeGreaterThan(100);
  f.config.useDefaultKnowledge = true;
  f.config.sources = ['docs'];
  await f.save();
  await writeFile(
    join(f.workspace, 'docs/conflict.trm'),
    '@knowledge aterm\n@viewpoints specification\nconcept _Other_ = { Other. }\n',
  );
  expect(
    (
      (await (await f.app()).query({ operation: 'check' })) as ITermDeclarationResult
    ).diagnostics.some((d) => d.message.includes('Duplicate Knowledge aterm')),
  ).toBe(true);
});

test('published snapshots toggle default Terms while packaged guidance remains available', async () => {
  const f = await setup();
  const snapshot = new AtermSnapshot((await f.app()).home);
  await snapshot.start();
  try {
    const before = await snapshot.currentApplication();
    expect(
      ((await snapshot.query({ operation: 'list' })) as ITermDeclarationResult).termDeclarations
        .length,
    ).toBeGreaterThan(100);
    f.config.useDefaultKnowledge = false;
    await f.save();
    await snapshot.refreshNow();
    expect(
      ((await snapshot.query({ operation: 'list' })) as ITermDeclarationResult).termDeclarations,
    ).toEqual([]);
    expect(
      ((await before.query({ operation: 'list' })) as ITermDeclarationResult).termDeclarations
        .length,
    ).toBeGreaterThan(100);
    expect(
      ((await snapshot.query({ operation: 'skill-list' })) as ISkillResult).skills,
    ).toHaveLength(packagedSkills.length);
    f.config.useDefaultKnowledge = true;
    await f.save();
    await snapshot.refreshNow();
    expect(
      ((await snapshot.query({ operation: 'knowledge-list' })) as IKnowledgeResult).knowledges,
    ).toHaveLength(3);
  } finally {
    await snapshot.close();
  }
});
