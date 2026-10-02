import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class InitCommand implements ICommandDefinition {
  readonly localOnly = true;
  readonly name = 'init';
  readonly argument = '[directory]';
  readonly options = [] as const;
  readonly help = {
    summary: 'Create .aterm/aterm.yaml and the docs source in a directory',
    behavior:
      'Writes the default configuration, binding the shipped Viewpoints, and creates the docs directory. The directory defaults to cwd. An existing aterm.yaml is never overwritten.',
    example: 'aterm init',
  };
  readonly action = 'initialize' as const;
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
