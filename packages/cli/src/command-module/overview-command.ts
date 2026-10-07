import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class OverviewCommand implements ICommandDefinition {
  readonly name = 'graph overview';
  readonly legacyName = 'overview';
  readonly argument = '[patterns...]';
  readonly options = [
    ...SearchOptions.options,
    [
      '--file <paths...>',
      'Workspace-relative Aterm file paths or quoted globs; every Term declared there is selected',
    ],
    ['--edges <origins>', 'Comma-separated relation,reference (default all)'],
    ['--no-remark', 'Exclude references from Remarks'],
    ['--with-fileline', 'Include Relation declaration locations'],
  ] as const;
  readonly help = {
    summary: 'Discover Term Declarations and Relations without detailed Contracts',
    behavior:
      'Select exact Terms or quoted globs, or every Term declared in --file selections. Show selected Term Declarations and incident Relations; external neighbors appear only as endpoint names. Incoming Relations read with a reverse arrow in the authored phrase. An explicit Relation replaces the generic reference edge for the same ordered pair. More than 100 Terms including neighbors requires narrower pattern selection; file-only selection is bounded by its files. Relation phrases are not executable Contracts.',
    example: 'aterm graph overview --file docs/SPEC-execution.trm --edges relation',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      ...SearchOptions.read(options),
      operation: 'overview',
      termPatterns: args[0] ?? [],
      ...(Array.isArray(options.file) ? { files: options.file } : {}),
      ...(typeof options.edges === 'string'
        ? { edgeOrigins: options.edges.split(',').map((s) => s.trim()) }
        : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
