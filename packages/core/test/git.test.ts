import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { TermDeclarationChanges } from '../src/authoring-module/changes.js';
import { FileAccess } from '../src/file-module/file-access.js';
import { Git } from '../src/file-module/git.js';
import { WorkspaceFiles } from '../src/authoring-module/workspace-files.js';
import { SourceAuthoring } from '../src/authoring-module/source-authoring.js';
import { fixture, specViewpoint } from './fixture.js';

afterEach(() => vi.unstubAllEnvs());
async function repository(format = 'sha1') {
  const f = await fixture();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', f.workspace, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: f.workspace,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  git('init', '-q', '-b', 'main', '--object-format=' + format);
  await writeFile(join(f.docs, 'old.trm'), 'Before\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'Base');
  await writeFile(join(f.docs, 'old.trm'), 'After\n');
  const marker = join(f.workspace, 'executed');
  const script = join(f.workspace, 'probe.sh');
  await writeFile(script, `printf verified > '${marker}'\ncat\n`);
  const command = '/bin/sh ' + script;
  const compare = () => new TermDeclarationChanges().read(f.workspace, [f.docs]);
  return { ...f, git, marker, script, command, compare };
}

test('isolated Git reads refuse repository fsmonitor execution and do not alter source metadata', async () => {
  const f = await repository();
  await writeFile(f.script, `printf verified > '${f.marker}'\nprintf '\\0'\n`);
  f.git('config', 'core.fsmonitor', f.command);
  f.git('diff', '--name-only');
  expect(await readFile(f.marker, 'utf8')).toBe('verified');
  await rm(f.marker);
  const before = await Promise.all(
    ['config', 'index', 'HEAD'].map((name) => readFile(join(f.workspace, '.git', name))),
  );
  expect((await f.compare()).diff).toContain('-Before\n+After');
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    await Promise.all(
      ['config', 'index', 'HEAD'].map((name) => readFile(join(f.workspace, '.git', name))),
    ),
  ).toEqual(before);
});

