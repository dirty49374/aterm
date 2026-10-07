import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { IAtermHome } from '@garage49/aterm-core';
import type { CommandEndpoint } from './endpoint.js';
import { CommandConnection, CommandService } from './service.js';

/** _aterm:MCP_Server_: stdio owns no additional snapshot or HTTP listener. */
export function stdioConnection(home: IAtermHome, endpoint?: CommandEndpoint): CommandConnection {
  return endpoint?.createConnection() ?? new CommandConnection(new CommandService(home));
}
export function connectStdio(connection: CommandConnection): Promise<void> {
  const failedOutput = () => {
    connection.discardResponses();
  };
  process.stdout.on('error', failedOutput);
  connection.protocol.onclose = () => {
    process.stdout.off('error', failedOutput);
  };
  return connection.connect(new StdioServerTransport()).catch((error) => {
    process.stdout.off('error', failedOutput);
    throw error;
  });
}
