import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class PathCommand implements ICommandDefinition {
  readonly name = 'graph path';
  readonly legacyName = 'path';
  readonly argument = '<from> <to>';
  readonly options = [
    ...SearchOptions.options,
    ['--no-remark', 'Exclude Remarks edges from traversal'],
  ] as const;
  readonly help = {
    summary: 'Find BFS paths between two Terms',
    behavior:
      'Return at most ten cycle-free directed paths in BFS order across Reference occurrences and declared Relations. Endpoints are exact Terms; missing endpoints fail. Use connect for shortest undirected conceptual connections.',
    example: 'aterm graph path _Introduction_ _Project_',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'path',
      from: args[0],
      to: args[1],
      ...(options.remark === false ? { remarks: false } : {}),
      ...SearchOptions.read(options),
    } as AtermQuery;
  }
}
