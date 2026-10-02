import { expect, test } from 'vitest';
import { alignedTable } from '../src/presentation-module/table.js';

test('table alignment uses display columns and keeps multiline cells in one row', () => {
  const table = {
    headers: ['Name', 'Description'],
    rows: [
      ['界面', 'First\n  line\tcontinued.'],
      ['ab', 'Second.'],
      ['e\u0301', 'Third.'],
    ],
  };
  expect(alignedTable(table)).toBe(
    'NAME  DESCRIPTION\n界面  First line continued.\nab    Second.\ne\u0301     Third.',
  );
  const markdown = alignedTable(
    { headers: ['Name', 'Description'], rows: [['a|b', 'c\\d']] },
    true,
  );
  expect(markdown).toBe(
    '| Name | Description |\n| ---- | ----------- |\n| a\\|b | c\\\\d        |',
  );
  expect(alignedTable({ headers: ['Name', 'Description'], rows: [] })).toBe('NAME  DESCRIPTION');
});
