import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const usageLogMaxBytes = 5 * 1024 * 1024;
const retainedBytes = 4 * 1024 * 1024;
const context = new AsyncLocalStorage<UsageSpan>();
const pending = new Map<string, Promise<void>>();
const warned = new Set<string>();
type Fields = Readonly<Record<string, string | number | boolean | undefined>>;

/** _aterm:Usage_Log_: bounded, payload-free execution evidence shared by adapters. */
export class UsageLog {
  readonly path: string;
  constructor(private readonly home: string) {
    this.path = join(home, 'usage.jsonl');
  }

  start(kind: 'command' | 'mcp' | 'http', operation: string, fields: Fields = {}): UsageSpan {
    const active = context.getStore();
    const parent =
      (kind === 'mcp' && active?.kind === 'http') || (kind === 'command' && active?.kind === 'mcp')
        ? active
        : undefined;
    return new UsageSpan(this, kind, operation, fields, parent);
  }

  async write(fields: Fields): Promise<void> {
    const record = Buffer.from(
      JSON.stringify({ time: new Date().toISOString(), pid: process.pid, ...fields }) + '\n',
    );
    const work = (pending.get(this.path) ?? Promise.resolve()).then(() => this.append(record));
    const safe = work.catch((error: unknown) => {
      if (!warned.has(this.path)) {
        warned.add(this.path);
        const code = (error as NodeJS.ErrnoException).code ?? 'unavailable';
        process.stderr.write(`Aterm usage log unavailable (${code}); operations continue.\n`);
      }
    });
    pending.set(this.path, safe);
    await safe;
    if (pending.get(this.path) === safe) pending.delete(this.path);
  }

  async flush(): Promise<void> {
    while (pending.has(this.path)) await pending.get(this.path);
  }

  private async append(record: Buffer): Promise<void> {
    if (record.length > usageLogMaxBytes) throw new Error('Usage record exceeds log limit.');
    const lock = join(this.home, '.aterm-usage-lock');
    await this.acquireLock(lock);
    const temporary = join(this.home, `.aterm-usage-${randomUUID()}`);
    try {
      const file = await open(
        this.path,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_APPEND |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new Error('Usage log must be a regular file.');
        const size = info.size;
        if (size + record.length > usageLogMaxBytes) {
          await this.compact(file, size, record, temporary);
        } else {
          await file.writeFile(record);
        }
      } finally {
        await file.close();
      }
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
  private async acquireLock(lock: string): Promise<void> {
    const deadline = performance.now() + 1000;
    while (true) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // A terminated writer cannot retain the log indefinitely. Critical sections
        // contain only bounded local file I/O; never command execution or network I/O.
        try {
          if (Date.now() - (await stat(lock)).mtimeMs > 30_000) {
            await rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw failure;
        }
        if (performance.now() >= deadline) throw error;
        await delay(10);
      }
    }
  }
  private async compact(
    file: import('node:fs/promises').FileHandle,
    size: number,
    record: Buffer,
    temporary: string,
  ): Promise<void> {
    const keep = Math.min(size, retainedBytes, usageLogMaxBytes - record.length);
    const tail = Buffer.alloc(keep);
    let offset = 0;
    while (offset < keep) {
      const { bytesRead } = await file.read(tail, offset, keep - offset, size - keep + offset);
      if (!bytesRead) throw new Error('Usage log changed during compaction.');
      offset += bytesRead;
    }
    // Cut at a complete JSON line, also preserving UTF-8 character boundaries.
    const boundary = size > keep ? tail.indexOf(10) + 1 : 0;
    const retained = boundary === 0 && size > keep ? Buffer.alloc(0) : tail.subarray(boundary);
    const replacement = await open(temporary, 'wx', 0o600);
    try {
      await replacement.writeFile(Buffer.concat([retained, record]));
    } finally {
      await replacement.close();
    }
    await rename(temporary, this.path);
  }
}

export class UsageSpan {
  readonly id = randomUUID();
  readonly requestId: string;
  private readonly started = performance.now();
  private readonly ready: Promise<void>;
  private ended = false;
  private readonly fields: Fields;
  constructor(
    log: UsageLog,
    readonly kind: string,
    operation: string,
    fields: Fields,
    parent?: UsageSpan,
  ) {
    this.log = log;
    this.requestId = parent?.requestId ?? this.id;
    this.fields = {
      kind,
      operation,
      requestId: this.requestId,
      spanId: this.id,
      parentId: parent?.id,
    };
    this.ready = log.write({ ...fields, ...this.fields, event: 'start' });
  }
  private readonly log: UsageLog;
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.ready;
    return context.run(this, work);
  }
  async phase(phase: string, fields: Fields = {}): Promise<void> {
    await this.ready;
    await this.log.write({ ...fields, ...this.fields, event: 'phase', phase });
  }
  async finish(fields: Fields = {}): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.ready;
    await this.log.write({
      ...fields,
      ...this.fields,
      event: 'finish',
      durationMs: Math.round(performance.now() - this.started),
    });
  }
}
