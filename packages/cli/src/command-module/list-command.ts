import type { AtermQuery } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class ListCommand implements ICommandDefinition {
  readonly name = 'term list';
  readonly legacyName = 'list';
  readonly argument = '[pattern...]';
  readonly options = [
    ...SearchOptions.options,
    ['--unreferenced', 'Only Term Declarations without incoming references'],
    [
      '--unreachable-from <pattern...>',
      'Only Term Declarations not reachable from these root Terms',
    ],
    ['--no-remark', 'Exclude Remarks text and references'],
    ['--tree', 'Show File / Group / Term Declaration hierarchy in text or Markdown output'],
    ['--with-fileline', 'Include file and line annotations'],
  ] as const;
  readonly help = {
    summary: 'List Term Declarations by exact name or quoted glob',
    behavior:
      'Reads every admitted .trm under the configured sources, regardless of Viewpoint. Filters do not hide corpus errors. --unreferenced ignores self references; --unreachable-from follows Term Declaration, Contract, Remarks and Relation edges. --no-remark excludes Remarks. --tree groups matching Term Declarations by File and authored Group path, including implicit prefixes; counts include matching descendants. --with-fileline adds leaf locations. JSON/YAML retain the complete structured result.',
    example: "aterm term list '*Project*'",
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'list',
      ...(Array.isArray(args[0]) && args[0].length ? { termPatterns: args[0] } : {}),
      ...(options.unreferenced ? { unreferenced: true } : {}),
      ...(Array.isArray(options.unreachableFrom) ? { roots: options.unreachableFrom } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
      ...SearchOptions.read(options),
    } as AtermQuery;
  }
}
