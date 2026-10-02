import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FileAccess, UsageLog } from '../file-module/index.js';
import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import { atermQuery, readOperations, graphqlRequest } from '../query-module/index.js';
import { readJsonBody } from './http-body.js';
import { AtermSnapshot } from './snapshot.js';
import type { AtermApplication } from '../application.js';
import type { AtermQuery } from '../query-module/index.js';
import { serverProtocol } from './protocol.js';
import { UIService } from './ui-service.js';
import { acceptsServerOrigin, serverUrl } from './address.js';
export { serverProtocol } from './protocol.js';

export interface IServerExtension {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  close(): Promise<void>;
}

/** HTTP reads, UI sessions and an optional command transport share one Home. */
export class AtermServer {
  private readonly listener = createServer((request, response) => {
    void this.handle(request, response);
  });
  private readonly snapshot: AtermSnapshot;
  readonly port: number;
  readonly host: string;
  private identity = '';
  private closing?: Promise<void>;
  private ui?: UIService;

  private extension?: IServerExtension;

  constructor(private readonly config: IAtermConfig) {
    if (!config.server)
      throw new AtermError('server.config', 'aterm server run requires server.port in aterm.yaml.');
    this.port = config.server.port;
    this.host = config.server.host;
    this.snapshot = new AtermSnapshot(config.home);
    this.listener.requestTimeout = 60_000;
    this.listener.headersTimeout = 10_000;
  }

  useExtension(extension: IServerExtension): void {
    this.extension = extension;
  }
  application(): Promise<AtermApplication> {
    return this.snapshot.currentApplication();
  }
  query(query: AtermQuery) {
    return this.snapshot.query(query);
  }
  refresh(): Promise<void> {
    return this.snapshot.refreshNow();
  }
  requestUI(request: unknown) {
    if (!this.ui) throw new AtermError('ui.server', 'UI service is not running.');
    return this.ui.request(request);
  }
  get publicOrigin(): string | undefined {
    return this.config.server?.publicOrigin;
  }

  get url(): string {
    return serverUrl(this);
  }

  async start(): Promise<void> {
    this.identity = await new FileAccess().canonical(this.config.home.home);
    await this.snapshot.start();
    this.ui = new UIService(this.config, this.identity, this.snapshot);
    this.ui.attach(this.listener);
    try {
      await new Promise<void>((resolve, reject) => {
        this.listener.once('error', reject);
        this.listener.listen(this.port, this.host, () => {
          this.listener.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.ui.close();
      await this.snapshot.close();
      throw new AtermError('server.listen', `Cannot listen at ${this.url}: ${String(error)}`);
    }
  }

  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.snapshot.stopObserving();
      this.ui?.close();
      await this.extension?.close();
      await new Promise<void>((resolve, reject) => {
        if (!this.listener.listening) return resolve();
        this.listener.close((error) => (error ? reject(error) : resolve()));
        this.listener.closeIdleConnections();
      });
      await this.snapshot.close();
      await new UsageLog(this.config.home.home).flush();
    })());
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Paths/queries, headers and bodies can contain private values. Record only
    // known route categories, never the original URL or authorization material.
    const path = request.url?.split('?')[0];
    const route = ['/mcp', '/graphql', '/api/query', '/api/ui', '/api/health'].includes(path ?? '')
      ? path!
      : 'other';
    const span = new UsageLog(this.config.home.home).start('http', route, {
      method: ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'].includes(request.method ?? '')
        ? request.method
        : 'other',
      contentLength: Number(request.headers['content-length']) || undefined,
    });
    response.setHeader('X-Aterm-Request-Id', span.requestId);
    response.once('finish', () => {
      void span.finish({
        outcome: response.statusCode >= 400 ? 'error' : 'ok',
        status: response.statusCode,
      });
    });
    response.once('close', () => {
      if (!response.writableFinished)
        void span.finish({ outcome: 'disconnected', status: response.statusCode });
    });
    await span.run(() => this.handleRequest(request, response));
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    try {
      if (!acceptsServerOrigin(request.headers, this)) {
        send(403, {
          error: {
            code: 'server.origin',
            message:
              'Host must match the listening address and port; Origin must match the request URL.',
          },
        });
        return;
      }
      if (await this.extension?.handle(request, response)) return;
      if (request.url === '/graphql') {
        await this.serveGraphQL(request, response, send);
        return;
      }
      if (await this.serveAsset(request, response, send)) return;
      await this.serveAPI(request, send);
    } catch (error) {
      if (!response.destroyed && !response.headersSent) send(400, { error: this.describe(error) });
    }
  }

