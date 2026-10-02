import type { ISourceAuthoringRequest } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class KnowledgeDeleteCommand implements ICommandDefinition {
  readonly name = 'knowledge delete';
  readonly argument = '<name>';
  readonly action = 'workspace' as const;
  readonly options = [
    ['--dry-run', 'Validate and preview without saving'],
    ['--if-match <version>', 'Refuse if the target version changed'],
  ] as const;
  readonly help = {
    summary: 'Delete a Knowledge through guarded authoring',
    behavior:
      'Validate the complete proposed corpus before saving. Identity must match the selected name. Invalid states can be inspected and repaired with file read/write. Multi-file saves report partial failures; preview with --dry-run.',
    example: 'aterm knowledge delete todo',
  };
  async prepare(): Promise<undefined> {
    return undefined;
  }
  async workspace(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<ISourceAuthoringRequest> {
    return {
      operation: 'knowledge-delete',
      name: String(args[0]),

      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
