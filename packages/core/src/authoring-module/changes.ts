import { byText } from '../order.js';
import { relative, resolve } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess, Git, type IGitSession } from '../file-module/index.js';
import { GlobPattern } from '../query-module/pattern.js';
import { EXTENSION } from '../corpus-module/scanner.js';

export interface ITermDeclarationDiff {
  readonly commit: string;
  readonly workspace: string;
  readonly files: readonly string[];
  readonly diff: string;
}

/** Read-only Git comparison of `.trm` files under the sources, including untracked files. */
export class TermDeclarationChanges {
  constructor(private readonly git: Git = new Git()) {}

  async read(
    workspace: string,
    sources: readonly string[],
    commit = 'HEAD',
    filePatterns: readonly string[] = [],
    caseSensitive = false,
  ): Promise<ITermDeclarationDiff> {
    try {
      return await this.git.withRepository(workspace, (git) =>
        this.compare(git, workspace, sources, commit, filePatterns, caseSensitive),
      );
    } catch (error) {
      const failure = error as { stderr?: string };
      throw new AtermError('aterm.git', failure.stderr?.trim() || String(error));
    }
  }

  private async compare(
    git: IGitSession,
    workspace: string,
    sources: readonly string[],
    commit: string,
    filePatterns: readonly string[],
    caseSensitive: boolean,
  ): Promise<ITermDeclarationDiff> {
    const base = (
      await this.run(git, ['rev-parse', '--verify', '--end-of-options', commit + '^{commit}'])
    ).trim();
    const pathspec = `:(glob,icase)**/*.${EXTENSION}`;
    const tracked = (
      await this.run(git, [
        'diff',
        '--relative',
        '--name-only',
        '-z',
        '--no-renames',
        '--ignore-submodules=all',
        base,
        '--',
        pathspec,
      ])
    )
      .split('\0')
      .filter(Boolean);
    const untracked = (
      await this.run(git, ['ls-files', '--others', '--exclude-standard', '-z', '--', pathspec])
    )
      .split('\0')
      .filter(Boolean);
    const access = new FileAccess();
    const selectors = filePatterns.map((p) => new GlobPattern(p, caseSensitive));
    const files: string[] = [];
    for (const path of [...new Set([...tracked, ...untracked])].sort(byText)) {
      const absolute = resolve(workspace, path);
      const source = sources.find(
        (source) => access.inside(workspace, source) && access.inside(source, absolute),
      );
      if (!source || (selectors.length && !selectors.some((p) => p.matches(path)))) continue;
      await access.guard(source, absolute);
      // Guard both existing files and missing paths beneath any surviving parent.
      if (!access.inside(await access.canonical(workspace), await access.canonical(absolute)))
        throw new AtermError('aterm.path', 'Changed Aterm path leaves the workspace: ' + path);
      files.push(relative(workspace, absolute).split('\\').join('/'));
    }
    const chunks: string[] = [];
    for (const file of files) {
      const common = [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--no-renames',
        '--relative',
        '--ignore-submodules=all',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--unified=3',
      ];
      chunks.push(
        await this.run(
          git,
          untracked.includes(file)
            ? [...common, '--no-index', '--', '/dev/null', file]
            : [...common, base, '--', file],
          untracked.includes(file),
        ),
      );
    }
    return { commit: base, workspace, files, diff: chunks.join('') };
  }

  private async run(git: IGitSession, args: string[], difference = false): Promise<string> {
    try {
      return await git.run(args, { maxBuffer: 32 * 1024 * 1024 });
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      if (difference && result.code === 1 && typeof result.stdout === 'string')
        return result.stdout;
      throw new AtermError('aterm.git', result.stderr?.trim() || String(error));
    }
  }
}
