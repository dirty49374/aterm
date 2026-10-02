import { FileAccess } from '../file-module/index.js';
import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import { serverClientUrl } from './address.js';
import { serverProtocol } from './protocol.js';
import { uiRequest, type UIRequest, type UIResult } from './ui-protocol.js';

export class UIClient {
  async request(config: IAtermConfig, request: UIRequest): Promise<UIResult> {
    const parsed = uiRequest.safeParse(request);
    if (!parsed.success) throw new AtermError('ui.request', parsed.error.message);
    if (!config.server)
      throw new AtermError(
        'ui.server',
        'UI commands require server.port and a running aterm server run.',
      );
    const home = await new FileAccess().canonical(config.home.home);
    try {
      const response = await fetch(serverClientUrl(config.server) + '/api/ui', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(35000),
        headers: {
          'Content-Type': 'application/json',
          'X-Aterm-Protocol': String(serverProtocol),
          ...(config.server.controlToken
            ? { Authorization: `Bearer ${config.server.controlToken}` }
            : {}),
        },
        body: JSON.stringify({ home, request }),
      });
      const result = (await response.json()) as
        | UIResult
        | { error: { code: string; message: string } };
      if ('error' in result) throw new AtermError(result.error.code, result.error.message);
      if (!response.ok)
        throw new AtermError('ui.response', `Server returned HTTP ${response.status}.`);
      return result;
    } catch (error) {
      if (error instanceof AtermError) throw error;
      throw new AtermError(
        'ui.connection',
        `UI server request failed; no filesystem fallback. ${'id' in request ? `Command ID: ${request.id}. Inspect its result before resending. ` : ''}${String(error)}`,
      );
    }
  }
}
