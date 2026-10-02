import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess, type ITextFile } from '../file-module/index.js';
import { byText } from '../order.js';
import type { IDiagnostic } from '../syntax-module/index.js';

export interface IExternalSelection {
  readonly externalSources?: Readonly<Record<string, string>>;
}
export interface IExternalFile extends ITextFile {
  readonly externalSources: readonly string[];
}
export interface IExternalScan {
  readonly files: readonly IExternalFile[];
  readonly warnings: readonly IDiagnostic[];
}

/** _aterm:External_Files_ holds named glob snapshots outside the corpus Knowledges. */
export class ExternalFiles {
  constructor(private readonly access = new FileAccess()) {}

  /** Literal directory prefixes bound both observation and guarded writes. */
  roots(workspace: string, input: IExternalSelection): readonly string[] {
    const roots = [
      ...new Set(
        Object.values(input.externalSources ?? {}).map((glob) => {
          const pattern = resolve(workspace, glob);
          const magic = pattern.search(/[*?[{(]/);
          return magic < 0 ? dirname(pattern) : dirname(pattern.slice(0, magic) + '_');
        }),
      ),
    ].sort(byText);
    return roots.filter(
      (root) => !roots.some((other) => other !== root && this.access.inside(other, root)),
    );
  }

  async read(workspace: string, input: IExternalSelection): Promise<IExternalScan> {
    const files: IExternalFile[] = [];
    const warnings: IDiagnostic[] = [];
    const patterns = Object.entries(input.externalSources ?? {})
      .sort(([a], [b]) => byText(a, b))
      .map(([name, pattern]) => [name, resolve(workspace, pattern)] as const);
    const label = (file: string) => relative(workspace, file).split(sep).join('/');
    const excluded = (name: string) =>
      name === '.git' || name === 'node_modules' || name.startsWith('.aterm');
    const visit = async (directory: string, source: string): Promise<void> => {
      const entries = await this.access.directoryEntries(directory);
      for (const entry of entries.sort((a, b) => byText(a.name, b.name))) {
        if (excluded(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          warnings.push({
            file: label(path),
            line: 1,
            message: `Skipped external symlink: ${label(path)}`,
          });
          continue;
        }
        await this.access.guard(source, path);
        if (entry.isDirectory()) {
          await visit(path, source);
          continue;
        }
        if (!entry.isFile() || /\.trm$/i.test(entry.name)) continue;
        const names = patterns
          .filter(([, pattern]) => matchesGlob(path, pattern))
          .map(([name]) => name);
        if (!names.length) continue;
        const bytes = await this.access.readBytes(path);
        const text = bytes.toString('utf8');
        if (bytes.includes(0) || !Buffer.from(text, 'utf8').equals(bytes))
          throw new AtermError(
            'external.encoding',
            `External file must be UTF-8 text without NUL: ${label(path)}`,
          );
        files.push({
          path: label(path),
          absolutePath: path,
          source,
          externalSources: names,
          text,
          version: this.access.hash(bytes),
        });
      }
    };
    for (const root of this.roots(workspace, input)) {
      if (root.split(sep).some(excluded)) continue;
      try {
        if ((await this.access.canonical(root)) !== root)
          throw new AtermError(
            'external.directory',
            `External glob root must be a directory without symlinks: ${root}`,
          );
        if (!(await this.access.exists(root))) continue;
        const stat = await this.access.stat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new AtermError(
            'external.directory',
            `External glob root must be a directory without symlinks: ${root}`,
          );
        await visit(root, root);
      } catch (error) {
        if (error instanceof AtermError) throw error;
        throw new AtermError(
          'external.read',
          `Cannot read external glob root ${root}: ${String(error)}`,
        );
      }
    }
    return { files: files.sort((a, b) => byText(a.path, b.path)), warnings };
  }
}
