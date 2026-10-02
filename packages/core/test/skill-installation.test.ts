import { installedNames, installedPaths, packagedSkillNames } from './skill-fixture.js';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  SkillInstallation,
  skillManifestName,
  viewpointSource,
  defaultConfigText,
  SkillCatalog,
} from '../src/index.js';
import { FileAccess } from '../src/file-module/index.js';
import { fixture } from './fixture.js';

const knowledgeSource = (
  name: string,
  description = 'Use when naming API elements.',
) => `@viewpoints skill
skill _${name}_ = {
  Perform a named task.
.description
  ${description}
.body
  Read the input and return the result.
}
`;
async function setup() {
  const f = await fixture();
  const config = await readFile(join(f.home, 'aterm.yaml'), 'utf8');
  await f.write(
    '.aterm/aterm.yaml',
    config + '\n  skill: ' + join(viewpointSource, 'skill.md') + '\n',
  );
  await f.write('docs/SKILLS.trm', knowledgeSource('Api_Design'));
  const directory = join(f.home, 'skills');
  await mkdir(directory);
  const installer = new SkillInstallation();
  const options = { cwd: f.workspace, env: {} };
  return { f, directory, installer, options, manifest: join(directory, skillManifestName) };
}

test('install exposes authored descriptions and bound pointers with a manifest; repeat install refuses', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  const result = await installer.install(options);
  expect(result.added.map((path) => path.slice(directory.length + 1))).toEqual(
    installedPaths('docs-skills-api-design'),
  );
  const text = await readFile(join(directory, 'docs-skills-api-design/SKILL.md'), 'utf8');
  expect(parse(text.split('---')[1]!)).toEqual({
    name: 'docs-skills-api-design',
    description: 'Use when naming API elements.',
  });
  expect(text).not.toContain('Read the input and return the result.');
  expect(text).toContain('## Skill reading');
  expect(
    await readFile(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'), 'utf8'),
  ).toContain('aterm skill view');
  const general = await readFile(
    join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'),
    'utf8',
  );
  expect(parse(general.split('---')[1]!)).toMatchObject({
    name: 'aterm-skills-aterm-basics-skill',
    description: expect.stringContaining('Use before Aterm work'),
  });
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    version: 2,
    home: f.home,
    pending: false,
    files: expect.arrayContaining([
      expect.objectContaining({
        name: 'aterm-skills-aterm-basics-skill',
        term: '_aterm_skills:Aterm_Basics_Skill_',
      }),
      expect.objectContaining({
        name: 'docs-skills-api-design',
        term: '_docs_skills:Api_Design_',
      }),
    ]),
  });
  await expect(installer.install(options)).rejects.toThrow('skill update');
});

test('update syncs descriptions, additions, removals and missing pointers from recorded Home; uninstall needs no source', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  await installer.install(options);
  await f.write(
    'docs/SKILLS.trm',
    knowledgeSource('Api_Design', 'Use when designing public contracts.') +
      knowledgeSource('Naming').replace('@viewpoints skill\n', ''),
  );
  const other = await fixture();
  const updated = await installer.update({
    home: f.home,
    cwd: other.workspace,
    env: { ATERM_HOME: other.home },
  });
  expect(updated.added).toEqual([join(directory, 'docs-skills-naming/SKILL.md')]);
  expect(updated.updated).toEqual([join(directory, 'docs-skills-api-design/SKILL.md')]);
  expect((await installer.update(options)).unchanged).toHaveLength(packagedSkillNames.length + 2);
  await rm(join(directory, 'docs-skills-api-design/SKILL.md'));
  expect((await installer.update(options)).added).toEqual([
    join(directory, 'docs-skills-api-design/SKILL.md'),
  ]);
  await writeFile(join(directory, 'docs-skills-api-design/notes.md'), 'keep me');
  await mkdir(join(directory, 'other'));
  await writeFile(join(directory, 'other/SKILL.md'), 'not managed');
  await f.write('docs/SKILLS.trm', knowledgeSource('Naming'));
  expect((await installer.update(options)).removed).toEqual([
    join(directory, 'docs-skills-api-design/SKILL.md'),
  ]);
  expect(await readFile(join(directory, 'docs-skills-api-design/notes.md'), 'utf8')).toBe(
    'keep me',
  );
  await rm(join(f.home, 'aterm.yaml'));
  await rm(f.docs, { recursive: true });
  await expect(installer.update(options)).rejects.toThrow('Missing');
  const removed = await installer.uninstall(options);
  expect(removed.removed).toHaveLength(packagedSkillNames.length + 1);
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(directory, 'other/SKILL.md'), 'utf8')).toBe('not managed');
  expect(await readFile(join(directory, 'docs-skills-api-design/notes.md'), 'utf8')).toBe(
    'keep me',
  );
  await expect(installer.uninstall(options)).rejects.toThrow('No installation manifest');
});

