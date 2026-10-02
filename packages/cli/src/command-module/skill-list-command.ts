import { shippedConfig, type AtermQuery, type IAtermConfig } from '@agent-workshop/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class SkillListCommand implements ICommandDefinition {
  readonly name = 'skill list';
  readonly options = [] as const;
  readonly help = {
    summary: 'List Skills and when to select them',
    behavior:
      'Reads packaged and Home skill Term Declarations, even when default Knowledge or Viewpoints are excluded from ordinary reads. Requires relations order prerequisite reading; no actions are executed and prerequisite bodies are not automatically included.',
    example: 'aterm skill list',
  };
  readonly action = 'query' as const;
  fallback(): Promise<IAtermConfig> {
    return shippedConfig();
  }
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return { operation: 'skill-list' };
  }
}
