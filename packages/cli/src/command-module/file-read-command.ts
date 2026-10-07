import type { IFileRequest } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class FileReadCommand implements ICommandDefinition {
  readonly name = 'file read';
  readonly argument = '<path>';
  readonly action = 'workspace' as const;
  readonly options = [] as const;
  readonly help = {
    summary: 'Read Workspace text files without parsing the corpus',
    behavior:
      'Paths are Workspace-relative. No symlink traversal, binary files or recursive deletion. Raw writes may save invalid content; saved status and diagnostics are separate. Read --output json for a version, then use --if-match for guarded replacement.',
    example: 'aterm file read docs/todo.trm',
  };
  async prepare(): Promise<undefined> {
    return undefined;
  }
  async workspace(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<IFileRequest> {
    return {
      operation: 'file-read',
      path: String(args[0] ?? '.'),

      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
