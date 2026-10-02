import type { ISourceAuthoringRequest } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class KnowledgeCreateCommand implements ICommandDefinition {
  readonly name = 'knowledge create';
  readonly argument = '<name>';
  readonly action = 'workspace' as const;
  readonly options = [
    ['--file <path>', 'Complete source; - or omitted reads stdin'],
    ['--path <path>', 'Workspace-relative .trm path under a configured source directory'],
    ['--dry-run', 'Validate and preview without saving'],
    ['--if-match <version>', 'Refuse if the target version changed'],
  ] as const;
  readonly help = {
    summary: 'Create a Knowledge through guarded authoring',
    behavior:
      'Validate the complete proposed corpus before saving. Identity must match the selected name. Invalid states can be inspected and repaired with file read/write. Multi-file saves report partial failures; preview with --dry-run.',
    example: 'aterm knowledge create todo --path docs/todo.trm',
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
      operation: 'knowledge-create',
      name: String(args[0]),
      text: await input.text(options.file ?? '-'),
      path: typeof options.path === 'string' ? options.path : undefined,
      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
