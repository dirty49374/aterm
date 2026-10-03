import { CommandTextInput } from './text-input.js';
import type { ISourceAuthoringRequest } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class KnowledgeEditCommand implements ICommandDefinition {
  readonly textInput = new CommandTextInput();
  readonly name = 'knowledge edit';
  readonly argument = '<name>';
  readonly action = 'workspace' as const;
  readonly options = [
    ['--file <path>', 'Header patch or complete source; - or omitted reads stdin'],
    ['--dry-run', 'Validate and preview without saving'],
    ['--if-match <version>', 'Refuse if the target version changed'],
  ] as const;
  readonly help = {
    summary: 'Edit Knowledge headers or replace its complete source',
    behavior:
      'Accept Update Knowledge context patches restricted to the header before the first Term Declaration, or complete source. Patch targets and identity must match the selected name; use knowledge rename for identity changes. Validate the complete proposed corpus before saving. Invalid states can be inspected and repaired with file read/write. Multi-file saves report partial failures; preview with --dry-run.',
    example: 'aterm knowledge edit todo --file headers.patch --dry-run',
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
      operation: 'knowledge-edit',
      name: String(args[0]),
      text: await this.textInput.read(args, options, input),

      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
