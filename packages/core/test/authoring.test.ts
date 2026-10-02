import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { FileAccess } from '../src/file-module/index.js';
import { AtermEditor } from '../src/authoring-module/editor.js';
import { TermDeclarationChanges, localTerm } from '../src/index.js';
import { fixture } from './fixture.js';

const relationBlock = (name: string) =>
  `concept ${name} = {\n  Identity.\n.relations\n  zips ${name}\n  accepts ${name}\n}`;

/** Every fixture Knowledge declares the fixture Viewpoint, after a BOM when there is one. */
const declare = (text: string, knowledge = 'test'): string => {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return bom + '@knowledge ' + knowledge + eol + '@viewpoints spec' + eol + text.slice(bom.length);
};

test('format sorts adjacent assertions, preserves BOM/CRLF and is idempotent', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-one.trm');
  const source = declare('﻿' + relationBlock('_A_').replaceAll('\n', '\r\n'));
  await writeFile(file, source);
  const format = (input: { termPatterns?: string[]; dryRun?: boolean } = {}) =>
    f.author({ operation: 'format', ...input });
  expect((await format({ dryRun: true })).files).toHaveLength(1);
  expect(await readFile(file, 'utf8')).toBe(source);
  await format();
  expect(await readFile(file, 'utf8')).toBe(
    source.replace('zips _A_\r\n  accepts', 'accepts _A_\r\n  zips'),
  );
  expect((await format()).files).toEqual([]);
  await expect(format({ termPatterns: ['_Missing_'] })).rejects.toThrow('Unknown');
  await writeFile(file, source + '\n_A_ external _A_');
  await expect(format()).rejects.toThrow('external');
});

test('format refuses prose inside the declaration-only relations section', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-one.trm');
  const source = declare(relationBlock('_A_').replace('\n}', '\n    Supporting explanation.\n}'));
  await writeFile(file, source);
  await expect(f.author({ operation: 'format' })).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe(source);
});

test('rename includes owned Relations across every source', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-terms.trm');
  const shared = join(f.shared, 'GUIDE-relations.trm');
  await writeFile(
    path,
    declare(
      'undecided _One_ = {\n  One.\n.relations\n  names\t_Two_\n.contract\n}\nundecided _Two_ = {\n  Two.\n}\n',
    ),
  );
  await writeFile(
    shared,
    declare(
      'concept _Guide_ = {\n  Guide.\n.relations\n  explains _test:One_\n.contract\n}\n',
      'guide',
    ),
  );
  await f.author({ operation: 'rename', from: '_One_', to: '_New_' });
  expect(await readFile(path, 'utf8')).toContain('names\t_Two_');
  expect(await readFile(shared, 'utf8')).toContain('explains _test:New_');
  const viewed = await f.read({ operation: 'view', termPatterns: ['_Two_'] });
  expect(viewed.relations).toMatchObject([{ source: '_test:New_', target: '_test:Two_' }]);
});

test('rename rewrites a self-reference inside a one-line Term Declaration, whose body starts past column three', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-inline.trm');
  await writeFile(path, declare('concept _Beta_ = { Defines _Beta_ once. }\n'));
  await f.author({ operation: 'rename', from: '_Beta_', to: '_Gamma_' });
  expect(await readFile(path, 'utf8')).toContain('concept _Gamma_ = { Defines _Gamma_ once. }');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('keyed editing preserves BOM and CRLF and pattern rename handles overlapping old names', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-keyed.trm');
  const source = declare(
    '﻿undecided _A_ = {\r\n  A.\r\n}\r\nundecided _AA_ = {\r\n  Follows _A_.\r\n.relations\r\n  references _A_\r\n}\r\n',
  );
  await writeFile(path, source);
  await f.author({
    operation: 'edit',
    patch: '*** Begin Patch\n*** Update Term: _A_.definition\n@@\n-  A.\n+  First.\n*** End Patch',
  });
  expect(await readFile(path, 'utf8')).toBe(source.replace('  A.', '  First.'));
  await f.author({ operation: 'rename', from: '_A*_', to: '_AA*_' });
  expect(await readFile(path, 'utf8')).toBe(
    source.replace('  A.', '  First.').replace('_AA_', '_AAA_').replaceAll('_A_', '_AA_'),
  );
});

