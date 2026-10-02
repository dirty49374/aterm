import type { ICommandDefinition } from '../contracts.js';
import { prepareUI, uiTargetOptions } from './ui-options.js';

export class UIExploreSetCommand implements ICommandDefinition {
  readonly name = 'ui explore set';
  readonly argument = '<terms...>';
  readonly action = 'ui' as const;
  readonly options = uiTargetOptions;
  readonly help = {
    summary: 'Set Terms in a selected Explore graph',
    behavior:
      'Replace the shared Working Set, select the Terms, and arrange and fit in Explore. Retains Context. Requires --session and a ready browser; waits for applied acknowledgement.',
    example: 'aterm ui explore set _aterm:Term_ --session a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI(
      { operation: 'explore-set', session: options.session, id: options.commandId, terms: args[0] },
      true,
    );
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
