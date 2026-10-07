import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class KnowledgeViewCommand implements ICommandDefinition {
  readonly name = 'knowledge view';
  readonly argument = '<id...>';
  readonly options = [] as const;
  readonly help = {
    summary: 'Read Knowledge scope and Term Declaration inventory',
    behavior:
      'Exact IDs or whole-name globs select declared Knowledges. Unknown exact IDs fail; unmatched globs select nothing. Includes Scope, Viewpoints, source and Term Declarations with Term Kind and Group, ordered by Knowledge ID and Term name.',
    example: 'aterm knowledge view aterm',
  };
  readonly action = 'query' as const;
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'knowledge-view', knowledgeIds: args[0] as string[] };
  }
}