test('unmanaged collisions and modified managed files fail before any pointer or manifest changes', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  await mkdir(join(directory, 'aterm-skills-aterm-basics-skill'));
  await writeFile(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'), 'user pointer');
  await expect(installer.install(options)).rejects.toThrow('Unmanaged or modified');
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(lstat(join(directory, 'docs-skills-api-design/SKILL.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await rm(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'));
  await installer.install(options);
  const before = await readFile(manifest, 'utf8');
  const original = await readFile(join(directory, 'docs-skills-api-design/SKILL.md'), 'utf8');
  await writeFile(join(directory, 'docs-skills-api-design/SKILL.md'), original + '\nuser edit');
  await f.write('docs/SKILLS.trm', knowledgeSource('New'));
  for (const action of [() => installer.update(options), () => installer.uninstall(options)])
    await expect(action()).rejects.toThrow('Unmanaged or modified');
  expect(await readFile(manifest, 'utf8')).toBe(before);
  expect(await readFile(join(directory, 'docs-skills-api-design/SKILL.md'), 'utf8')).toBe(
    original + '\nuser edit',
  );
  await expect(lstat(join(directory, 'docs-skills-new/SKILL.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('invalid discovery metadata, duplicate export names and invalid corpus cannot partially install', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  for (const text of [
    knowledgeSource('A', 'x'.repeat(1025)),
    knowledgeSource('A').replace('.description', '.remarks'),
    knowledgeSource('A'.repeat(65)),
    knowledgeSource('A') +
      knowledgeSource('A').replace('@viewpoints skill\n', '').replace('_Skill_A_', '_A_'),
    knowledgeSource('A', 'Use _Unknown_.'),
  ]) {
    await f.write('docs/SKILLS.trm', text);
    await expect(installer.install(options)).rejects.toThrow();
    await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

test('symlink targets and unsafe manifest paths are refused without deleting outside files', async () => {
  const { directory, installer, options, manifest } = await setup();
  const outside = await mkdtemp(join(tmpdir(), 'aterm-unowned-'));
  await writeFile(join(outside, 'SKILL.md'), 'outside');
  await symlink(outside, join(directory, 'docs-skills-api-design'));
  await expect(installer.install(options)).rejects.toThrow('Symlink');
  await rm(join(directory, 'docs-skills-api-design'));
  await installer.install(options);
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  data.files[0].path = '../SKILL.md';
  await writeFile(manifest, JSON.stringify(data));
  await expect(installer.uninstall(options)).rejects.toThrow('Invalid installation manifest');
  expect(await readFile(join(outside, 'SKILL.md'), 'utf8')).toBe('outside');
});

test('a write failure retains ownership of partial output and update recovers from the journal', async () => {
  const { f, directory, options, manifest } = await setup();
  await f.write(
    'docs/SKILLS.trm',
    knowledgeSource('Alpha') + knowledgeSource('Zeta').replace('@viewpoints skill\n', ''),
  );
  const access = new FileAccess();
  const write = access.write.bind(access);
  let failed = false;
  vi.spyOn(access, 'write').mockImplementation(async (...args) => {
    if (!failed && args[0].endsWith('/docs-skills-zeta/SKILL.md')) {
      failed = true;
      throw new Error('simulated disk failure');
    }
    return write(...args);
  });
  const installer = new SkillInstallation(access);
  await expect(installer.install(options)).rejects.toThrow('Manifest retained');
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(true);
  expect(await readFile(join(directory, 'docs-skills-alpha/SKILL.md'), 'utf8')).toContain(
    'name: docs-skills-alpha',
  );
  await installer.update(options);
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(false);
  expect(await readFile(join(directory, 'docs-skills-zeta/SKILL.md'), 'utf8')).toContain(
    'name: docs-skills-zeta',
  );
  await installer.uninstall(options);
  await expect(lstat(join(directory, 'docs-skills-alpha/SKILL.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('a moved manifest cannot select a different source Home and missing manifests refuse', async () => {
  const { directory, installer, options, manifest } = await setup();
  await expect(installer.update(options)).rejects.toThrow('No installation manifest');
  await installer.install(options);
  const other = await fixture();
  await mkdir(join(other.home, 'skills'));
  await writeFile(join(other.home, 'skills', skillManifestName), await readFile(manifest));
  await expect(installer.update({ home: other.home })).rejects.toThrow('bound to manifest Home');
  await expect(installer.uninstall({ home: other.home })).rejects.toThrow('bound to manifest Home');
});

async function configure(
  f: Awaited<ReturnType<typeof fixture>>,
  commands: { sync: string; uninstall: string } | undefined,
) {
  const path = join(f.home, 'aterm.yaml');
  const config = parse(await readFile(path, 'utf8'));
  if (commands) config.skills = commands;
  else delete config.skills;
  await writeFile(path, stringify(config));
}

const capture = `node -e 'const fs = require("fs"); const e = process.env;
fs.appendFileSync("commands.jsonl", JSON.stringify({cwd:process.cwd(), home:e.ATERM_HOME,
 directory:e.ATERM_SKILLS_DIR, operation:e.ATERM_SKILL_OPERATION,
 names:e.ATERM_SKILL_NAMES, removed:e.ATERM_REMOVED_SKILL_NAMES}) + "\\n");
console.log("child stdout"); console.error("child stderr");'`;

test('commands run after local sync with exact environment; uninstall uses the stored command without config or corpus', async () => {
  const { f, installer, options, directory, manifest } = await setup();
  await configure(f, {
    sync: 'test -f "$ATERM_SKILLS_DIR/aterm-skills-aterm-basics-skill/SKILL.md"\n' + capture,
    uninstall: capture,
  });
  const first = await installer.install(options);
  expect(first.command).toEqual({
    kind: 'sync',
    stdout: 'child stdout\n',
    stderr: 'child stderr\n',
  });
  await f.write('docs/SKILLS.trm', knowledgeSource('Naming'));
  const other = await fixture();
  await installer.update({ cwd: other.workspace, home: f.home, env: { ATERM_HOME: other.home } });
  await installer.update(options);
  await rm(join(f.home, 'aterm.yaml'));
  await rm(f.docs, { recursive: true });
  const last = await installer.uninstall(options);
  expect(last.command?.kind).toBe('uninstall');
  const calls = (await readFile(join(f.workspace, 'commands.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.map(({ names, removed, operation }) => ({ names, removed, operation }))).toEqual([
    {
      names: installedNames('docs-skills-api-design').join('\n'),
      removed: '',
      operation: 'install',
    },
    {
      names: installedNames('docs-skills-naming').join('\n'),
      removed: 'docs-skills-api-design',
      operation: 'update',
    },
    { names: installedNames('docs-skills-naming').join('\n'), removed: '', operation: 'update' },
    { names: '', removed: installedNames('docs-skills-naming').join('\n'), operation: 'uninstall' },
  ]);
  for (const call of calls)
    expect(call).toMatchObject({ cwd: f.workspace, home: f.home, directory });
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('failed Bash sync preserves stale deployment names across retry and refuses disabling commands', async () => {
  const { f, installer, options, manifest } = await setup();
  await configure(f, { sync: capture, uninstall: capture });
  await installer.install(options);
  await f.write('docs/SKILLS.trm', knowledgeSource('Naming'));
  await configure(f, {
    sync: 'printf "failed output"; printf "failed error" >&2; false | true',
    uninstall: capture,
  });
  await expect(installer.update(options)).rejects.toThrow(
    /exit 1[\s\S]*failed outputfailed error[\s\S]*Manifest retained/,
  );
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    pending: true,
    deployed: installedNames('docs-skills-api-design', 'docs-skills-naming'),
  });
  await configure(f, undefined);
  await expect(installer.update(options)).rejects.toThrow('Restore skills commands');
  await configure(f, { sync: capture, uninstall: capture });
  await installer.update(options);
  const calls = (await readFile(join(f.workspace, 'commands.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.at(-1)).toMatchObject({
    names: installedNames('docs-skills-naming').join('\n'),
    removed: 'docs-skills-api-design',
  });
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    pending: false,
    deployed: installedNames('docs-skills-naming'),
  });
});

test('uninstall command failure retains all deployment names and retries with already missing pointers', async () => {
  const { f, installer, options, directory, manifest } = await setup();
  await configure(f, {
    sync: capture,
    uninstall: 'if [[ ! -f allow-uninstall ]]; then exit 7; fi\n' + capture,
  });
  await installer.install(options);
  await expect(installer.uninstall(options)).rejects.toThrow('exit 7');
  await expect(
    lstat(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    pending: true,
    deployed: installedNames('docs-skills-api-design'),
  });
  await rm(join(f.home, 'aterm.yaml'));
  await writeFile(join(f.workspace, 'allow-uninstall'), '');
  const result = await installer.uninstall(options);
  expect(result.removed).toEqual([]);
  expect(result.command?.kind).toBe('uninstall');
  const calls = (await readFile(join(f.workspace, 'commands.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.at(-1)).toMatchObject({
    names: '',
    removed: installedNames('docs-skills-api-design').join('\n'),
  });
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('default commands select only managed names and project-scoped Claude Code and Codex', async () => {
  const { f, installer, options, directory } = await setup();
  await configure(f, parse(defaultConfigText).skills);
  const bin = join(f.workspace, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'npx'),
    `#!/usr/bin/env node
require('fs').appendFileSync('npx.jsonl', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),names:process.env.ATERM_SKILL_NAMES,removed:process.env.ATERM_REMOVED_SKILL_NAMES})+'\\n');
`,
  );
  await chmod(join(bin, 'npx'), 0o755);
  const local = { ...options, env: { PATH: bin + ':' + process.env.PATH } };
  await installer.install(local);
  // An unrelated generated-directory Skill must never be passed to the external installer.
  await mkdir(join(directory, 'unmanaged'));
  await writeFile(join(directory, 'unmanaged/SKILL.md'), 'unmanaged');
  await f.write('docs/SKILLS.trm', knowledgeSource('Naming'));
  await installer.update(local);
  await installer.uninstall(local);
  const calls = (await readFile(join(f.workspace, 'npx.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(calls.map((call) => call.args)).toEqual([
    [
      '--yes',
      '--package',
      'skills',
      '--call',
      'skills add "$ATERM_SKILLS_DIR" --skill $ATERM_SKILL_NAMES --agent claude-code codex --yes',
    ],
    [
      '--yes',
      '--package',
      'skills',
      '--call',
      'skills remove --skill $ATERM_REMOVED_SKILL_NAMES --yes',
    ],
    [
      '--yes',
      '--package',
      'skills',
      '--call',
      'skills add "$ATERM_SKILLS_DIR" --skill $ATERM_SKILL_NAMES --agent claude-code codex --yes',
    ],
    [
      '--yes',
      '--package',
      'skills',
      '--call',
      'skills remove --skill $ATERM_REMOVED_SKILL_NAMES --yes',
    ],
  ]);
  expect(calls.map(({ names, removed }) => ({ names, removed }))).toEqual([
    { names: installedNames('docs-skills-api-design').join('\n'), removed: '' },
    { names: installedNames('docs-skills-naming').join('\n'), removed: 'docs-skills-api-design' },
    { names: installedNames('docs-skills-naming').join('\n'), removed: 'docs-skills-api-design' },
    { names: '', removed: installedNames('docs-skills-naming').join('\n') },
  ]);
  for (const call of calls) expect(call.cwd).toBe(f.workspace);
  expect(await readFile(join(directory, 'unmanaged/SKILL.md'), 'utf8')).toBe('unmanaged');
});

test('invalid skills config fails before pointer changes; reading config never runs commands', async () => {
  const { f, installer, options, manifest } = await setup();
  const config = parse(await readFile(join(f.home, 'aterm.yaml'), 'utf8'));
  for (const skills of [
    { sync: 'true' },
    { sync: ' ', uninstall: 'true' },
    { sync: 'true', uninstall: 3 },
    { sync: 'true', uninstall: 'true', install: 'true' },
    { source: 'unknown' },
  ]) {
    await writeFile(join(f.home, 'aterm.yaml'), stringify({ ...config, skills }));
    await expect(installer.install(options)).rejects.toThrow('skills');
    await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  await configure(f, { sync: 'touch should-not-run', uninstall: 'touch should-not-run' });
  await f.app();
  await expect(lstat(join(f.workspace, 'should-not-run'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('skill source replaces legacy snapshots with TOCs and shares discovery, reading and lifecycle guards', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  await installer.install(options);
  const prior = JSON.parse(await readFile(manifest, 'utf8'));
  const source = `@knowledge training
@viewpoints skill
skill _Basics_Skill_ = {
  Common task knowledge.
.description
  Use before learning task guidance.
.body
  Common knowledge stays in the body.
}
skill _Skill_Application_Skill_ = {
  Guidance for applying learned knowledge.
.relations
  requires _Basics_Skill_
.description
  Use when applying learned knowledge to current inputs.
.body
  Obtain current inputs before applying learned knowledge.
.reminder
  - Recheck current inputs.
}
`;
  await f.write('docs/TRAINING.trm', source);
  const config = parse(await readFile(join(f.home, 'aterm.yaml'), 'utf8'));
  config.skills = {};
  await f.write('.aterm/aterm.yaml', stringify(config));
  const result = await installer.update(options);
  expect(result.removed).toHaveLength(0);
  expect(result.added).toHaveLength(2);
  const app = await f.app();
  const catalog = await new SkillCatalog().read(app.config);
  expect(catalog.filter((s) => s.term.startsWith('_training:')).map((s) => s.name)).toEqual([
    'training-basics-skill',
    'training-skill-application-skill',
  ]);
  const task = catalog.find((s) => s.term === '_training:Skill_Application_Skill_')!;
  expect(await readFile(join(directory, task.name, 'SKILL.md'), 'utf8')).toBe(task.text);
  expect(task.text).toContain('## Skill reading\n\n_training:Skill_Application_Skill_');
  expect(task.text).not.toContain('Obtain current inputs before applying learned knowledge.');
  expect(task.text).not.toContain('Recheck current inputs.');
  expect(parse(task.text.split('---')[1]!)).toEqual({
    name: task.name,
    description: task.description,
  });
  const listed = await app.query({ operation: 'skill-list' });
  expect('skills' in listed && listed.skills.map((s) => s.term)).toEqual(
    catalog.map((s) => s.term).sort(),
  );
  const viewed = await app.query({ operation: 'skill-toc', skillTerms: [task.term] });
  expect('skills' in viewed && task.text.endsWith(viewed.skills[0]!.markdown!)).toBe(true);
  await expect(
    app.query({ operation: 'skill-view', skillTerms: [task.term], viewpoints: ['skill'] }),
  ).rejects.toThrow('does not accept');
  await expect(
    app.query({ operation: 'skill-view', skillTerms: [task.term], knowledge: 'other' }),
  ).rejects.toThrow();
  expect((await installer.update(options)).unchanged).toHaveLength(packagedSkillNames.length + 3);
  await f.write('docs/TRAINING.trm', source.replace('current inputs.', 'fresh inputs.'));
  expect((await installer.update(options)).updated).toEqual([
    join(directory, task.name, 'SKILL.md'),
  ]);
  const file = join(directory, task.name, 'SKILL.md');
  const saved = await readFile(file, 'utf8');
  await writeFile(file, saved + 'User edit.\n');
  await expect(installer.update(options)).rejects.toThrow('modified skill file');
  expect(await readFile(file, 'utf8')).toBe(saved + 'User edit.\n');
  await writeFile(file, saved);
  await f.write('.aterm/aterm.yaml', 'invalid: [');
  const removed = await installer.uninstall(options);
  expect(removed.removed).toHaveLength(packagedSkillNames.length + 3);
  await expect(lstat(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('skill install names refuse collisions and invalid descriptions before replacing existing files', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  await installer.install(options);
  const baseline = await readFile(manifest, 'utf8');
  const config = parse(await readFile(join(f.home, 'aterm.yaml'), 'utf8'));
  config.skills = {};
  await f.write('.aterm/aterm.yaml', stringify(config));
  const termDeclaration = (knowledge: string, name: string, description: string) =>
    `@knowledge ${knowledge}\n@viewpoints skill\nskill _${name}_ = {\n  Task guidance.\n.description\n  ${description}\n.body\n  Task instructions.\n}\n`;
  await f.write('docs/FIRST.trm', termDeclaration('a_b', 'C', 'First activation.'));
  await f.write('docs/SECOND.trm', termDeclaration('a', 'B_C', 'Second activation.'));
  await expect(installer.update(options)).rejects.toThrow('conflicting install name');
  expect(await readFile(manifest, 'utf8')).toBe(baseline);
  await f.write('docs/SECOND.trm', termDeclaration('a', 'Different', 'x'.repeat(1025)));
  await expect(installer.update(options)).rejects.toThrow('1024');
  expect(await readFile(manifest, 'utf8')).toBe(baseline);
  expect(
    await readFile(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'), 'utf8'),
  ).toContain('aterm skill view');
});

test('Bash spawn failure and signals fail with a recoverable manifest', async () => {
  const { f, installer, options, manifest } = await setup();
  await configure(f, { sync: 'true', uninstall: 'true' });
  await expect(installer.install({ ...options, env: { PATH: '/nonexistent' } })).rejects.toThrow(
    'Manifest retained',
  );
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(true);
  await configure(f, { sync: 'kill -TERM $$', uninstall: 'true' });
  await expect(installer.update(options)).rejects.toThrow('signal SIGTERM');
  await configure(f, { sync: 'true', uninstall: 'true' });
  await installer.update(options);
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(false);
});

test('Knowledge rename synchronizes managed Skill names and qualified pointers through the existing manifest', async () => {
  const { f, directory, installer, options, manifest } = await setup();
  await installer.install(options);
  await f.author({ operation: 'rename-knowledge', from: 'docs_skills', to: 'api' });
  const updated = await installer.update(options);
  expect(updated.added).toEqual([join(directory, 'api-api-design/SKILL.md')]);
  expect(updated.removed).toEqual([join(directory, 'docs-skills-api-design/SKILL.md')]);
  expect(await readFile(join(directory, 'api-api-design/SKILL.md'), 'utf8')).toContain(
    'name: api-api-design',
  );
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    pending: false,
    files: expect.arrayContaining([
      expect.objectContaining({ name: 'api-api-design', term: '_api:Api_Design_' }),
      expect.objectContaining({
        name: 'aterm-skills-aterm-basics-skill',
        term: '_aterm_skills:Aterm_Basics_Skill_',
      }),
    ]),
  });
});

test('update replaces an earlier catalog through the same version-2 manifest and removes stale names', async () => {
  const { directory, installer, options, manifest } = await setup();
  await installer.install(options);
  const prior = JSON.parse(await readFile(manifest, 'utf8'));
  const current = prior.files.find(
    (record: { name: string }) => record.name === 'aterm-skills-aterm-basics-skill',
  );
  const oldName = 'newskill-trial-aterm-basics-skill';
  const bytes = await readFile(join(directory, current.path));
  await mkdir(join(directory, oldName));
  await writeFile(join(directory, oldName, 'SKILL.md'), bytes);
  await rm(join(directory, current.name), { recursive: true });
  current.name = oldName;
  current.path = `${oldName}/SKILL.md`;
  current.term = '_newskill_trial:Aterm_Basics_Skill_';
  prior.deployed = prior.deployed.map((name: string) =>
    name === 'aterm-skills-aterm-basics-skill' ? oldName : name,
  );
  await writeFile(manifest, JSON.stringify(prior));
  const result = await installer.update(options);
  expect(result.removed).toEqual([join(directory, oldName, 'SKILL.md')]);
  expect(result.added).toEqual([join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md')]);
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(false);
  await expect(lstat(join(directory, oldName, 'SKILL.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await readFile(join(directory, 'aterm-skills-aterm-basics-skill/SKILL.md'))).toEqual(
    bytes,
  );
});

test('a failed pending journal write changes no pointers and is not reported as partial synchronization', async () => {
  const { f, directory, options, manifest, installer } = await setup();
  await installer.install(options);
  const before = await readFile(manifest, 'utf8');
  const pointer = join(directory, 'docs-skills-api-design/SKILL.md');
  const original = await readFile(pointer, 'utf8');
  await f.write('docs/SKILLS.trm', knowledgeSource('Api_Design', 'A changed description.'));
  const access = new FileAccess();
  const write = access.write.bind(access);
  vi.spyOn(access, 'write').mockImplementation(async (...args) => {
    if (args[0] === manifest) throw new Error('journal unavailable');
    return write(...args);
  });
  await expect(new SkillInstallation(access).update(options)).rejects.toThrow(
    /^journal unavailable$/,
  );
  expect(await readFile(manifest, 'utf8')).toBe(before);
  expect(await readFile(pointer, 'utf8')).toBe(original);
});

test('a pointer changed after journaling is refused without accepting the competing bytes', async () => {
  const { f, directory, options, manifest, installer } = await setup();
  await installer.install(options);
  const pointer = join(directory, 'docs-skills-api-design/SKILL.md');
  const original = await readFile(pointer, 'utf8');
  await f.write('docs/SKILLS.trm', knowledgeSource('Api_Design', 'A changed description.'));
  const access = new FileAccess();
  const write = access.write.bind(access);
  vi.spyOn(access, 'write').mockImplementation(async (...args) => {
    await write(...args);
    if (args[0] === manifest && JSON.parse(String(args[1])).pending)
      await writeFile(pointer, 'competing user edit');
  });
  await expect(new SkillInstallation(access).update(options)).rejects.toThrow(
    /changed during synchronization[\s\S]*Changed files: none/,
  );
  expect(await readFile(pointer, 'utf8')).toBe('competing user edit');
  const journal = JSON.parse(await readFile(manifest, 'utf8'));
  expect(journal.pending).toBe(true);
  expect(
    journal.files.find((file: { name: string }) => file.name === 'docs-skills-api-design').hashes,
  ).not.toContain(access.hash('competing user edit'));
  await expect(installer.update(options)).rejects.toThrow('Unmanaged or modified');
  await writeFile(pointer, original);
  await installer.update(options);
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(false);
});

test('failure to finalize a manifest preserves the journal and already written pointers for retry', async () => {
  const { directory, options, manifest } = await setup();
  const access = new FileAccess();
  const write = access.write.bind(access);
  let fail = true;
  vi.spyOn(access, 'write').mockImplementation(async (...args) => {
    if (args[0] === manifest && !JSON.parse(String(args[1])).pending && fail) {
      fail = false;
      throw new Error('final manifest unavailable');
    }
    return write(...args);
  });
  const installer = new SkillInstallation(access);
  await expect(installer.install(options)).rejects.toThrow(
    /final manifest unavailable[\s\S]*Changed files:[\s\S]*docs-skills-api-design\/SKILL.md/,
  );
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(true);
  const pointer = await readFile(join(directory, 'docs-skills-api-design/SKILL.md'), 'utf8');
  const result = await installer.update(options);
  expect(result.added).toEqual([]);
  expect(result.updated).toEqual([]);
  expect(result.unchanged).toHaveLength(packagedSkillNames.length + 1);
  expect(await readFile(join(directory, 'docs-skills-api-design/SKILL.md'), 'utf8')).toBe(pointer);
  expect(JSON.parse(await readFile(manifest, 'utf8')).pending).toBe(false);
});
