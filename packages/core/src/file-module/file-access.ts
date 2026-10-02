import { watch, type FSWatcher } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  readdir,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AtermError } from '../error.js';

/** A versioned text snapshot shared by corpus and explicitly selected external files. */
export interface ITextFile {
  readonly path: string;
  readonly absolutePath: string;
  readonly source: string;
  readonly text: string;
  readonly version: string;
}

export interface IFileAccess {
  watchDirectory(
    path: string,
    changed: (filename: string | null) => void,
    recursive?: boolean,
  ): FSWatcher;
  readBytes(path: string): Promise<Buffer>;
  stat(path: string): ReturnType<typeof lstat>;
  directoryEntries(path: string): Promise<import('node:fs').Dirent[]>;
  hash(bytes: Uint8Array | string): string;
  inside(workspace: string, target: string): boolean;
  exists(path: string): Promise<boolean>;
  missing(error: unknown): boolean;
  canonical(path: string): Promise<string>;
  guard(workspace: string, path: string, allowRoot?: boolean): Promise<string>;
  assertWritable(path: string): void;
  write(path: string, text: string | Uint8Array, expected?: string, mode?: number): Promise<void>;
  remove(path: string, expected: string): Promise<void>;
  exclusive<T>(directory: string, work: () => Promise<T>): Promise<T>;
}

/** Guarded, conflict-checked file writes under a configured workspace; no path is trusted as given. */
export class FileAccess implements IFileAccess {
  /** Git metadata is never an Aterm authoring destination, including a gitdir file. */
  assertWritable(path: string): void {
    if (
      resolve(path)
        .split(/[\\/]/)
        .some((part) => part.toLowerCase() === '.git')
    )
      throw new AtermError(
        'path.reserved',
        'Git metadata is reserved; Aterm cannot write or delete: ' + path,
      );
  }
  /** The callback owns only this newly created private directory. */
  async temporary<T>(prefix: string, work: (directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    try {
      return await work(await realpath(directory));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  /** Private adapters may link opaque, read-only data into an owned temporary directory. */
  async link(source: string, target: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    await symlink(source, target);
  }
  ensureDirectory(path: string): Promise<string | undefined> {
    return mkdir(path, { recursive: true });
  }
  watchDirectory(
    path: string,
    changed: (filename: string | null) => void,
    recursive = true,
  ): FSWatcher {
    return watch(path, { recursive }, (_event, filename) => changed(filename));
  }
  readBytes(path: string): Promise<Buffer> {
    return readFile(path);
  }
  stat(path: string) {
    return lstat(path);
  }
  directoryEntries(path: string) {
    return readdir(path, { withFileTypes: true });
  }
  hash(bytes: Uint8Array | string): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
  inside(workspace: string, target: string): boolean {
    const path = relative(workspace, target);
    return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (this.missing(error)) return false;
      throw error;
    }
  }
  missing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
  /** Resolve only existing ancestors, retaining a missing destination's suffix. */
  async canonical(path: string): Promise<string> {
    try {
      return await realpath(path);
    } catch (error) {
      if (!this.missing(error)) throw error;
      const parent = dirname(path);
      if (parent === path) throw error;
      return join(await this.canonical(parent), relative(parent, path));
    }
  }
  async guard(workspace: string, path: string, allowRoot = false): Promise<string> {
    const target = resolve(path);
    if (!this.inside(resolve(workspace), target) || (!allowRoot && target === resolve(workspace)))
      throw new AtermError('path.outside', 'File is outside the selected sources: ' + path);
    let part = resolve(workspace);
    if ((await lstat(part)).isSymbolicLink() || (await realpath(part)) !== part)
      throw new AtermError('path.symlink', 'Symlink in a selected source: ' + part);
    if (target === part) return target;
    // The selected root and its descendants must retain their physical identity.
    for (const segment of relative(part, target).split('/')) {
      part = join(part, segment);
      try {
        if ((await lstat(part)).isSymbolicLink())
          throw new AtermError('path.symlink', 'Symlink inside a selected source: ' + part);
      } catch (error) {
        if (!this.missing(error)) throw error;
      }
    }
    if (!this.inside(await this.canonical(workspace), await this.canonical(target)))
      throw new AtermError('path.outside', 'Resolved file is outside the selected sources');
    return target;
  }
  async write(
    path: string,
    text: string | Uint8Array,
    expected?: string,
    mode?: number,
  ): Promise<void> {
    this.assertWritable(path);
    await mkdir(dirname(path), { recursive: true });
    if (expected === undefined) {
      try {
        await this.create(path, text, mode);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new AtermError('file.exists', 'File already exists: ' + path);
        throw error;
      }
      return;
    }
    const original = await lstat(path);
    if (!original.isFile()) throw new AtermError('path.file', 'Expected a regular file');
    if (this.hash(await readFile(path)) !== expected)
      throw new AtermError('file.conflict', 'File changed; read it again before updating');
    const temp = join(dirname(path), '.aterm-write-' + randomUUID());
    try {
      await this.create(temp, text, original.mode);
      if ((await lstat(path)).isSymbolicLink() || this.hash(await readFile(path)) !== expected)
        throw new AtermError('file.conflict', 'File changed before replacement');
      await rename(temp, path);
    } finally {
      // Only the uniquely owned temporary file is removed; failed user data is never discarded.
      await unlink(temp).catch((error) => {
        if (!this.missing(error)) throw error;
      });
    }
  }
  async remove(path: string, expected: string): Promise<void> {
    this.assertWritable(path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new AtermError('path.file', 'Expected a regular file');
    if (this.hash(await readFile(path)) !== expected)
      throw new AtermError('file.conflict', 'File changed; read it again before deleting');
    await unlink(path);
  }

  private async create(path: string, text: string | Uint8Array, mode?: number): Promise<void> {
    const permissions = mode === undefined ? undefined : mode & 0o7777;
    const file = await open(path, 'wx', permissions);
    try {
      await file.writeFile(text);
      // Creation applies umask; restore the exact source mode on the owned file handle.
      if (permissions !== undefined) await file.chmod(permissions);
    } finally {
      await file.close();
    }
  }
  async exclusive<T>(directory: string, work: () => Promise<T>): Promise<T> {
    this.assertWritable(directory);
    const lock = join(directory, '.aterm-write-lock');
    await mkdir(directory, { recursive: true });
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new AtermError(
          'write.busy',
          'Another aterm writer is active, or its retained lock needs inspection: ' + lock,
        );
      throw error;
    }
    try {
      return await work();
    } finally {
      await rmdir(lock);
    }
  }
}
