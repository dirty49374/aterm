import { ExternalOptions } from './external-options.js';
import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class RenameCommand implements ICommandDefinition {
  readonly name = 'term rename';
  readonly legacyName = 'rename';
  readonly argument = '<from> <to>';
  readonly options = [
    ...ExternalOptions.options,
    ['--dry-run', 'Validate and preview without saving'],
  ] as const;
  readonly help = {
    summary: 'Rename Terms and their Aterm references',
    behavior:
      'Rename declarations and scanned Aterm references, including owned Relations together. Exact names or one * capture in both patterns; collisions refuse. Corpus opaque code and ordinary strings are unchanged. Configured externalSources participate by default; --external name=glob replaces that selection. Only qualified Term tokens in external UTF-8 files are replaced, including comments and strings; no code identifier inference. --dry-run previews all selected changes. Multi-file saves are not crash-atomic.',
    example: "aterm term rename '_Old_*_' '_New_*_' --dry-run",
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      ...ExternalOptions.read(options),
      operation: 'rename',
      from: args[0],
      to: args[1],
      ...(options.dryRun ? { dryRun: true } : {}),
    } as AtermQuery;
  }
}
