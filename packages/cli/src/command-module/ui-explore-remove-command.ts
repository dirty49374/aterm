import type { ICommandDefinition } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UIExploreRemoveCommand implements ICommandDefinition {
  readonly name = 'ui explore remove';
  readonly argument = '<terms...>';
  readonly action = 'ui' as const;
  readonly options = uiTargetOptions;
  readonly help = {
    summary: 'Remove Terms in a selected Explore graph',
    behavior:
      'Remove exact Terms from the shared Working Set and enter Explore; preserve surviving positions, camera and Context. Requires --session and a ready browser; waits for applied acknowledgement.',
    example: 'aterm ui explore remove _aterm:Term_ --session a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI(
      {
        operation: 'explore-remove',
        session: options.session,
        id: options.commandId,
        terms: args[0],
      },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