  private async serveGraphQL(
    request: IncomingMessage,
    response: ServerResponse,
    send: (status: number, value: unknown) => void,
  ): Promise<void> {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(405, { errors: [{ message: 'Use POST.' }] });
      return;
    }
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      send(415, { errors: [{ message: 'Use Content-Type: application/json.' }] });
      return;
    }
    let input;
    try {
      input = graphqlRequest.parse(await readJsonBody(request, 1024 * 1024));
    } catch (error) {
      send(error instanceof AtermError && error.code === 'server.body' ? 413 : 400, {
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      });
      return;
    }
    try {
      const result = await this.snapshot.query({ operation: 'graphql', graphql: input });
      if (!('operation' in result) || result.operation !== 'graphql')
        throw new Error('Expected GraphQL result.');
      send(200, result.response);
    } catch (error) {
      send(200, {
        errors: [
          {
            message: this.describe(error).message,
            extensions: { code: this.describe(error).code },
          },
        ],
      });
    }
    return;
  }
  private async serveAsset(
    request: IncomingMessage,
    response: ServerResponse,
    send: (status: number, value: unknown) => void,
  ): Promise<boolean> {
    const assets: Record<string, { file: string; type: string }> = {
      '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
      '/graph-layout.js': { file: 'graph-layout.js', type: 'text/javascript; charset=utf-8' },
      '/graph-geometry.js': { file: 'graph-geometry.js', type: 'text/javascript; charset=utf-8' },
      '/elk-api.js': { file: 'elk-api.js', type: 'text/javascript; charset=utf-8' },
      '/elk-worker.min.js': { file: 'elk-worker.min.js', type: 'text/javascript; charset=utf-8' },
      '/force-layout-worker.js': {
        file: 'force-layout-worker.js',
        type: 'text/javascript; charset=utf-8',
      },
      '/graph.js': { file: 'graph.js', type: 'text/javascript; charset=utf-8' },
      '/graph-model.js': { file: 'graph-model.js', type: 'text/javascript; charset=utf-8' },
      '/graph-state.js': { file: 'graph-state.js', type: 'text/javascript; charset=utf-8' },
      '/graph-explore-model.js': {
        file: 'graph-explore-model.js',
        type: 'text/javascript; charset=utf-8',
      },
      '/library-model.js': { file: 'library-model.js', type: 'text/javascript; charset=utf-8' },
      '/identity.js': { file: 'identity.js', type: 'text/javascript; charset=utf-8' },
      '/routes.js': { file: 'routes.js', type: 'text/javascript; charset=utf-8' },
      '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
      '/markdown.js': { file: 'markdown.js', type: 'text/javascript; charset=utf-8' },
      '/mermaid.js': { file: 'mermaid.js', type: 'text/javascript; charset=utf-8' },
      '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
    };
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const uiRoute =
      /^\/(?:queries|term-declarations|references|terms\/[^/]+\/[^/]+(?:\/references)?|graph\/(?:structure|explore)|diagnostics)\/?$/.test(
        pathname,
      );
    const asset = Object.hasOwn(assets, pathname)
      ? assets[pathname]
      : uiRoute
        ? assets['/']
        : undefined;
    if (asset) {
      if (request.method !== 'GET') {
        send(405, { error: { code: 'server.method', message: 'Use GET.' } });
        return true;
      }
      const bytes = await new FileAccess().readBytes(
        fileURLToPath(new URL('../../webapp/' + asset.file, import.meta.url)),
      );
      response.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(bytes);
      return true;
    }
    return false;
  }
  private async serveAPI(
    request: IncomingMessage,
    send: (status: number, value: unknown) => void,
  ): Promise<void> {
    if (!['/api/health', '/api/query', '/api/ui'].includes(request.url ?? '')) {
      send(404, { error: { code: 'server.route', message: 'Unknown API route.' } });
      return;
    }
    const method = request.url === '/api/health' ? 'GET' : 'POST';
    if (request.method !== method) {
      send(405, { error: { code: 'server.method', message: `Use ${method}.` } });
      return;
    }
    if (request.url === '/api/health') {
      send(200, {
        protocol: serverProtocol,
        home: this.identity,
        revision: this.snapshot.revision,
        ready: !this.snapshot.error,
        ...(this.snapshot.error ? { error: this.describe(this.snapshot.error) } : {}),
      });
      return;
    }
    if (
      request.headers['x-aterm-protocol'] !== String(serverProtocol) ||
      request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
    )
      throw new AtermError(
        'server.protocol',
        `Query requires application/json and X-Aterm-Protocol: ${serverProtocol}.`,
      );
    if (request.url === '/api/ui' && !this.ui!.authorized(request)) {
      send(403, {
        error: {
          code: 'ui.authorization',
          message: 'UI control requires a local CLI or the configured Bearer token.',
        },
      });
      return;
    }
    const field = request.url === '/api/ui' ? 'request' : 'query';
    const envelope = await this.readEnvelope(request, field);
    if (envelope.home !== this.identity) {
      send(409, {
        error: { code: 'server.home', message: 'Request Home does not match this server.' },
      });
      return;
    }
    if (field === 'request') {
      send(200, await this.ui!.request(envelope.request));
      return;
    }
    const parsed = atermQuery.safeParse(envelope.query);
    if (!parsed.success) throw new AtermError('aterm.query', parsed.error.message);
    if (!(readOperations as readonly string[]).includes(parsed.data.operation))
      throw new AtermError(
        'server.readonly',
        'HTTP accepts read queries only; run authoring through the local CLI.',
      );
    send(200, await this.snapshot.query(parsed.data));
  }
  private async readEnvelope(
    request: IncomingMessage,
    field: 'request' | 'query',
  ): Promise<{ home?: unknown; query?: unknown; request?: unknown }> {
    const body = await readJsonBody(request, 8 * 1024 * 1024);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['home', field].includes(key))
    )
      throw new AtermError('server.body', `Expected { home, ${field} }.`);
    return body as { home?: unknown; query?: unknown; request?: unknown };
  }
  private describe(error: unknown): { code: string; message: string } {
    return {
      code: error instanceof AtermError ? error.code : 'server.error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
