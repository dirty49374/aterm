import type { ICommandDefinition } from '../contracts.js';
import { prepareUI } from './ui-options.js';

export class UISessionViewCommand implements ICommandDefinition {
  readonly name = 'ui session view';
  readonly argument = '<session>';
  readonly action = 'ui' as const;
  readonly options = [] as const;
  readonly help = {
    summary: 'Inspect one browser Session',
    behavior:
      'Accepts a full UUID or an unambiguous prefix of at least six hexadecimal characters.',
    example: 'aterm ui session view a1b2c3',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI({ operation: 'session-view', session: args[0] });
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
