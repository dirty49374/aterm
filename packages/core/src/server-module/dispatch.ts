import { FileAccess } from '../file-module/index.js';
import { AtermApplication, type AtermResult } from '../application.js';
import { AtermError } from '../error.js';
import { readOperations, type AtermQuery } from '../query-module/index.js';
import { serverProtocol } from './protocol.js';
import { serverClientUrl } from './address.js';

/** Read-only server discovery; writes never probe or depend on an HTTP listener. */
export class AtermDispatch {
  async query(application: AtermApplication, query: AtermQuery): Promise<AtermResult> {
    const server = application.config.server;
    if (!server || !(readOperations as readonly string[]).includes(query.operation))
      return application.query(query);
    const url = serverClientUrl(server);
    let health: Response;
    try {
      health = await fetch(url + '/api/health', {
        signal: AbortSignal.timeout(1500),
        redirect: 'error',
      });
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED')
        return application.query(query);
      throw new AtermError('server.discovery', `Cannot verify server ${url}: ${String(error)}`);
    }
    const home = await new FileAccess().canonical(application.home.home);
    const identity = (await health.json().catch(() => undefined)) as
      | { home?: string; protocol?: number }
      | undefined;
    if (!health.ok || identity?.protocol !== serverProtocol || identity.home !== home)
      throw new AtermError(
        'server.identity',
        `Server at ${url} has an incompatible protocol or belongs to another Home.`,
      );
    // No fallback beyond this point: a server error is a server error, not a second local query.
    try {
      const response = await fetch(url + '/api/query', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(
          (query.operation === 'discover' ? 120_000 : 30_000) + server.debounceMs,
        ),
        headers: { 'Content-Type': 'application/json', 'X-Aterm-Protocol': String(serverProtocol) },
        body: JSON.stringify({ home, query }),
      });
      const result = (await response.json()) as
        | AtermResult
        | { error: { code: string; message: string } };
      if ('error' in result) throw new AtermError(result.error.code, result.error.message);
      if (!response.ok)
        throw new AtermError('server.response', `Server returned HTTP ${response.status}.`);
      return result;
    } catch (error) {
      if (error instanceof AtermError) throw error;
      throw new AtermError(
        'server.request',
        `Server request failed; no local retry: ${String(error)}`,
      );
    }
  }
}
