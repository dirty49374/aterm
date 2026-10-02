import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UINoteSendCommand implements ICommandDefinition {
  readonly name = 'ui note send';
  readonly action = 'ui' as const;
  readonly options = [
    ...uiTargetOptions,
    ['--file <path>', 'Markdown file; - or omitted reads stdin'],
    ['--title <text>', 'Note title; otherwise derived from the first nonempty Markdown line'],
  ] as const;
  readonly help = {
    summary: 'Send a Markdown Note to a selected browser Session',
    behavior:
      'Requires --session. Opens the Note beside the current view without changing the Graph or route. Caches the latest ten Notes in browser localStorage for this Home. Markdown must be nonempty and at most 65536 characters; a supplied title must contain 1–160 characters. Use qualified Term links. Waits for browser storage and display acknowledgement.',
    example: 'aterm ui note send --session a1b2c3 --file explanation.md --title "UI control"',
  };
  async ui(_args: unknown[], options: Record<string, unknown>, input: ICommandInputContext) {
    return prepareUI(
      {
        operation: 'note-send',
        session: options.session,
        id: options.commandId,
        markdown: await input.text(options.file ?? '-'),
        ...(options.title !== undefined ? { title: options.title } : {}),
      },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
