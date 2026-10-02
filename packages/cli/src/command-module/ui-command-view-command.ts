import type { ICommandDefinition } from '../contracts.js';
import { prepareUI } from './ui-options.js';

export class UICommandViewCommand implements ICommandDefinition {
  readonly name = 'ui command view';
  readonly argument = '<id>';
  readonly action = 'ui' as const;
  readonly options = [] as const;
  readonly help = {
    summary: 'Inspect the outcome of a UI command',
    behavior:
      'Reads a command record by full UUID, including an unknown outcome after timeout. Records are local to the running server.',
    example: 'aterm ui command view 11111111-1111-4111-8111-111111111111',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI({ operation: 'command-view', id: args[0] });
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
