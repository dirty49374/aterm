import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AtermError } from '../error.js';
import { GitRepository } from './git-repository.js';

export interface IGitOptions {
  readonly maxBuffer?: number;
  readonly timeout?: number;
}
export interface IGitSession {
  run(args: readonly string[], options?: IGitOptions): Promise<string>;
}
export interface IGit {
  run(cwd: string, args: readonly string[], options?: IGitOptions): Promise<string>;
  withRepository<T>(cwd: string, work: (git: IGitSession) => Promise<T>): Promise<T>;
}

/** The caller selects the Git operation; this mechanism never infers a branch or mutation. */
export class Git implements IGit {
  async run(cwd: string, args: readonly string[], options: IGitOptions = {}): Promise<string> {
    return this.withRepository(cwd, (git) => git.run(args, options));
  }
  withRepository<T>(cwd: string, work: (git: IGitSession) => Promise<T>): Promise<T> {
    const execute = async (
      args: readonly string[],
      env: NodeJS.ProcessEnv,
      options: IGitOptions = {},
    ) => {
      const { stdout } = await promisify(execFile)('git', ['--no-pager', ...args], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: Math.max(1, Math.min(options.timeout ?? 10000, 10000)),
        maxBuffer: Math.max(1, Math.min(options.maxBuffer ?? 32 * 1024 * 1024, 32 * 1024 * 1024)),
      });
      return stdout;
    };
    return new GitRepository().use(cwd, execute, (env) =>
      work({
        run: (args, options) => {
          if (!['rev-parse', 'diff', 'ls-files'].includes(args[0] ?? ''))
            throw new AtermError(
              'aterm.git',
              'Only Git revision, diff and file-list reads are supported.',
            );
          const separator = args.indexOf('--');
          if (
            args
              .slice(0, separator < 0 ? args.length : separator)
              .some((argument) => /^--output(?:=|$)/.test(argument))
          )
            throw new AtermError(
              'aterm.git',
              'Git output must be captured, not written to a file.',
            );
          return execute(args, env, options);
        },
      }),
    );
  }
}
