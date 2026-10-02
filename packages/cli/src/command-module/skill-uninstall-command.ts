import type { AtermQuery, ISkillInstallationRequest } from '@aterm/core';
import type { ICommandDefinition } from '../contracts.js';

export class SkillUninstallCommand implements ICommandDefinition {
  readonly localOnly = true;
  readonly name = 'skill uninstall';
  readonly options = [] as const;
  readonly action = 'query' as const;
  readonly help = {
    summary: 'Uninstall all managed Skill pointers for this Home',
    behavior:
      'Applies to the entire managed inventory in the selected Home, not individual names. Install refuses an existing manifest; update synchronizes additions, edits and stale names; uninstall uses the recorded manifest without requiring valid configuration or corpus. Configured Bash commands synchronize Agent installations. Conflicts refuse changes; failed synchronization retains a pending manifest for retry. These are direct filesystem actions and never dispatch through HTTP.',
    example: 'aterm skill uninstall',
  };
  installation(): ISkillInstallationRequest {
    return { operation: 'uninstall' };
  }
  async prepare(): Promise<AtermQuery | undefined> {
    return undefined;
  }
}
