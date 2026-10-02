import type { AtermQuery } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class ChangesCommand implements ICommandDefinition {
  readonly name = 'corpus diff';
  readonly legacyName = 'changes';
  readonly argument = '[pattern...]';
  readonly options = [
    ['--commit <id>', 'Base commit; default HEAD, compared with the current working tree'],
  ] as const;
  readonly help = {
    summary: 'Show unified Aterm diff from a commit to the working tree',
    behavior:
      'Default base HEAD; --commit selects another commit. Includes staged, unstaged, deleted and untracked .trm files under the configured sources inside the Git repository at the root. Optional quoted globs match workspace-relative file paths. Sources outside the root are not in this Git comparison. Never stages files. Empty diff means no changes; invalid commits fail.',
    example: 'aterm corpus diff --commit HEAD~1 "docs/**/*.trm"',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'changes',
      ...(Array.isArray(args[0]) && args[0].length ? { files: args[0] } : {}),
      ...(typeof options.commit === 'string' ? { commit: options.commit } : {}),
    } as AtermQuery;
  }
}