test('rename updates exact references and kinds, leaves opaque code, and exposes grep/path', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-edit.trm');
  const original = declare(
    'undecided _One_ = ````md\n  Uses _Two_† and `_Two_`.\n.relations\n  references _Two_\n---md\n  ```ts\n  const text = "_Two_";\n  ```\n````\nundecided _Two_ = ```md\n  Second.\n```\n',
  );
  await writeFile(path, original);
  const grep = await f.read({ operation: 'grep', referencePattern: '_Two_' });
  expect(grep.occurrences).toHaveLength(3);
  const paths = await f.read({ operation: 'path', from: '_One_', to: '_Two_' });
  expect(paths.paths).toEqual([['_test:One_', '_test:Two_']]);
  await expect(f.author({ operation: 'rename', from: '_One_', to: '_Two_' })).rejects.toThrow(
    'duplicate',
  );
  await f.author({ operation: 'rename', from: '_T*_', to: '_New*_', dryRun: true });
  expect(await readFile(path, 'utf8')).toBe(original);
  await f.author({ operation: 'rename', from: '_T*_', to: '_New*_' });
  const updated = await readFile(path, 'utf8');
  expect(updated).toContain('Uses _Newwo_† and `_Newwo_`.');
  expect(updated).toContain('const text = "_Two_"');
  expect(updated).toContain('undecided _Newwo_ =');
});

test('a patch resolves multiple Terms and keyed sections without losing surrounding content', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-edit.trm');
  const original = declare(
    '// preserved\nundecided _One_ = ```md\n  One.\n.relations\n  references _Two_\n---md\n  - Old.\n---md\n  Remark.\n```\n\nundecided _Two_ = ```md\n  Two.\n```\n',
  );
  await writeFile(path, original);
  const patch =
    '*** Begin Patch\n*** Update Term: _One_.contract\n@@\n-  - Old.\n+  - Follow _Two_.\n*** Update Term: _Two_.definition\n@@\n-  Two.\n+  Updated two.\n*** End Patch';
  const preview = await f.author({ operation: 'edit', patch, dryRun: true });
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(preview).toMatchObject({ dryRun: true, terms: ['_test:One_', '_test:Two_'] });
  await f.author({ operation: 'edit', patch });
  expect(await readFile(path, 'utf8')).toBe(
    original.replace('  - Old.', '  - Follow _Two_.').replace('  Two.', '  Updated two.'),
  );
});

test('invalid later hunk, absent key, duplicate and malformed candidate never write earlier targets', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-edit.trm');
  const original = declare('undecided _One_ = ```md\n  One.\n```\n');
  await writeFile(path, original);
  for (const tail of [
    '*** Update Term: _Missing_\n@@\n-x\n+y',
    '*** Update Term: _One_.contract\n@@\n+x',
    '*** Update Term: _One_\n@@\n-```\n+broken',
    '*** Update Term: _One_.definition\n@@\n+---md\n+  Injected contract.',
  ]) {
    await expect(
      f.author({
        operation: 'edit',
        patch:
          '*** Begin Patch\n*** Update Term: _One_.definition\n@@\n-  One.\n+  Changed.\n' +
          tail +
          '\n*** End Patch',
      }),
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(original);
  }
  await writeFile(join(f.docs, 'SPEC-duplicate.trm'), original);
  await expect(
    f.author({
      operation: 'edit',
      patch:
        '*** Begin Patch\n*** Update Term: _One_.definition\n@@\n-  One.\n+  Changed.\n*** End Patch',
    }),
  ).rejects.toThrow(/DUPLICATE|Duplicate|Ambiguous/);
  expect(await readFile(path, 'utf8')).toBe(original);
});

test('a concurrent external change is refused before any write, and the lock is released', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-edit.trm');
  await writeFile(path, declare('undecided _One_ = { One. }\n'));
  const app = await f.app();
  const editor = (await import('../src/index.js')).AtermEditor;
  const stale = new editor(app.config, {
    load: async () => {
      const trmFiles = await app.trmFiles();
      await writeFile(path, declare('undecided _One_ = { Changed outside. }\n'));
      return trmFiles;
    },
  });
  await expect(
    stale.edit({
      patch:
        '*** Begin Patch\n*** Update Term: _One_\n@@\n-undecided _One_ = { One. }\n+undecided _One_ = { Two. }\n*** End Patch',
    }),
  ).rejects.toThrow('Source changed');
  expect(await readFile(path, 'utf8')).toBe(declare('undecided _One_ = { Changed outside. }\n'));
  expect((await f.author({ operation: 'format' })).files).toEqual([]);
});

