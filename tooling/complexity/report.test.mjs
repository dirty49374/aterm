import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collect, format, measure } from './report.mjs';

const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('upstream complexity measurements', () => {
  it('distinguishes nesting from paths, retaining simple and nested functions independently', () => {
    const rows = measure(
      `
function outer(x: number) {
  function simple() { return 1; }
  if (x > 0) { if (x > 1) return simple(); }
  return 0;
}`,
      'sample.ts',
    );
    expect(
      rows
        .filter((r) => r.metric === 'cyclomatic')
        .map((r) => r.score)
        .sort(),
    ).toEqual([1, 3]);
    expect(rows.filter((r) => r.metric === 'cognitive').map((r) => r.score)).toEqual([3]);
  });

  it('parses JSX, async callbacks, and implicit class functions without inventing Cognitive scores', () => {
    expect(
      measure('const View = ({yes}) => yes ? <span/> : null;', 'sample.jsx')
        .map((r) => r.score)
        .sort(),
    ).toEqual([1, 2]);
    const rows = measure(
      `class C {
  value = a || b;
  static { if (a) work(); }
  async run() { return lock(async () => { if (a) return 1; return 0; }); }
}`,
      'sample.ts',
    );
    expect(
      rows
        .filter((r) => r.metric === 'cyclomatic')
        .map((r) => r.score)
        .sort(),
    ).toEqual([1, 2, 2, 2]);
    expect(rows.filter((r) => r.metric === 'cognitive').map((r) => r.score)).toEqual([1]);
    expect(rows.every((r) => r.file === 'sample.ts' && r.line > 0 && r.column > 0)).toBe(true);
  });

  it('measures functions even when source directives disable lint rules', () => {
    const rows = measure(
      '/* eslint-disable */\nfunction f(x) { if (x) return 1; return 0; }',
      'sample.ts',
    );
    expect(rows.map((row) => row.score).sort()).toEqual([1, 2]);
  });

  it('refuses parse failures instead of returning a deceptively clean report', () => {
    expect(() => measure('function broken(', 'broken.ts')).toThrow(/broken.ts.*Parsing error/);
  });

  it('selects authored implementation, excludes tests/declarations/generated files, and limits only text', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aterm-complexity-'));
    temporary.push(directory);
    const files = [
      'packages/core/src/a.ts',
      'packages/webapp/public/graph.js',
      'tooling/build.ts',
      'packages/core/src/a.test.ts',
      'packages/core/src/a.d.ts',
      'packages/core/test/a.ts',
      'packages/core/dist/a.js',
      'packages/core/webapp/a.js',
      'tooling/node_modules/a/index.js',
    ];
    for (const file of files) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(
        path.join(directory, file),
        'function sample(x) { if (x) return 1; return 0; }',
      );
    }
    const report = await collect(directory);
    expect(report.files).toEqual([
      'packages/core/src/a.ts',
      'packages/webapp/public/graph.js',
      'tooling/build.ts',
    ]);
    expect(report.measurements).toHaveLength(6);
    const output = format(report, 1);
    expect(output.match(/packages\/core\/src\/a.ts/g)).toHaveLength(2);
    expect(output).not.toContain('tooling/build.ts:');
    expect(report.measurements).toHaveLength(6);
    await writeFile(path.join(directory, files[0]), 'function broken(');
    await expect(collect(directory)).rejects.toThrow(/Parsing error/);
  });
});
