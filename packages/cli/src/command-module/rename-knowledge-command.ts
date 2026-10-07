import { ExternalOptions } from './external-options.js';
import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class RenameKnowledgeCommand implements ICommandDefinition {
  readonly name = 'knowledge rename';
  readonly legacyName = 'rename-knowledge';
  readonly argument = '<from> <to>';
  readonly options = [
    ...ExternalOptions.options,
    ['--dry-run', 'Validate and preview without saving'],
  ] as const;
  readonly help = {
    summary: 'Rename a Knowledge ID and its qualified references',
    behavior:
      'Updates @knowledge and qualified references through the guarded authoring save. Local spellings and filenames stay unchanged. Configured or selected external sources participate. Duplicate Knowledge IDs refuse; --dry-run previews all changes.',
    example: 'aterm knowledge rename old_knowledge new_knowledge --dry-run',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      ...ExternalOptions.read(options),
      operation: 'rename-knowledge',
      from: args[0],
      to: args[1],
      ...(options.dryRun ? { dryRun: true } : {}),
    } as AtermQuery;
  }
}
