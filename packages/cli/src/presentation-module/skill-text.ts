import type { ISkillResult } from '@garage49/aterm-core';
import { alignedTable } from './table.js';

export function skillText(value: ISkillResult, markdown = false): string {
  if (value.operation === 'skill-list')
    return (
      alignedTable(
        {
          headers: ['TERM', 'DESCRIPTION'],
          rows: value.skills.map((s) => [s.term, s.description]),
        },
        markdown,
      ) + '\n'
    );
  return value.skills.map((s) => s.markdown).join('\n');
}
