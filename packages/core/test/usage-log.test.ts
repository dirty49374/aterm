import { mkdtemp, readFile, writeFile, stat, mkdir, utimes, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { UsageLog, usageLogMaxBytes } from '../src/file-module/usage-log.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const roots: string[] = [];
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'aterm-usage-'));
  roots.push(home);
  return { home, log: new UsageLog(home) };
}
afterEach(async () => {
  for (const home of roots.splice(0)) await rm(home, { recursive: true, force: true });
});
async function records(path: string) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test('shrinks on byte limit, retaining newest complete UTF-8 records with no backup accumulation', async () => {
  const { log } = await setup();
  const line = JSON.stringify({ message: '최근 기록'.repeat(40) }) + '\n';
  await writeFile(
    log.path,
    line.repeat(Math.floor(usageLogMaxBytes / Buffer.byteLength(line))) +
      JSON.stringify({ marker: 'newest-old-record' }) +
      '\n',
  );
  await log.write({ marker: 'new-record', padding: 'x'.repeat(2000) });
  expect((await stat(log.path)).size).toBeLessThanOrEqual(usageLogMaxBytes);
  expect((await stat(log.path)).size).toBeLessThan(4.1 * 1024 * 1024);
  const data = await records(log.path);
  expect(data.at(-2).marker).toBe('newest-old-record');
  expect(data.at(-1).marker).toBe('new-record');
  expect(await readFile(log.path, 'utf8')).not.toContain('�');
});

test('independent processes append and compact through one shared lock without lost records', async () => {
  const { home, log } = await setup();
  const line = JSON.stringify({ padding: 'x'.repeat(1024) }) + '\n';
  await writeFile(log.path, line.repeat(Math.floor(usageLogMaxBytes / Buffer.byteLength(line))));
  const module = new URL('../dist/file-module/usage-log.js', import.meta.url).href;
  await Promise.all(
    Array.from({ length: 4 }, (_, worker) =>
      promisify(execFile)(process.execPath, [
        '--input-type=module',
        '-e',
        `import {UsageLog} from ${JSON.stringify(module)}; const log=new UsageLog(${JSON.stringify(home)}); for(let i=0;i<15;i++) await log.write({worker:${worker},sequence:i});`,
      ]),
    ),
  );
  const data = (await records(log.path)).filter((row) => row.worker !== undefined);
  expect(data).toHaveLength(60);
  expect(new Set(data.map((row) => `${row.worker}:${row.sequence}`)).size).toBe(60);
  expect((await stat(log.path)).size).toBeLessThanOrEqual(usageLogMaxBytes);
});

test('request roots are distinct under the server lifecycle and child spans correlate', async () => {
  const { log } = await setup();
  const host = log.start('command', 'server run');
  await host.run(async () => {
    for (let i = 0; i < 2; i++) {
      const http = log.start('http', '/mcp');
      await http.run(async () => {
        const tool = log.start('mcp', 'aterm');
        await tool.run(async () => {
          const command = log.start('command', 'knowledge edit');
          await command.phase('publish');
          await command.finish({ outcome: 'ok' });
        });
        await tool.finish({ outcome: 'ok' });
      });
      await http.finish({ outcome: 'ok' });
    }
  });
  await host.finish();
  const data = await records(log.path);
  const starts = data.filter((row) => row.event === 'start');
  expect(
    new Set(starts.filter((row) => row.kind === 'http').map((row) => row.requestId)).size,
  ).toBe(2);
  for (const row of starts.filter((row) => row.kind === 'mcp')) {
    expect(starts.find((parent) => parent.spanId === row.parentId)?.requestId).toBe(row.requestId);
  }
  expect(
    starts.filter((row) => row.kind === 'http').every((row) => row.requestId !== host.requestId),
  ).toBe(true);
});

test('an abandoned lock is recovered and unavailable logging never rejects an operation', async () => {
  const { home, log } = await setup();
  const lock = join(home, '.aterm-usage-lock');
  await mkdir(lock);
  await utimes(lock, new Date(0), new Date(0));
  await log.write({ marker: 'recovered' });
  expect((await records(log.path))[0].marker).toBe('recovered');
  await rm(log.path);
  const unrelated = join(home, 'private');
  await writeFile(unrelated, 'unchanged');
  await symlink(unrelated, log.path);
  const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await expect(log.write({ marker: 'refused' })).resolves.toBeUndefined();
    expect(await readFile(unrelated, 'utf8')).toBe('unchanged');
    expect(warning).toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});