test('changes diffs a base commit against staged, unstaged, deleted and new files under the sources', async () => {
  const f = await fixture();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', f.workspace, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  await writeFile(
    join(f.docs, 'SPEC-old.trm'),
    declare('undecided _Old_ = ```md\n  Before.\n```\n'),
  );
  await writeFile(join(f.docs, 'SPEC-deleted.trm'), 'Deleted content\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'Base');
  const base = git('rev-parse', 'HEAD').trim();
  await writeFile(
    join(f.docs, 'SPEC-old.trm'),
    declare('undecided _Old_ = ```md\n  Staged.\n```\n'),
  );
  git('add', '.');
  await writeFile(
    join(f.docs, 'SPEC-old.trm'),
    declare('undecided _Old_ = ```md\n  Final.\n```\n'),
  );
  await rename(join(f.docs, 'SPEC-deleted.trm'), join(f.docs, 'SPEC-new.trm'));
  await writeFile(join(f.docs, 'not-included.md'), 'Markdown\n');
  await mkdir(join(f.workspace, 'unregistered'));
  await writeFile(join(f.workspace, 'unregistered/SPEC-hidden.trm'), 'Hidden\n');
  const read = (commit?: string, files?: string[]) =>
    f.diff({ operation: 'changes', commit, files });
  const result = await read();
  expect(result.commit).toBe(base);
  expect(result.diff).toContain('-  Before.\n+  Final.');
  expect(result.diff).toContain('--- /dev/null\n+++ b/docs/SPEC-new.trm');
  expect(result.diff).toContain('--- a/docs/SPEC-deleted.trm\n+++ /dev/null');
  expect(result.diff).not.toMatch(/Hidden|Markdown/);
  expect((await read(base)).diff).toBe(result.diff);
  expect((await read(base, ['docs/*new*'])).diff).not.toContain('SPEC-old');
  await expect(read('--output=wrong')).rejects.toThrow();
  expect(git('diff', '--cached', '--name-only')).toBe('docs/SPEC-old.trm\n');
  await expect(new TermDeclarationChanges().read('/nonexistent-root', [])).rejects.toThrow();
});

test('format and relations share code-unit target order rather than English collation', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-order.trm');
  await f.write(
    'docs/SPEC-order.trm',
    [
      'concept _Root_ = {',
      '  Root.',
      '.relations',
      '  uses _Search_',
      '  uses _SearchSpace_',
      '}',
      'concept _Search_ = { Search. }',
      'concept _SearchSpace_ = { Search space. }',
    ].join('\n'),
  );
  const read = () =>
    f.read({ operation: 'relations', termPatterns: ['_Root_'], edgeOrigins: ['relation'] });
  const before = (await read()).relations!.map((edge) => localTerm(edge.target));
  expect(before).toEqual(['_SearchSpace_', '_Search_']);
  await f.author({ operation: 'format' });
  const authored = [...(await readFile(path, 'utf8')).matchAll(/uses (_\w+_)/g)].map((m) => m[1]);
  expect(authored).toEqual(before);
  expect((await read()).relations!.map((edge) => localTerm(edge.target))).toEqual(authored);
  expect((await f.author({ operation: 'format' })).files).toEqual([]);
});

test('editing, rename, format and query projections preserve Term Declaration Group membership independently of identity', async () => {
  const f = await fixture();
  const path = join(f.docs, 'SPEC-groups.trm');
  await writeFile(
    path,
    declare(
      [
        'procedure _Test_ in test.procedures = {\n  Runs a test.\n.relations\n  zips _Test_\n  accepts _Test_\n}',
      ].join('\n'),
    ),
  );
  const shown = await f.read({ operation: 'show', termPatterns: ['_Test_'] });
  expect(
    shown.termDeclarations.map((termDeclaration) => [
      termDeclaration.termKind,
      termDeclaration.group,
    ]),
  ).toEqual([['procedure', 'test.procedures']]);
  await f.author({
    operation: 'edit',
    patch:
      '*** Begin Patch\n*** Update Term: procedure _Test_\n@@\n-procedure _Test_ in test.procedures = {\n+procedure _Test_ in quality.procedures = {\n*** End Patch',
  });
  await f.author({ operation: 'format' });
  await f.author({ operation: 'rename', from: '_Test_', to: '_Check_' });
  const text = await readFile(path, 'utf8');
  expect(text).toContain('procedure _Check_ in quality.procedures = {');
  expect(text).toContain('accepts _Check_\n  zips _Check_');
  expect(
    (
      await f.read({ operation: 'overview', termPatterns: ['_Check_'] })
    ).conceptMap?.terms[0]?.termDeclarations.map((termDeclaration) => termDeclaration.group),
  ).toEqual(['quality.procedures']);
  await expect(
    f.author({
      operation: 'edit',
      patch:
        '*** Begin Patch\n*** Update Term: procedure _Check_\n@@\n-procedure _Check_ in quality.procedures = {\n+procedure _Check_ in quality..procedures = {\n*** End Patch',
    }),
  ).rejects.toThrow('group.path');
  expect(await readFile(path, 'utf8')).toBe(text);
});

