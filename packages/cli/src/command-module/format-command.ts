import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class FormatCommand implements ICommandDefinition {
  readonly name = 'term format';
  readonly legacyName = 'format';
  readonly argument = '[pattern...]';
  readonly options = [['--dry-run', 'Validate and preview without saving']] as const;
  readonly help = {
    summary: 'Sort adjacent .relations declarations by phrase and target',
    behavior:
      'Sort only adjacent declaration lines in .relations, by phrase and target. Preserve blank-line groups, ownership and all ordinary prose; do not move declarations between Term Declarations or reword phrases. Invalid corpora refuse. Multi-file saves are not crash-atomic.',
    example: "aterm term format '_Aterm*' --dry-run",
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'format',
      ...(Array.isArray(args[0]) && args[0].length ? { termPatterns: args[0] } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    } as AtermQuery;
  }
}
