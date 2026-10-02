import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { stringify } from 'yaml';
import { fixture } from './fixture.js';

async function structuredFixture() {
  const f = await fixture('sources: [docs, shared]\nviewpoints:\n  data: ./data.md\n');
  await f.write(
    '.aterm/data.md',
    `---\n${stringify({
      name: 'data',
      description: 'Structured test vocabulary.',
      termKinds: [
        {
          name: 'record',
          description: 'A record.',
          sections: [
            { name: 'definition', type: 'md' },
            { name: 'settings', type: 'yaml' },
            { name: 'payload', type: 'json' },
          ],
        },
      ],
    })}---\n`,
  );
  return f;
}
const doc = (id: string, body: string) => `@knowledge ${id}\n@viewpoints data\n${body}`;
const body = (yaml: string, json = '{}') =>
  `record _Caller_ = {\n  Caller.\n.relations\n  references _Target_\n.settings\n${yaml
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n')}\n.payload\n  ${json}\n}\nrecord _Target_ = { Target. }\n`;

test('structured references preserve source columns through nested YAML and JSON rename', async () => {
  const f = await structuredFixture();
  await f.write(
    'docs/data.trm',
    doc(
      'data',
      body(
        'steps:\n  - call: _Target_\n# _Not_A_Reference_',
        '{"target":"_Target_","text":"Use _Target_."}',
      ),
    ),
  );
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  const read = await f.read({ operation: 'show', termPatterns: ['_Caller_'] });
  expect(
    read.termDeclarations[0]!.references.filter((ref) => ref.section !== 'relations'),
  ).toHaveLength(3);
  expect(
    read.termDeclarations[0]!.references.find((ref) => ref.section === 'settings'),
  ).toMatchObject({
    line: 9,
    column: 13,
  });
  await f.author({ operation: 'rename', from: '_data:Target_', to: '_Renamed_' });
  const saved = await readFile(join(f.docs, 'data.trm'), 'utf8');
  expect(saved).toContain('call: _Renamed_');
  expect(saved).toContain('{"target":"_Renamed_","text":"Use _Renamed_."}');
  expect(saved).toContain('# _Not_A_Reference_');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('Knowledge transfer qualifies structured references through the shared authoring mechanism', async () => {
  const f = await structuredFixture();
  await f.write('docs/data.trm', doc('source', body('target: _Target_', '{"target":"_Target_"}')));
  await f.write('shared/destination.trm', doc('destination', ''));
  await f.author({ operation: 'move', termPatterns: ['_source:Target_'], to: 'destination' });
  const saved = await readFile(join(f.docs, 'data.trm'), 'utf8');
  expect(saved).toContain('target: _destination:Target_');
  expect(saved).toContain('"target":"_destination:Target_"');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test.each([
  ['key: one\nkey: two', '{}', 'Map keys'],
  ['x: &x one\ny: *x', '{}', 'aliases'],
  ['x: one', '{"a":1,"a":2}', 'Map keys'],
  ['x: one', '{a:1}', 'Invalid json'],
  ['x: one', '', 'Invalid json'],
  ['x: one', '{"target":"\\u005fTarget_"}', 'literal spelling'],
])('invalid structured data is refused: %s / %s', async (yaml, json, message) => {
  const f = await structuredFixture();
  await f.write('docs/data.trm', doc('data', body(yaml, json)));
  expect(
    (await f.read({ operation: 'check' })).diagnostics.some((diagnostic) =>
      diagnostic.message.includes(message),
    ),
  ).toBe(true);
});
