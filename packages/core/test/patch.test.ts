import { expect, test } from 'vitest';
import { TermPatch } from '../src/index.js';

test('Codex-style patch parses multiple Terms and sequential context hunks', () => {
  const editor = new TermPatch();
  const patches = editor.parse(
    '*** Begin Patch\n*** Update Term: _One_.contract\n@@\n heading\n-old\n+new\n@@\n-last\n+end\n*** End of File\n*** Update Term: _Two_\n@@\n-x\n+y\n*** End Patch\n',
  );
  expect(editor.apply(['heading', 'old', 'middle', 'last'], patches[0]!)).toEqual([
    'heading',
    'new',
    'middle',
    'end',
  ]);
  expect(editor.apply(['x'], patches[1]!)).toEqual(['y']);
});

test('matching remains unique, tolerates whitespace, supports anchors, insertion and deletion', () => {
  const e = new TermPatch();
  const patch = (body: string) =>
    e.parse('*** Begin Patch\n*** Update Term: _One_\n' + body + '\n*** End Patch')[0]!;
  expect(e.apply(['  old  '], patch('@@\n-old\n+  new'))).toEqual(['  new']);
  expect(() => e.apply(['old', 'old'], patch('@@\n-old\n+new'))).toThrow('Ambiguous');
  expect(() => e.apply(['different'], patch('@@\n-old\n+new'))).toThrow('not found');
  expect(e.apply(['old', 'heading', 'old'], patch('@@ heading\n-old\n+new'))).toEqual([
    'old',
    'heading',
    'new',
  ]);
  expect(e.apply(['old'], patch('@@\n-old'))).toEqual([]);
  expect(e.apply([], patch('@@\n+new'))).toEqual(['new']);
  expect(() => patch('@@\n*** Delete File: x')).toThrow('prefixes');
});

test('Add and Delete Term use Codex-style blocks alongside update hunks', () => {
  const patches = new TermPatch().parse(
    '*** Begin Patch\n*** Add Term: _demo:New_\n+concept _New_ = { New. }\n*** Delete Term: _demo:Old_\n*** Update Term: _demo:Other_.definition\n@@\n-old\n+new\n*** End Patch',
  );
  expect(patches[0]).toEqual({
    operation: 'add',
    target: '_demo:New_',
    lines: ['concept _New_ = { New. }'],
  });
  expect(patches[1]).toEqual({ operation: 'delete', target: '_demo:Old_' });
  expect(patches[2]?.operation).toBe('update');
  for (const block of [
    '*** Add Term: _A_',
    '*** Add Term: _A_\n+',
    '*** Add Term: _A_\nplain',
    '*** Delete Term: _A_\n+body',
    '*** Delete Term: _A_\n@@',
    '*** Update Term: _A_',
  ])
    expect(() => new TermPatch().parse(`*** Begin Patch\n${block}\n*** End Patch`)).toThrow();
});
