import type { IFileRequest } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class FileWriteCommand implements ICommandDefinition {
  readonly name = 'file write';
  readonly argument = '<path>';
  readonly action = 'workspace' as const;
  readonly options = [
    ['--file <path>', 'Text input; - or omitted reads stdin'],
    ['--dry-run', 'Preview without saving'],
    ['--if-match <version>', 'Refuse if the target version changed'],
  ] as const;
  readonly help = {
    summary: 'Write Workspace text files without parsing the corpus',
    behavior:
      'Paths are Workspace-relative. No symlink traversal, binary files or recursive deletion. Raw writes may save invalid content; saved status and diagnostics are separate. Read --output json for a version, then use --if-match for guarded replacement.',
    example: 'aterm file write docs/todo.trm',
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
      operation: 'file-write',
      path: String(args[0] ?? '.'),
      text: await input.text(options.file ?? '-'),
      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
