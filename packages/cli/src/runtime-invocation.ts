import {
  AtermHomeDiscovery,
  AtermError,
  type IAtermOpenOptions,
  type AtermServer,
} from '@aterm/core';
import { runForeground } from './foreground.js';
import type { CommandConnection } from './mcp-module/service.js';
import type { CommandEndpoint } from './mcp-module/endpoint.js';
import type { CliOutput, ICliStreams } from './presentation-module/index.js';

/** Owns foreground server/MCP startup, protocol-safe announcements and cleanup. */
export async function executeRuntime(
  action: 'serve' | 'mcp',
  options: Record<string, unknown>,
  open: IAtermOpenOptions,
  env: NodeJS.ProcessEnv,
  output: CliOutput,
  streams?: ICliStreams,
): Promise<number> {
  const stdio = action === 'mcp';
  const hosted = !stdio || options.withServer === true;
  if (!hosted && (options.host !== undefined || options.port !== undefined))
    throw new AtermError('mcp.options', '--host and --port require mcp run --with-server.');
  const home = await new AtermHomeDiscovery(env).discover(open.cwd!, open.home);
  let server: AtermServer | undefined;
  let endpoint: CommandEndpoint | undefined;
  let connection: CommandConnection | undefined;
  await runForeground(
    async () => {
      if (hosted) {
        const { createServerHost } = await import('./server-host.js');
        ({ server, endpoint } = await createServerHost(home, options));
        await server.start();
        if (stdio)
          (streams?.stderr ?? ((text: string) => process.stderr.write(text)))(
            `Serving ${home.home} at ${server.url}; MCP ${server.url}/mcp\n`,
          );
        else if (output.format !== 'text')
          output.structured({ home: home.home, url: server.url, mcp: server.url + '/mcp' });
        else
          output.line(
            `Serving ${home.home} at ${server.url}; MCP ${server.url}/mcp (Ctrl-C to stop)`,
          );
      }
      if (stdio) {
        const { stdioConnection, connectStdio } = await import('./mcp-module/stdio.js');
        connection = stdioConnection(home, endpoint);
        await connectStdio(connection);
      }
    },
    async () => {
      if (server) await server.close();
      else await connection?.close();
    },
    stdio ? process.stdin : undefined,
  );
  return 0;
}
