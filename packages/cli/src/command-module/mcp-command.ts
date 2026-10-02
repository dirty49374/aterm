import type { ICommandDefinition } from '../contracts.js';

/** _aterm:MCP_Server_: choose a stdio lifecycle, not a second command vocabulary. */
export class MCPCommand implements ICommandDefinition {
  readonly localOnly = true;
  readonly name = 'mcp run';
  readonly options = [
    ['--with-server', 'Host the HTTP server, Explorer and shared snapshot in this process'],
    ['--host <address>', 'Override the hosted listening address; requires --with-server'],
    ['--port <port>', 'Override the hosted port, including recovery; requires --with-server'],
  ] as const;
  readonly action = 'mcp' as const;
  readonly help = {
    summary: 'Serve MCP over stdio, optionally hosting the HTTP server in the same process',
    behavior:
      'Standalone uses normal CLI dispatch: matching server reads when available, otherwise filesystem reads; writes stay local. --with-server owns one HTTP listener, snapshot, watcher and UI service shared with stdio. It requires server.port or --port and refuses an occupied port. stdout contains only MCP messages; logs use stderr. EOF, SIGINT or SIGTERM closes owned resources. Tools remain bound to the selected Home; installation and process commands require a separate local CLI.',
    example: 'aterm --home /project/.aterm mcp run --with-server',
  };
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
