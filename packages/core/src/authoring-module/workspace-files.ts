import { isAbsolute, relative, resolve } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/index.js';
import { AtermConfigReader, type IAtermHome } from '../home-module/index.js';
import { isDefaultResource } from '../home-module/defaults.js';
import { assertDefaultWritable } from './writable.js';
import { byText } from '../order.js';

export interface IFileRequest {
  readonly operation: 'file-list' | 'file-read' | 'file-write' | 'file-delete';
  readonly path: string;
  readonly text?: string;
  readonly dryRun?: boolean;
  readonly ifMatch?: string;
}
export interface IWorkspaceFileResult {
  readonly operation: IFileRequest['operation'];
  readonly path: string;
  readonly text?: string;
  readonly version?: string;
  readonly entries?: readonly { name: string; type: 'file' | 'directory' | 'symlink' | 'other' }[];
  readonly saved?: boolean;
  readonly dryRun?: boolean;
  readonly before?: string;
  readonly after?: string;
}

/** _aterm:Workspace_File_Access_: raw text access independent of configuration and corpus validity. */
export class WorkspaceFiles {
  readonly files = new FileAccess();
  constructor(readonly home: IAtermHome) {}

  async path(input: string, directory = false): Promise<string> {
    if (!input || isAbsolute(input))
      throw new AtermError('file.path', 'Use a nonempty Workspace-relative path.');
    const path = resolve(this.home.workspace, input);
    return this.files.guard(this.home.workspace, path, directory);
  }

  async read(path: string): Promise<{ text: string; version: string }> {
    if (!(await this.files.stat(path)).isFile())
      throw new AtermError('file.type', 'Expected a regular UTF-8 text file.');
    const bytes = await this.files.readBytes(path);
    const text = bytes.toString('utf8');
    if (bytes.includes(0) || !Buffer.from(text).equals(bytes))
      throw new AtermError('file.encoding', 'Expected UTF-8 text without NUL bytes.');
    return { text, version: this.files.hash(bytes) };
  }

  async execute(request: IFileRequest): Promise<IWorkspaceFileResult> {
    const path = await this.path(request.path, request.operation === 'file-list');
    const display = relative(this.home.workspace, path).split('\\').join('/') || '.';
    if (request.operation === 'file-list') {
      const entries = (await this.files.directoryEntries(path)).sort((a, b) =>
        byText(a.name, b.name),
      );
      return {
        operation: request.operation,
        path: display,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isSymbolicLink()
            ? 'symlink'
            : e.isDirectory()
              ? 'directory'
              : e.isFile()
                ? 'file'
                : 'other',
        })),
      };
    }
    if (request.operation === 'file-read')
      return { operation: request.operation, path: display, ...(await this.read(path)) };
    this.files.assertWritable(path);
    return this.files.exclusive(this.home.home, async () => {
      await this.path(request.path);
      if (isDefaultResource(path))
        assertDefaultWritable(path, await new AtermConfigReader().allowsDefaultWrites(this.home));
      const before = (await this.files.exists(path)) ? await this.read(path) : undefined;
      if (request.ifMatch !== undefined && request.ifMatch !== before?.version)
        throw new AtermError('file.conflict', 'File version does not match; read it again.');
      if (request.operation === 'file-delete' && !before)
        throw new AtermError('file.missing', 'File does not exist: ' + display);
      if (
        request.operation === 'file-write' &&
        (request.text === undefined ||
          request.text.includes('\0') ||
          Buffer.from(request.text).toString('utf8') !== request.text)
      )
        throw new AtermError('file.encoding', 'Supply UTF-8 text without NUL bytes.');
      if (!request.dryRun) {
        if (request.operation === 'file-delete') await this.files.remove(path, before!.version);
        else await this.files.write(path, request.text!, before?.version);
      }
      return {
        operation: request.operation,
        path: display,
        saved: !request.dryRun,
        dryRun: request.dryRun ?? false,
        before: before?.text,
        ...(request.operation === 'file-write'
          ? { after: request.text, version: this.files.hash(request.text!) }
          : {}),
      };
    });
  }
}
