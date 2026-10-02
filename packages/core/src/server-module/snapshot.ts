import { ExternalFiles, type IExternalScan } from '../external-module/index.js';
import { AtermApplication, type AtermResult } from '../application.js';
import { AtermConfigReader, type IAtermConfig, type IAtermHome } from '../home-module/index.js';
import { guideSource } from '../home-module/package.js';
import { viewpointSource } from '../home-module/init.js';
import { AtermScanner } from '../corpus-module/index.js';
import type { AtermQuery } from '../query-module/index.js';
import { FileMonitor } from './file-monitor.js';

/** Complete published scans, refreshed by debounced file events or hosted writes. */
export class AtermSnapshot {
  revision = 0;
  error: unknown;
  private application?: AtermApplication;
  private readonly subscribers = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
  private fingerprint?: string;
  private readonly monitor = new FileMonitor(() => this.schedule());
  private config?: IAtermConfig;
  private viewpointPaths: readonly string[] = [];
  private debounce?: ReturnType<typeof setTimeout>;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private observing = true;
  private debounceMs = 200;
  private eventVersion = 0;

  constructor(private readonly home: IAtermHome) {}

  async start(): Promise<void> {
    await this.run(() => this.refresh());
  }

  async query(query: AtermQuery): Promise<AtermResult> {
    if (this.closed) throw new Error('Server snapshot is closed.');
    if (this.error) throw this.error;
    // Capture one published application. Background reconciliation can replace the
    // pointer, but cannot change the state used by this request.
    const application = this.application;
    if (!application) throw new Error('Server snapshot is not ready.');
    return application.query(query);
  }

  async currentApplication(): Promise<AtermApplication> {
    if (this.closed) throw new Error('Server snapshot is closed.');
    if (this.error) throw this.error;
    if (!this.application) throw new Error('Server snapshot is not ready.');
    return this.application;
  }

  async refreshNow(): Promise<void> {
    await this.run(() => this.refresh(true));
  }

  stopObserving(): void {
    this.observing = false;
    clearTimeout(this.debounce);
    this.debounce = undefined;
    this.monitor.close();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopObserving();
    await this.pending;
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  private schedule(): void {
    if (this.closed || !this.observing) return;
    this.eventVersion++;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      const version = this.eventVersion;
      void this.run(async () => {
        if (version === this.eventVersion && !this.debounce) await this.refresh();
      });
    }, this.debounceMs);
  }

  private async refresh(force = false): Promise<void> {
    if (this.closed) return;
    const before = JSON.stringify([this.revision, String(this.error)]);
    const version = this.eventVersion;
    try {
      // Keep config repair reachable even when the previous watched set failed.
      // The final set must be observed successfully before publishing a scan.
      await this.observe().catch(() => {});
      const config = await new AtermConfigReader().read(this.home, async (paths) => {
        this.viewpointPaths = paths;
        await this.observe().catch(() => {});
      });
      this.config = config;
      this.debounceMs = config.server?.debounceMs ?? 200;
      await this.observe();
      const scan = await new AtermScanner().scan(config);
      const external: IExternalScan | Error | undefined =
        config.server?.watchExternal && config.externalSources
          ? await new ExternalFiles()
              .read(config.home.workspace, config)
              .catch((error: unknown) =>
                error instanceof Error ? error : new Error(String(error)),
              )
          : undefined;
      // A scan overtaken by filesystem events is replaced only after the burst settles.
      if (!force && this.eventVersion !== version) return;
      const fingerprint = JSON.stringify([
        config,
        scan.trmFiles.map((trmFile) => [trmFile.absolutePath, trmFile.source, trmFile.version]),
        scan.diagnostics,
        external instanceof Error
          ? external.message
          : external?.files.map((file) => [file.absolutePath, file.version, file.externalSources]),
        external instanceof Error ? undefined : external?.warnings,
      ]);
      if (fingerprint !== this.fingerprint || this.error) {
        this.application = new AtermApplication(config, scan, external);
        this.fingerprint = fingerprint;
        this.revision++;
      }
      this.error = undefined;
    } catch (error) {
      if (!force && this.eventVersion !== version) return;
      this.error = error;
    } finally {
      if (before !== JSON.stringify([this.revision, String(this.error)]))
        for (const listener of this.subscribers) listener();
    }
  }

  private async observe(): Promise<void> {
    if (!this.observing) return;
    const config = this.config;
    const directories = new Set([
      ...(config?.sources ?? []),
      ...(config?.server?.watchExternal
        ? new ExternalFiles().roots(this.home.workspace, config)
        : []),
      guideSource,
      viewpointSource,
    ]);
    await this.monitor.update([
      ...[this.home.configPath, ...this.viewpointPaths].map((path) => ({ path, directory: false })),
      ...[...directories].map((path) => ({ path, directory: true })),
    ]);
  }
}
