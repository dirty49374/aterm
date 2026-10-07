import { CommandTextInput } from './text-input.js';
import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class EditCommand implements ICommandDefinition {
  readonly textInput = new CommandTextInput();
  readonly name = 'term edit';
  readonly legacyName = 'edit';
  readonly options = [
    ['--file <path>', 'Codex-style patch file; - or omitted reads stdin'],
    ['--dry-run', 'Validate and preview every hunk without saving'],
  ] as const;
  readonly help = {
    summary: 'Add, update or delete Terms with one Codex-style patch',
    behavior:
      'Use *** Begin Patch and *** End Patch with Add Term, Update Term and Delete Term blocks. Add Term requires a Knowledge-qualified selector or --knowledge and plus-prefixed complete declaration lines. Delete Term takes only a complete-Term selector and refuses remaining corpus references. Update Term: [term-kind ]_Term_[.key] takes @@ context hunks. All blocks apply in order to one candidate corpus. Qualify a Term Kind with its Viewpoint when needed, for example skill.procedure _Term_.procedure. Context/removed lines match only inside the selected target. Every Term has one Term Declaration; an optional Term Kind prefix checks its current classification. A complete Term Declaration edit may change Term Kind after validating its entire replacement Schema. Missing or ambiguous matches refuse before saving. All candidates are validated before writes; multi-file saves are not crash-atomic and partial failures list saved files. No implicit rename.',
    example: 'aterm term edit --file changes.patch --dry-run',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'edit',
      patch: await this.textInput.read(args, options, input),
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  }
}
