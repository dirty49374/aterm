import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { AtermHomeDiscovery } from '@aterm/core';
import { fixture } from '../../core/test/fixture.js';
import { CommandRunner } from '../src/command-runner.js';

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const f = await fixture();
  workspaces.push(f.workspace);
  await f.write('docs/spec-sample.trm', 'concept _Item_ = {\n  An item.\n}\n');
  const home = await new AtermHomeDiscovery({}).discover(f.workspace);
  return { f, home };
}

test('a failed query write awaits publication before returning its failure', async () => {
  const { home } = await setup();
  const events: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let publishing!: () => void;
  const started = new Promise<void>((resolve) => {
    publishing = resolve;
  });
  const runner = new CommandRunner(home, {
    query: async () => {
      events.push('write');
      throw new Error('partial write');
    },
    afterWrite: async () => {
      events.push('publish');
      publishing();
      await waiting;
      events.push('published');
    },
  });
  let completed = false;
  const running = runner.run(['term', 'edit'], 'patch').then((result) => {
    completed = true;
    events.push('returned');
    return result;
  });
  await started;
  expect(completed).toBe(false);
  release();
  const result = await running;
  expect(result).toEqual({ stdout: '', stderr: 'Error: partial write\n', exitCode: 1 });
  expect(events).toEqual(['write', 'publish', 'published', 'returned']);
});

test('query reads and previews do not publish even when they fail', async () => {
  const { home } = await setup();
  const afterWrite = vi.fn();
  const runner = new CommandRunner(home, {
    query: async () => {
      throw new Error('refused');
    },
    afterWrite,
  });
  for (const args of [
    ['term', 'list'],
    ['term', 'edit', '--dry-run'],
  ])
    expect((await runner.run(args, 'patch')).exitCode).toBe(1);
  expect(afterWrite).not.toHaveBeenCalled();
});

test('a refused Workspace write publishes, while a preview does not alter or publish', async () => {
  const { f, home } = await setup();
  const path = 'docs/spec-sample.trm';
  const before = await readFile(join(f.workspace, path), 'utf8');
  const afterWrite = vi.fn();
  const runner = new CommandRunner(home, { afterWrite });
  const refused = await runner.run(['file', 'write', path, '--if-match', 'stale'], 'replacement');
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain('File version does not match');
  expect(afterWrite).toHaveBeenCalledTimes(1);
  afterWrite.mockClear();
  const preview = await runner.run(
    ['file', 'write', path, '--dry-run', '--output', 'json'],
    'replacement',
  );
  expect(preview.exitCode).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({
    saved: false,
    dryRun: true,
    after: 'replacement',
  });
  expect(afterWrite).not.toHaveBeenCalled();
  expect(await readFile(join(f.workspace, path), 'utf8')).toBe(before);
});

test('raw save success stays distinct from corpus diagnostics and file reads preserve bytes', async () => {
  const { f, home } = await setup();
  const path = 'docs/spec-sample.trm';
  const source = 'not a valid Knowledge\r\nno final newline';
  const published: string[] = [];
  const runner = new CommandRunner(home, {
    afterWrite: async () => {
      published.push(await readFile(join(f.workspace, path), 'utf8'));
    },
  });
  const result = await runner.run(['file', 'write', path, '--output', 'json'], source);
  expect(result.exitCode).toBe(0);
  const saved = JSON.parse(result.stdout);
  expect(saved.saved).toBe(true);
  expect(saved.diagnostics.length).toBeGreaterThan(0);
  expect(published).toEqual([source]);
  expect(await runner.run(['file', 'read', path])).toEqual({
    stdout: source,
    stderr: '',
    exitCode: 0,
  });
  expect(published).toEqual([source]);
});

test('MCP option refusal happens before application, input and query execution', async () => {
  const { home } = await setup();
  const application = vi.fn();
  const query = vi.fn();
  const afterWrite = vi.fn();
  const runner = new CommandRunner(home, { mcp: true, application, query, afterWrite });
  const result = await runner.run(['term', 'edit', '--home', home.home, '--file', 'missing.patch']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('local-only');
  expect(application).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  expect(afterWrite).not.toHaveBeenCalled();
});
