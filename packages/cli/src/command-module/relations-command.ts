import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class RelationsCommand implements ICommandDefinition {
  readonly name = 'graph relations';
  readonly legacyName = 'relations';
  readonly argument = '[patterns...]';
  readonly options = [
    ...SearchOptions.options,
    ['--edges <origins>', 'Comma-separated relation,reference (default all)'],
    ['--no-remark', 'Exclude references from Remarks'],
    ['--with-fileline', 'Include Relation declaration locations'],
  ] as const;
  readonly help = {
    summary: 'List Relations as authored, optionally incident to selected Terms',
    behavior:
      'Print one source-phrase-target triple per line without Term Declarations. Omitted Term selectors include the entire search space. Viewpoint filters restrict both endpoints. Phrase filters match the authored phrase; exclusions win. --edges filters origin, not phrase. Generic references already replaced by explicit Relations stay omitted even when that explicit phrase is filtered out. Full-corpus validation always applies.',
    example: 'aterm graph relations --edges reference --viewpoint specification',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'relations',
      termPatterns: args[0] ?? [],
      ...SearchOptions.read(options),
      ...(typeof options.edges === 'string'
        ? { edgeOrigins: options.edges.split(',').map((s) => s.trim()) }
        : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
