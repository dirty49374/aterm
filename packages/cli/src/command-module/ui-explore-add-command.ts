import type { ICommandDefinition } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UIExploreAddCommand implements ICommandDefinition {
  readonly name = 'ui explore add';
  readonly argument = '<terms...>';
  readonly action = 'ui' as const;
  readonly options = uiTargetOptions;
  readonly help = {
    summary: 'Add Terms in a selected Explore graph',
    behavior:
      'Add exact Terms to the shared Working Set and enter Explore; preserve existing positions, camera and Context. Requires --session and a ready browser; waits for applied acknowledgement.',
    example: 'aterm ui explore add _aterm:Term_ --session a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI(
      { operation: 'explore-add', session: options.session, id: options.commandId, terms: args[0] },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
