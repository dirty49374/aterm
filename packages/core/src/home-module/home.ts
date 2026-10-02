import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AtermError } from '../error.js';

export const HOME_DIRECTORY = '.aterm';
export const CONFIG_FILE = 'aterm.yaml';
export const HOME_VARIABLE = 'ATERM_HOME';

/** _aterm:Home_ is the `.aterm` directory; _aterm:Workspace_ is its parent and the base of every source path. */
export interface IAtermHome {
  readonly home: string;
  readonly workspace: string;
  readonly configPath: string;
  readonly origin: 'option' | 'environment' | 'ancestor' | 'user';
}

/** Explicit selection first, then the nearest ancestor of cwd, then the user home; never writes. */
export class AtermHomeDiscovery {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly userHome: string = homedir(),
  ) {}

  async discover(cwd: string, explicit?: string): Promise<IAtermHome> {
    if (explicit !== undefined) return this.select(explicit, 'option', cwd);
    const variable = this.env[HOME_VARIABLE];
    if (variable !== undefined) {
      if (!variable.trim())
        throw new AtermError('home.invalid', `${HOME_VARIABLE} must not be empty.`);
      return this.select(variable, 'environment', cwd);
    }
    for (let directory = resolve(cwd); ; directory = dirname(directory)) {
      const candidate = join(directory, HOME_DIRECTORY);
      if (await this.isDirectory(candidate)) return this.select(candidate, 'ancestor', cwd);
      if (dirname(directory) === directory) break;
    }
    const user = join(this.userHome, HOME_DIRECTORY);
    if (await this.isDirectory(user)) return this.select(user, 'user', cwd);
    throw new AtermError(
      'home.missing',
      `No ${HOME_DIRECTORY} directory from ${resolve(cwd)} upward or at ${user}; run aterm init.`,
    );
  }

  private async select(
    path: string,
    origin: IAtermHome['origin'],
    cwd: string,
  ): Promise<IAtermHome> {
    const home = resolve(cwd, path);
    if (!(await this.isDirectory(home)))
      throw new AtermError('home.invalid', `Aterm home is not a directory: ${home}`);
    return { home, workspace: dirname(home), configPath: join(home, CONFIG_FILE), origin };
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await lstat(path)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
