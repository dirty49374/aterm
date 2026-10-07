import { CommandTextInput } from './text-input.js';
import type { ISourceAuthoringRequest } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class ViewpointCreateCommand implements ICommandDefinition {
  readonly textInput = new CommandTextInput();
  readonly name = 'viewpoint create';
  readonly argument = '<name>';
  readonly action = 'workspace' as const;
  readonly options = [
    ['--file <path>', 'Complete source; - or omitted reads stdin'],
    ['--dry-run', 'Validate and preview without saving'],
    ['--if-match <version>', 'Refuse if the target version changed'],
  ] as const;
  readonly help = {
    summary: 'Create a Viewpoint through guarded authoring',
    behavior:
      'Validate the complete proposed corpus before saving. Identity must match the selected name. Invalid states can be inspected and repaired with file read/write. Multi-file saves report partial failures; preview with --dry-run.',
    example: 'aterm viewpoint create todo-spec',
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
      operation: 'viewpoint-create',
      name: String(args[0]),
      text: await this.textInput.read(args, options, input),

      dryRun: options.dryRun === true,
      ifMatch: typeof options.ifMatch === 'string' ? options.ifMatch : undefined,
    };
  }
}
