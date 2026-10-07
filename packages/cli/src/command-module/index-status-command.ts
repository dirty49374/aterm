import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class IndexStatusCommand implements ICommandDefinition {
  readonly name = 'corpus index status';
  readonly options = [] as const;
  readonly help = {
    summary: 'Inspect local Model and Vector Index readiness',
    behavior:
      'Reports Model identity, cache path, corpus fingerprint and cached/missing chunks for the current corpus without downloading or embedding. Source validation still applies.',
    example: 'aterm corpus index status --output json',
  };
  readonly action = 'query' as const;
  async prepare(): Promise<AtermQuery> {
    return { operation: 'index-status' };
  }
}