test('one patch adds mutually referring Terms, updates existing Terms, and deletes after closing references', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-edit.trm');
  const original = declare(
    '// retain this comment\nconcept _Old_ = { Old. }\nconcept _Root_ = {\n  Root.\n.relations\n  uses _Old_\n}\n',
  );
  await writeFile(file, original);
  const patch = `*** Begin Patch
*** Delete Term: _test:Old_
*** Update Term: _test:Root_.relations
@@
-  uses _Old_
+  uses _New_
*** Add Term: _test:New_
+concept _New_ in added.parts = {
+  New.
+.relations
+  uses _Peer_
+}
*** Add Term: _test:Peer_
+concept _Peer_ = {
+  Peer.
+.relations
+  uses _New_
+}
*** End Patch`;
  const preview = await f.author({ operation: 'edit', patch, dryRun: true });
  expect(preview.terms).toEqual(['_test:Old_', '_test:Root_', '_test:New_', '_test:Peer_']);
  expect(await readFile(file, 'utf8')).toBe(original);
  await f.author({ operation: 'edit', patch });
  const saved = await readFile(file, 'utf8');
  expect(saved).toBe(preview.files[0]!.after);
  expect(saved).toContain('// retain this comment');
  expect(saved).not.toContain('_Old_');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('add selects an explicit existing Knowledge, preserves BOM/CRLF, and delete allows empty Knowledge', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-empty.trm');
  const original = '\uFEFF@knowledge empty\r\n@viewpoints spec\r\n';
  await writeFile(file, original);
  const patch =
    '*** Begin Patch\n*** Add Term: spec.concept _New_\n+concept _New_ = { New. }\n*** End Patch';
  await f.author({ operation: 'edit', knowledge: 'empty', patch });
  expect(await readFile(file, 'utf8')).toBe(original + '\r\nconcept _New_ = { New. }\r\n');
  await f.author({
    operation: 'edit',
    patch: '*** Begin Patch\n*** Delete Term: _empty:New_\n*** End Patch',
  });
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  expect(await readFile(file, 'utf8')).toBe(original + '\r\n');
});

test('bad additions and deletions never save an earlier staged update', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-one.trm');
  const original = declare('concept _One_ = { One. }\n');
  await writeFile(file, original);
  const cases = [
    '*** Add Term: _One_\n+concept _One_ = { Duplicate. }',
    '*** Add Term: _test:One_\n+concept _One_ = { Duplicate. }',
    '*** Add Term: _missing:New_\n+concept _New_ = { New. }',
    '*** Add Term: _test:New_.definition\n+New.',
    '*** Add Term: _test:New_\n+concept _Different_ = { Wrong. }',
    '*** Add Term: _test:New_\n+concept _New_ = { New. }\n+concept _Extra_ = { Extra. }',
    '*** Add Term: _test:New_\n+unknown _New_ = { New. }',
    '*** Add Term: procedure _test:New_\n+concept _New_ = { Wrong kind. }',
    '*** Add Term: _test:New_\n+@scope {\n+  Injected.\n+}\n+concept _New_ = { New. }',
    '*** Delete Term: _test:Missing_',
    '*** Delete Term: _test:One_.definition',
  ];
  for (const tail of cases) {
    const patch =
      '*** Begin Patch\n*** Update Term: _test:One_\n@@\n-concept _One_ = { One. }\n+concept _One_ = { Changed. }\n' +
      tail +
      '\n*** End Patch';
    await expect(f.author({ operation: 'edit', patch })).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original);
  }
  await expect(
    f.author({
      operation: 'edit',
      knowledge: 'test',
      patch: '*** Begin Patch\n*** Add Term: _other:New_\n+concept _New_ = { New. }\n*** End Patch',
    }),
  ).rejects.toThrow('conflicts');
});

