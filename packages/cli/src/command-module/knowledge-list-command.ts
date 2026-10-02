import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition } from '../contracts.js';

export class KnowledgeListCommand implements ICommandDefinition {
  readonly name = 'knowledge list';
  readonly options = [] as const;
  readonly help = {
    summary: 'List declared Knowledges',
    behavior:
      'Lists Knowledge IDs, files, Viewpoints and distinct Term / Term Declaration counts, including empty Knowledges. Corpus errors are not hidden.',
    example: 'aterm knowledge list',
  };
  readonly action = 'query' as const;
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'knowledge-list' };
  }
}
