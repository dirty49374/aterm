import type { FSWatcher } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/index.js';

interface WatchTarget {
  readonly path: string;
  readonly directory: boolean;
}

interface DirectoryWatch {
  readonly identity: string;
  readonly recursive: boolean;
  readonly watcher: FSWatcher;
}

/** Native observation; only failed watcher setup is retried, never corpus reads. */
export class FileMonitor {
  private readonly files = new FileAccess();
  private readonly watchers = new Map<string, DirectoryWatch>();
  private targets: readonly WatchTarget[] = [];
  private retry?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly changed: () => void) {}

  update(targets: readonly WatchTarget[]): Promise<void> {
    const result = this.pending.then(async () => {
      if (this.closed) return;
      this.targets = targets.map((target) => ({ ...target, path: resolve(target.path) }));
      try {
        await this.synchronize();
        clearTimeout(this.retry);
        this.retry = undefined;
      } catch (error) {
        this.retryWatching();
        throw error;
      }
    });
    this.pending = result.catch(() => {});
    return result;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    for (const { watcher } of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private retryWatching(): void {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      // A successful repair requests one settled refresh; repeated failures only
      // retry watcher setup and leave the snapshot's failure visible.
      void this.update(this.targets)
        .then(() => {
          if (!this.closed) this.changed();
        })
        .catch(() => {});
    }, 1000);
  }

  private relevant(path: string): boolean {
    return this.targets.some((target) => {
      // Ancestor creation, deletion or replacement can change a selected root.
      if (this.files.inside(path, target.path)) return true;
      if (!target.directory || !this.files.inside(target.path, path)) return false;
      return !relative(target.path, path)
        .split(sep)
        .some((part) => part === '.git' || part === 'node_modules' || part.startsWith('.aterm'));
    });
  }

  private async synchronize(): Promise<void> {
    const requested = new Map<string, boolean>();
    for (const target of this.targets) {
      if (target.directory) requested.set(target.path, true);
      // Shallow ancestor watches detect missing roots and replaced inodes without
      // recursively observing an unrelated Workspace, user home or filesystem.
      let parent = dirname(target.path);
      while (true) {
        if (!requested.has(parent)) requested.set(parent, false);
        const next = dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    const desired = new Map<string, { identity: string; recursive: boolean }>();
    let failure: unknown;
    for (const [path, recursive] of requested) {
      try {
        const stat = await this.files.stat(path);
        if (stat.isDirectory())
          desired.set(path, { identity: `${stat.dev}:${stat.ino}`, recursive });
      } catch (error) {
        if (!this.files.missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTDIR')
          failure ??= new AtermError('server.watch', `Cannot monitor ${path}: ${String(error)}`);
      }
    }
    if (this.closed) return;
    for (const [path, active] of this.watchers) {
      const wanted = desired.get(path);
      if (wanted?.identity !== active.identity || wanted?.recursive !== active.recursive) {
        active.watcher.close();
        this.watchers.delete(path);
      }
    }
    for (const [path, attributes] of desired) {
      if (this.watchers.has(path)) continue;
      try {
        const watcher = this.files.watchDirectory(
          path,
          (filename) => {
            if (!this.closed && (filename === null || this.relevant(resolve(join(path, filename)))))
              this.changed();
          },
          attributes.recursive,
        );
        watcher.on('error', () => {
          watcher.close();
          if (this.watchers.get(path)?.watcher !== watcher) return;
          this.watchers.delete(path);
          this.retryWatching();
          if (!this.closed) this.changed();
        });
        this.watchers.set(path, { ...attributes, watcher });
      } catch (error) {
        failure ??= new AtermError('server.watch', `Cannot monitor ${path}: ${String(error)}`);
      }
    }
    if (failure) throw failure;
  }
}
