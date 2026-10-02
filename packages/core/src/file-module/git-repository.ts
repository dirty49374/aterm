import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from './file-access.js';

type Execute = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;

/** A private Git control directory contains data, never the source repository's configuration. */
export class GitRepository {
  private readonly files = new FileAccess();
  private copiedBytes = 0;
  private copiedFiles = 0;

  async use<T>(
    cwd: string,
    execute: Execute,
    work: (env: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    const workspace = await this.files.canonical(cwd);
    const { root, gitdir, common } = await this.locate(workspace);
    return this.files.temporary('aterm-git-', async (directory) => {
      if (this.files.inside(root, directory))
        throw new AtermError('aterm.git', 'Git temporary storage must be outside the repository.');
      const control = join(directory, 'repository');
      await this.files.ensureDirectory(join(control, 'objects'));
      await this.files.ensureDirectory(join(control, 'refs'));
      const config = join(control, 'config');
      const initial = '[core]\nrepositoryformatversion = 0\nbare = false\n';
      await this.files.write(config, initial);
      await this.files.write(join(control, 'HEAD'), 'ref: refs/heads/aterm-unborn\n');
      const env = await this.isolatedEnvironment(root, directory, control);
      const format = await this.objectFormat(common, directory, env, execute);
      const safe =
        `[core]\nrepositoryformatversion = ${format === 'sha256' ? 1 : 0}\nbare = false\n` +
        'fsmonitor = false\nhooksPath = /dev/null\npager = cat\nattributesFile = /dev/null\n' +
        'excludesFile = /dev/null\nautocrlf = false\n[protocol]\nallow = never\n' +
        (format === 'sha256' ? '[extensions]\nobjectFormat = sha256\n' : '');
      await this.files.write(config, safe, this.files.hash(Buffer.from(initial)));
      await this.copyMetadata(gitdir, common, control);
      return work(env);
    });
  }

  private async isolatedEnvironment(
    root: string,
    directory: string,
    control: string,
  ): Promise<NodeJS.ProcessEnv> {
    const search: string[] = [];
    for (const path of (process.env.PATH ?? '').split(delimiter)) {
      if (!isAbsolute(path)) continue;
      const canonical = await this.files.canonical(path);
      if (this.files.inside(root, canonical)) continue;
      const executable = join(canonical, 'git');
      if (
        (await this.files.exists(executable)) &&
        this.files.inside(root, await this.files.canonical(executable))
      )
        continue;
      search.push(canonical);
    }
    // Do not inherit Git config, process-launch hooks, dynamic-loader settings or trace paths.
    const env: NodeJS.ProcessEnv = {
      PATH: search.join(delimiter),
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      GIT_DIR: control,
      GIT_WORK_TREE: root,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_ALLOW_PROTOCOL: '',
      GIT_PROTOCOL_FROM_USER: '0',
      GIT_PAGER: 'cat',
    };
    return env;
  }
  private async objectFormat(
    common: string,
    directory: string,
    env: NodeJS.ProcessEnv,
    execute: Execute,
  ): Promise<string> {
    // Parse only a copied primary config, outside its repository and without includes.
    // No configuration value is inherited except the validated object storage format.
    let format = 'sha1';
    const primary = await this.optional(common, 'config');
    if (primary) {
      const source = join(directory, 'source-config');
      await this.files.write(source, primary);
      let settings = '';
      try {
        settings = await execute(
          [
            'config',
            '--null',
            '--file',
            source,
            '--no-includes',
            '--get-regexp',
            '^(core\\.repositoryformatversion|extensions\\..*)$',
          ],
          env,
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
      }
      for (const setting of settings.split('\0').filter(Boolean)) {
        const [key, value] = setting.split('\n');
        if (key === 'extensions.objectformat') {
          if (value !== 'sha1' && value !== 'sha256')
            throw new AtermError('aterm.git', 'Unsupported Git object format.');
          format = value;
        } else if (key === 'core.repositoryformatversion' && value !== '0' && value !== '1') {
          throw new AtermError('aterm.git', 'Unsupported Git repository format.');
        } else if (
          key?.startsWith('extensions.') &&
          !['extensions.worktreeconfig', 'extensions.preciousobjects'].includes(key)
        ) {
          throw new AtermError('aterm.git', 'Unsupported Git repository extension: ' + key);
        }
      }
    }
    return format;
  }
  private async copyMetadata(gitdir: string, common: string, control: string): Promise<void> {
    await this.copy(gitdir, 'HEAD', control, true);
    for (const name of ['refs', 'logs', 'packed-refs', 'shallow'])
      await this.copy(common, name, control);
    if (gitdir !== common) await this.copy(gitdir, 'logs/HEAD', control, true);
    await this.copy(gitdir, 'index', control);
    for (const entry of await this.files.directoryEntries(gitdir))
      if (/^sharedindex\.[a-f0-9]+$/.test(entry.name)) await this.copy(gitdir, entry.name, control);
    await this.copy(common, 'info/exclude', control);
    await this.files.write(
      join(control, 'info/attributes'),
      '* -filter diff -text -crlf -ident -working-tree-encoding\n',
    );
    await this.objects(common, control);
  }

  private async locate(
    workspace: string,
  ): Promise<{ root: string; gitdir: string; common: string }> {
    let root = workspace;
    for (;;) {
      const candidate = join(root, '.git');
      if (await this.files.exists(candidate)) {
        await this.files.guard(root, candidate);
        let gitdir = candidate;
        if ((await this.files.stat(candidate)).isFile()) {
          const text = (await this.files.readBytes(candidate)).toString('utf8').trim();
          if (!/^gitdir: [^\r\n\0]+$/.test(text))
            throw new AtermError('aterm.git', 'Invalid Git directory pointer.');
          gitdir = resolve(root, text.slice(8));
        }
        await this.files.guard(dirname(gitdir), gitdir);
        if (!(await this.files.stat(gitdir)).isDirectory())
          throw new AtermError('aterm.git', 'Expected a Git metadata directory.');
        const pointer = await this.optional(gitdir, 'commondir');
        let common = gitdir;
        if (pointer) {
          const text = pointer.toString('utf8').trim();
          if (!text || /[\r\n\0]/.test(text))
            throw new AtermError('aterm.git', 'Invalid Git common directory pointer.');
          common = resolve(gitdir, text);
          await this.files.guard(dirname(common), common);
        }
        return { root, gitdir, common };
      }
      const parent = dirname(root);
      if (parent === root)
        throw new AtermError('aterm.git', 'Workspace is not in a Git repository.');
      root = parent;
    }
  }

  private async optional(root: string, name: string): Promise<Buffer | undefined> {
    const path = await this.files.guard(root, join(root, name));
    if (!(await this.files.exists(path))) return;
    const stat = await this.files.stat(path);
    if (!stat.isFile()) throw new AtermError('aterm.git', 'Expected regular Git metadata: ' + path);
    if (++this.copiedFiles > 100000 || (this.copiedBytes += stat.size) > 128 * 1024 * 1024)
      throw new AtermError('aterm.git', 'Git control metadata exceeds the read budget.');
    return this.files.readBytes(path);
  }

  private async copy(root: string, name: string, target: string, replace = false): Promise<void> {
    const source = await this.files.guard(root, join(root, name));
    if (!(await this.files.exists(source))) return;
    if ((await this.files.stat(source)).isDirectory()) {
      await this.files.ensureDirectory(join(target, name));
      for (const entry of await this.files.directoryEntries(source))
        await this.copy(root, join(name, entry.name), target, replace);
    } else {
      const bytes = (await this.optional(root, name))!;
      const destination = join(target, name);
      const before =
        replace && (await this.files.exists(destination))
          ? await this.files.readBytes(destination)
          : undefined;
      await this.files.write(destination, bytes, before && this.files.hash(before));
    }
  }

  private async objects(common: string, target: string): Promise<void> {
    const root = await this.files.guard(common, join(common, 'objects'));
    const alternates = await this.optional(root, 'info/alternates');
    if (alternates?.toString('utf8').trim())
      throw new AtermError(
        'aterm.git',
        'Git object alternates are not supported by isolated reads.',
      );
    for (const entry of await this.files.directoryEntries(root)) {
      if (/^[a-f0-9]{2}$/.test(entry.name)) {
        const bucket = await this.files.guard(root, join(root, entry.name));
        if (!(await this.files.stat(bucket)).isDirectory())
          throw new AtermError('aterm.git', 'Expected a Git object directory.');
        await this.files.link(bucket, join(target, 'objects', entry.name));
      } else if (entry.name === 'pack') {
        const pack = await this.files.guard(root, join(root, entry.name));
        for (const file of await this.files.directoryEntries(pack)) {
          if (!/^pack-[a-f0-9]+\.(pack|idx|rev)$/.test(file.name)) continue;
          const source = await this.files.guard(root, join(pack, file.name));
          if (!(await this.files.stat(source)).isFile())
            throw new AtermError('aterm.git', 'Expected a regular Git pack file.');
          await this.files.link(source, join(target, 'objects/pack', file.name));
        }
      }
    }
  }
}
