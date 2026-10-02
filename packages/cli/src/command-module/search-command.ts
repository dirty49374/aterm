import { ExternalOptions } from './external-options.js';
import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { SearchOptions } from './search-options.js';

export class SearchCommand implements ICommandDefinition {
  readonly name = 'corpus search';
  readonly legacyName = 'search';
  readonly argument = '<text>';
  readonly options = [
    ...ExternalOptions.options,
    ...SearchOptions.options,
    ['--match <pattern...>', 'Filter Term Declaration names with exact names or quoted globs'],
    ['--no-remark', 'Exclude Remarks text and references'],
    ['--with-fileline', 'Include file and line annotations'],
  ] as const;
  readonly help = {
    summary: 'Search Term Declaration names and text for a literal phrase',
    behavior:
      'Names, selector globs and literal text ignore case by default; --case-sensitive requires exact case throughout. --no-remark excludes Remarks. Matches identify their section. With --external name=glob, also search UTF-8 text outside the corpus and report physical locations. Corpus filters do not filter external matches. No saved index or file changes.',
    example: 'aterm corpus search ownership --match "*Knowledge*"',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      ...ExternalOptions.read(options),
      operation: 'search',
      searchText: args[0],
      ...(Array.isArray(options.match) ? { termPatterns: options.match } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
      ...SearchOptions.read(options),
    } as AtermQuery;
  }
}
