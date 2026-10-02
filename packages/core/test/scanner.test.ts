import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AtermScanner, IndexedCorpus } from '../src/index.js';
import { fixture } from './fixture.js';

test("scans sources recursively in sorted order, reads each Knowledge's Viewpoints, and refuses one without", async () => {
  const f = await fixture();
  await f.write('docs/nested/SPEC-b.trm', 'concept _B_ = { B. }\n');
  await f.write(
    'docs/SPEC-a.trm',
    'concept _A_ = {\n  A uses _docs_nested_spec_b:B_.\n.relations\n  references _docs_nested_spec_b:B_\n}\n',
  );
  await f.write('docs/spec-lower.TRM', 'concept _Lower_ = { Lower. }\n');
  await f.write('docs/README.md', '# Not scanned\n');
  await f.write('shared/GUIDE-g.trm', 'concept _G_ = { G. }\n');
  await symlink(join(f.docs, 'SPEC-a.trm'), join(f.docs, 'SPEC-link.trm'));
  const app = await f.app();
  const scan = await new AtermScanner().scan(app.config);
  expect(scan.trmFiles.map((d) => [d.path, d.viewpoints])).toEqual([
    ['docs/SPEC-a.trm', ['spec']],
    ['docs/nested/SPEC-b.trm', ['spec']],
    ['docs/spec-lower.TRM', ['spec']],
    ['shared/GUIDE-g.trm', ['guide']],
  ]);
  expect(scan.diagnostics.map((d) => [d.code, d.file.replace(f.workspace, '')])).toEqual([
    ['source.symlink', '/docs/SPEC-link.trm'],
  ]);
  const corpus = new IndexedCorpus(scan.trmFiles);
  expect(corpus.index.termDeclarations.map((d) => d.name)).toEqual([
    '_B_',
    '_A_',
    '_Lower_',
    '_G_',
  ]);
  expect(corpus.files(['docs/**/SPEC-*.trm']).map((p) => p.replace(f.workspace, ''))).toEqual([
    '/docs/SPEC-a.trm',
    '/docs/nested/SPEC-b.trm',
    '/docs/spec-lower.TRM',
  ]);
  expect(corpus.files(['docs/**/SPEC-*.trm'], true).map((p) => p.replace(f.workspace, ''))).toEqual([
    '/docs/SPEC-a.trm',
    '/docs/nested/SPEC-b.trm',
  ]);
  expect(() => corpus.files(['docs/SPEC-missing.trm'])).toThrow('Unknown Aterm file');
  const result = await f.read({ operation: 'list' });
  expect(result.warnings?.map((w) => w.message)).toEqual([
    'Symbolic links are not followed; ignored: docs/SPEC-link.trm',
  ]);
  // A Knowledge without an @viewpoints line is an error that blocks reads, like invalid UTF-8.
  await f.write('docs/ordinary.trm', 'concept _Ignored_ = { Ignored. }\n');
  const check = await f.read({ operation: 'check' });
  expect(check.diagnostics.map((d) => d.message)).toEqual([
    'Knowledge declares no @viewpoints line, so its Term Declarations have no vocabulary: docs/ordinary.trm',
  ]);
});

test('a missing source is a warning, an invalid UTF-8 file is an error that blocks reads', async () => {
  const f = await fixture('sources: [docs, absent]\nviewpoints:\n  spec: ./viewpoint-spec.md\n');
  await f.write('docs/SPEC-a.trm', 'concept _A_ = { A. }\n');
  const app = await f.app();
  const listed = await f.read({ operation: 'list' });
  expect(listed.warnings?.map((w) => w.message.split(':')[0])).toEqual(['Error']);
  const scan = await new AtermScanner().scan(app.config);
  expect(scan.diagnostics[0]).toMatchObject({
    code: 'source.missing',
    severity: 'warning',
    file: join(f.workspace, 'absent'),
  });
  await writeFile(join(f.docs, 'SPEC-bad.trm'), Buffer.from([0xff, 0xfe, 0x41]));
  const invalidScan = await app.scan();
  const invalidFile = invalidScan.trmFiles.find((file) => file.path === 'docs/SPEC-bad.trm');
  expect(invalidFile).toMatchObject({ absolutePath: join(f.docs, 'SPEC-bad.trm') });
  expect(invalidFile?.parsed).toBeUndefined();
  expect(invalidScan.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'trm.encoding', file: join(f.docs, 'SPEC-bad.trm') }),
  );
  expect(new IndexedCorpus(invalidScan.trmFiles).trmFiles).not.toContain(invalidFile);
  const check = await f.read({ operation: 'check' });
  expect(check.diagnostics.map((d) => d.message)).toEqual(['Invalid UTF-8: docs/SPEC-bad.trm']);
  await expect(app.query({ operation: 'list' })).rejects.toThrow('Invalid UTF-8');
});
