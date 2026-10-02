import type { AtermQuery } from '@agent-workshop/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class ViewpointListCommand implements ICommandDefinition {
  readonly name = 'viewpoint list';
  readonly options = [] as const;
  readonly help = {
    summary: 'List bound Viewpoints in a table',
    behavior: 'Reads configuration only; does not scan corpus sources.',
    example: 'aterm viewpoint list',
  };
  readonly action = 'query' as const;
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'viewpoint' };
  }
}
