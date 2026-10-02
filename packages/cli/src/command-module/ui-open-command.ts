import type { ICommandDefinition } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UIOpenCommand implements ICommandDefinition {
  readonly name = 'ui open';
  readonly argument = '<term>';
  readonly action = 'ui' as const;
  readonly options = uiTargetOptions;
  readonly help = {
    summary: 'Open a Term in a selected browser Session',
    behavior:
      'Replace the Working Set with one exact Term and open Term Declarations and Context. Requires --session and a ready browser; waits for applied acknowledgement.',
    example: 'aterm ui open _aterm:Term_ --session a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI(
      { operation: 'open', session: options.session, id: options.commandId, terms: [args[0]] },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
