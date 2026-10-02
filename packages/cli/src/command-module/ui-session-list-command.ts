import type { ICommandDefinition } from '../contracts.js';
import { prepareUI } from './ui-options.js';

export class UISessionListCommand implements ICommandDefinition {
  readonly name = 'ui session list';
  readonly action = 'ui' as const;
  readonly options = [] as const;
  readonly help = {
    summary: 'List connected and recently disconnected browser tabs',
    behavior:
      'Inspect Session IDs, readiness, location and activity; sorted by last activity descending.',
    example: 'aterm ui session list',
  };
  ui(args: unknown[], options: Record<string, unknown>) {
    return prepareUI({ operation: 'session-list' });
  }
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