test.each(['clean', 'process'])(
  'repository %s filters and included config cannot execute during a comparison',
  async (filter) => {
    const f = await repository();
    const extra = join(f.workspace, 'included.config');
    await writeFile(extra, `[filter "trap"]\n${filter} = ${f.command}\n`);
    f.git('config', 'include.path', extra);
    await writeFile(join(f.workspace, '.gitattributes'), '*.trm filter=trap\n');
    if (filter === 'process')
      await writeFile(f.script, `printf verified > '${f.marker}'\nexit 1\n`);
    if (filter === 'process') expect(() => f.git('diff', '--name-only')).toThrow();
    else f.git('diff', '--name-only');
    expect(await readFile(f.marker, 'utf8')).toBe('verified');
    await rm(f.marker);
    expect((await f.compare()).diff).toContain('-Before\n+After');
    await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

test('external diff, textconv, attribute conversion and worktree redirection are ignored', async () => {
  const f = await repository();
  f.git('config', 'diff.external', f.command);
  f.git('config', 'diff.trap.textconv', f.command);
  await writeFile(
    join(f.workspace, '.git/info/attributes'),
    '*.trm diff=trap filter=trap working-tree-encoding=UTF-16\n',
  );
  await writeFile(join(f.workspace, '.gitattributes'), '*.trm binary\n');
  await mkdir(join(f.workspace, 'other'));
  f.git('config', 'core.worktree', join(f.workspace, 'other'));
  expect((await f.compare()).diff).toContain('-Before\n+After');
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('inherited Git environment cannot redirect reads, execute commands or write trace files', async () => {
  const f = await repository();
  for (const [key, value] of Object.entries({
    GIT_DIR: '/missing-repository',
    GIT_WORK_TREE: '/missing-tree',
    GIT_INDEX_FILE: '/missing-index',
    GIT_COMMON_DIR: '/missing-common',
    GIT_OBJECT_DIRECTORY: '/missing-objects',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: f.command,
    GIT_CONFIG_PARAMETERS: 'invalid',
    GIT_EXTERNAL_DIFF: f.command,
    GIT_PAGER: f.command,
    GIT_TRACE: f.marker,
    GIT_TRACE2_EVENT: f.marker,
  }))
    vi.stubEnv(key, value);
  expect((await f.compare()).diff).toContain('-Before\n+After');
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('linked worktrees, packed objects, staged changes and repository-local ignores still work', async () => {
  const f = await repository();
  f.git('gc', '--quiet');
  const worktree = join(f.workspace, 'linked');
  f.git('worktree', 'add', '-qb', 'linked', worktree, 'HEAD');
  await writeFile(join(worktree, 'docs/old.trm'), 'Linked\n');
  await writeFile(join(worktree, '.gitignore'), 'ignored.trm\n');
  await writeFile(join(worktree, 'docs/ignored.trm'), 'Ignored\n');
  await writeFile(join(worktree, 'docs/new.trm'), 'New\n');
  const result = await new TermDeclarationChanges().read(worktree, [join(worktree, 'docs')]);
  expect(result.diff).toContain('-Before\n+Linked');
  expect(result.diff).toContain('+++ b/docs/new.trm');
  expect(result.files).not.toContain('docs/ignored.trm');
});

test('a Workspace inside its repository retains Workspace-relative diff paths', async () => {
  const f = await repository();
  const result = await new TermDeclarationChanges().read(f.docs, [f.docs]);
  expect(result.files).toEqual(['old.trm']);
  expect(result.diff).toContain('--- a/old.trm\n+++ b/old.trm');
});

test('SHA-256 repository storage is retained without importing executable config', async () => {
  const f = await repository('sha256');
  expect((await f.compare()).commit).toHaveLength(64);
  expect((await f.compare()).diff).toContain('-Before\n+After');
});

test('symlink metadata and alternate object stores fail instead of using an unsafe fallback', async () => {
  const f = await repository();
  await writeFile(join(f.workspace, '.git/objects/info/alternates'), '/unrelated/objects\n');
  await expect(f.compare()).rejects.toThrow('alternates');
  await rm(join(f.workspace, '.git/objects/info/alternates'));
  await rm(join(f.workspace, '.git/index'));
  await symlink(f.script, join(f.workspace, '.git/index'));
  await expect(f.compare()).rejects.toThrow('Symlink');
});

test('a PATH alias to a repository-local executable cannot replace Git', async () => {
  const f = await repository();
  const access = new FileAccess();
  await access.temporary('aterm-git-path-', async (directory) => {
    await symlink(f.script, join(directory, 'git'));
    vi.stubEnv('PATH', directory + ':' + process.env.PATH);
    expect((await f.compare()).diff).toContain('-Before\n+After');
    await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  await expect(new Git().run(f.workspace, ['checkout', '--', '.'])).rejects.toThrow('Only Git');
  await expect(new Git().run(f.workspace, ['diff', '--output=' + f.marker])).rejects.toThrow(
    'captured',
  );
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('semantic Viewpoint edits cannot write a bound Git metadata path, including dry-run', async () => {
  const f = await fixture('sources: [docs]\nviewpoints:\n  spec: ../.git/vocabulary.md\n');
  await mkdir(join(f.workspace, '.git'));
  const source = specViewpoint('spec');
  await writeFile(join(f.workspace, '.git/vocabulary.md'), source);
  const authoring = new SourceAuthoring((await f.app()).home);
  for (const dryRun of [true, false]) {
    await expect(
      authoring.execute({
        operation: 'viewpoint-edit',
        name: 'spec',
        text: source + '\nChanged.\n',
        dryRun,
      }),
    ).rejects.toThrow('reserved');
    await expect(
      authoring.execute({ operation: 'viewpoint-delete', name: 'spec', dryRun }),
    ).rejects.toThrow('reserved');
  }
  expect(await readFile(join(f.workspace, '.git/vocabulary.md'), 'utf8')).toBe(source);
  expect(await readFile(join(f.home, 'aterm.yaml'), 'utf8')).toContain('../.git/vocabulary.md');
});

test('raw and shared file writes reserve Git metadata, including dry-run and directory pointer files', async () => {
  const f = await repository();
  const raw = new WorkspaceFiles((await f.app()).home);
  const before = await readFile(join(f.workspace, '.git/config'), 'utf8');
  await mkdir(join(f.workspace, 'pointer'));
  await writeFile(join(f.workspace, 'pointer/.git'), 'gitdir: ../.git\n');
  for (const dryRun of [true, false]) {
    for (const path of ['.git/config', 'nested/.GIT/config', '.git', 'pointer/.git'])
      await expect(
        raw.execute({ operation: 'file-write', path, text: 'blocked', dryRun }),
      ).rejects.toThrow('reserved');
    await expect(
      raw.execute({ operation: 'file-delete', path: '.git/config', dryRun }),
    ).rejects.toThrow('reserved');
  }
  expect((await raw.execute({ operation: 'file-read', path: '.git/config' })).text).toBe(before);
  expect(await readFile(join(f.workspace, '.git/config'), 'utf8')).toBe(before);
  const files = new FileAccess();
  await expect(files.write(join(f.workspace, '.git/probe'), 'blocked')).rejects.toThrow('reserved');
  await expect(
    files.remove(join(f.workspace, '.git/config'), files.hash(Buffer.from(before))),
  ).rejects.toThrow('reserved');
  await expect(readFile(join(f.workspace, 'nested/.GIT/config'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
