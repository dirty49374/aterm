import type { ICommandDefinition } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UIExploreClearCommand implements ICommandDefinition {
  readonly name = 'ui explore clear';
  readonly action = 'ui' as const;
  readonly options = uiTargetOptions;
  readonly help = {
    summary: 'Clear Terms in a selected Explore graph',
    behavior:
      'Empty the shared Working Set and Selection, then enter Explore; retain Context and camera. Undo restores membership. Requires --session and a ready browser; waits for applied acknowledgement.',
    example: 'aterm ui explore clear --session a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI(
      { operation: 'explore-clear', session: options.session, id: options.commandId },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
