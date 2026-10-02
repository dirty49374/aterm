import type { AtermQuery } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class ConnectCommand implements ICommandDefinition {
  readonly name = 'graph connect';
  readonly legacyName = 'connect';
  readonly argument = '<terms...>';
  readonly options = [
    ...SearchOptions.options,
    ['--limit <count>', 'Maximum cycle-free paths per endpoint pair (positive integer; default 5)'],
    ['--edges <origins>', 'Comma-separated relation,reference (default all)'],
    ['--no-remark', 'Exclude references from Remarks'],
    ['--with-fileline', 'Include Relation declaration locations'],
  ] as const;
  readonly help = {
    summary: 'Connect two to ten Terms through a compact conceptual subgraph',
    behavior:
      'Union up to --limit distinct cycle-free undirected paths per pair of exact Terms (default 5), shortest first with deterministic ties. Paths differ by Term sequence, not parallel Relation labels. Original edge directions remain visible; disconnected pairs are reported. This is neither an inferred data flow nor a globally minimal connecting tree. No Contracts or Remarks content is loaded into the result.',
    example:
      'aterm graph connect _vending_machine:Coin_ _vending_machine:Product_ --edges relation',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      ...SearchOptions.read(options),
      operation: 'connect',
      ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
      termPatterns: args[0],
      ...(typeof options.edges === 'string'
        ? { edgeOrigins: options.edges.split(',').map((s) => s.trim()) }
        : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
