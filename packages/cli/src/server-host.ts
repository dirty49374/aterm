import {
  AtermConfigReader,
  AtermServer,
  AtermError,
  serverSettingsSchema,
  type IAtermHome,
} from '@aterm/core';
import { CommandEndpoint } from './mcp-module/endpoint.js';

/** Shared _aterm:HTTP_Server_ construction for HTTP-only and hosted stdio processes. */
export async function createServerHost(
  home: IAtermHome,
  options: Record<string, unknown>,
): Promise<{ server: AtermServer; endpoint: CommandEndpoint }> {
  let config;
  try {
    config = await new AtermConfigReader().read(home);
  } catch (error) {
    if (options.port === undefined) throw error;
    config = {
      home,
      allowDefaultWrites: false,
      useDefaultKnowledge: true,
      useViewpoints: [],
      sources: [],
      viewpoints: [],
    };
  }
  const port = options.port === undefined ? config.server?.port : Number(options.port);
  const host =
    typeof options.host === 'string' ? options.host : (config.server?.host ?? '127.0.0.1');
  const settings = serverSettingsSchema.safeParse({ ...config.server, port, host });
  if (!settings.success)
    throw new AtermError(
      'server.config',
      settings.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  const server = new AtermServer({ ...config, server: settings.data });
  const endpoint = new CommandEndpoint(home, server);
  server.useExtension(endpoint);
  return { server, endpoint };
}