test('delete refuses surviving cross-Knowledge references and deletion of a newly added referenced Term', async () => {
  const f = await fixture();
  const file = join(f.docs, 'SPEC-one.trm');
  const consumer = join(f.shared, 'SPEC-consumer.trm');
  const original = declare('concept _One_ = { One. }\n');
  await writeFile(file, original);
  await writeFile(
    consumer,
    declare('concept _Reader_ = {\n  Reader.\n.relations\n  uses _test:One_\n}\n', 'consumer'),
  );
  const remove = '*** Delete Term: _test:One_';
  await expect(
    f.author({
      operation: 'edit',
      patch: `*** Begin Patch\n${remove}\n*** End Patch`,
      dryRun: true,
    }),
  ).rejects.toThrow('still references deleted Term');
  expect(await readFile(file, 'utf8')).toBe(original);
  const transient =
    '*** Begin Patch\n*** Add Term: _test:New_\n+concept _New_ = { New. }\n*** Update Term: _consumer:Reader_.relations\n@@\n-  uses _test:One_\n+  uses _test:New_\n*** Delete Term: _test:New_\n*** End Patch';
  await expect(f.author({ operation: 'edit', patch: transient })).rejects.toThrow(
    'still references deleted Term',
  );
  await f.author({
    operation: 'edit',
    patch: `*** Begin Patch\n${remove}\n*** Delete Term: _consumer:Reader_\n*** End Patch`,
  });
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('adding and deleting packaged Terms honor the same read-only boundary even in dry-run', async () => {
  const f = await fixture('sources: [docs]\nuseDefaultKnowledge: true\n');
  for (const block of [
    '*** Add Term: _aterm:User_Test_\n+concept _User_Test_ = { A user subject. }',
    '*** Delete Term: _aterm:Term_',
  ]) {
    await expect(
      f.author({
        operation: 'edit',
        patch: `*** Begin Patch\n${block}\n*** End Patch`,
        dryRun: true,
      }),
    ).rejects.toThrow(/read-only|allowDefaultWrites/i);
  }
});

test('a later-file preflight conflict prevents all writes, including in dry-run', async () => {
  const f = await fixture();
  const first = join(f.docs, 'a.trm');
  const last = join(f.docs, 'z.trm');
  const beforeFirst = declare('concept _A_ = { A. }', 'first');
  const beforeLast = declare('concept _Z_ = { Z. }', 'last');
  const outside = beforeLast.replace(' Z.', ' Outside.');
  const patch = [
    '*** Begin Patch',
    '*** Update Term: _first:A_',
    '@@',
    '-concept _A_ = { A. }',
    '+concept _A_ = { Updated A. }',
    '*** Update Term: _last:Z_',
    '@@',
    '-concept _Z_ = { Z. }',
    '+concept _Z_ = { Updated Z. }',
    '*** End Patch',
  ].join('\n');
  for (const dryRun of [true, false]) {
    await writeFile(first, beforeFirst);
    await writeFile(last, beforeLast);
    const app = await f.app();
    const editor = new AtermEditor(app.config, {
      load: async () => {
        const files = await app.trmFiles();
        await writeFile(last, outside);
        return files;
      },
    });
    await expect(editor.edit({ patch, dryRun })).rejects.toThrow(
      'Source changed; re-read docs/z.trm',
    );
    expect(await readFile(first, 'utf8')).toBe(beforeFirst);
    expect(await readFile(last, 'utf8')).toBe(outside);
    expect((await f.author({ operation: 'format' })).files).toEqual([]);
  }
});

test('a replacement-time conflict reports the saved prefix without overwriting external changes', async () => {
  const f = await fixture();
  const first = join(f.docs, 'a.trm');
  const last = join(f.docs, 'z.trm');
  const beforeFirst = declare('concept _A_ = { A. }', 'first');
  const beforeLast = declare('concept _Z_ = { Z. }', 'last');
  const outside = beforeLast.replace(' Z.', ' Outside.');
  await writeFile(first, beforeFirst);
  await writeFile(last, beforeLast);
  const originalWrite = FileAccess.prototype.write;
  const spy = vi.spyOn(FileAccess.prototype, 'write').mockImplementation(async function (
    this: FileAccess,
    ...args
  ) {
    await originalWrite.apply(this, args);
    if (args[0] === first) await writeFile(last, outside);
  });
  try {
    await expect(
      f.author({
        operation: 'edit',
        patch: [
          '*** Begin Patch',
          // Deliberately reverse patch order: saving still follows source path order.
          '*** Update Term: _last:Z_',
          '@@',
          '-concept _Z_ = { Z. }',
          '+concept _Z_ = { Updated Z. }',
          '*** Update Term: _first:A_',
          '@@',
          '-concept _A_ = { A. }',
          '+concept _A_ = { Updated A. }',
          '*** End Patch',
        ].join('\n'),
      }),
    ).rejects.toThrow('saved files: docs/a.trm. Multi-file writes are not crash-atomic.');
  } finally {
    spy.mockRestore();
  }
  expect(await readFile(first, 'utf8')).toBe(beforeFirst.replace(' A.', ' Updated A.'));
  expect(await readFile(last, 'utf8')).toBe(outside);
  expect((await f.author({ operation: 'format' })).files).toEqual([]);
});
