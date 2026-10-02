import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IAtermHome, AtermServer, IServerExtension } from '@aterm/core';
import { CommandConnection, CommandService } from './service.js';

/** _aterm:MCP_Server_: HTTP lifetime around the shared MCP service. */
export class CommandEndpoint implements IServerExtension {
  private readonly active = new Set<CommandConnection>();
  private readonly service: CommandService;
  constructor(home: IAtermHome, server: AtermServer) {
    this.service = new CommandService(home, server);
  }
  createConnection(): CommandConnection {
    const connection = new CommandConnection(this.service);
    this.active.add(connection);
    return connection;
  }
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.url?.split('?')[0] !== '/mcp') return false;
    const connection = this.createConnection();
    const close = async () => {
      await connection.close();
      this.active.delete(connection);
    };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.once('close', () => {
      connection.discardResponses();
      void close();
    });
    try {
      await connection.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      await close();
      throw error;
    }
    return true;
  }
  async close(): Promise<void> {
    await Promise.all([...this.active].map((connection) => connection.close()));
    this.active.clear();
  }
}
