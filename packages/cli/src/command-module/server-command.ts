import type { ICommandDefinition } from '../contracts.js';

export class ServerCommand implements ICommandDefinition {
  readonly localOnly = true;
  readonly name = 'server run';
  readonly legacyName = 'server';
  readonly options = [
    ['--host <address>', 'Override the listening address, including recovery startup'],
    ['--port <port>', 'Override the listening port; permits startup with invalid configuration'],
  ] as const;
  readonly action = 'serve' as const;
  readonly help = {
    summary: 'Watch this Home and serve Explorer, queries and MCP over HTTP',
    behavior:
      'Requires server.port in aterm.yaml or --port. server.host defaults to 127.0.0.1; set 0.0.0.0 for external IPv4 access or :: for IPv6. Runs in the foreground; Ctrl-C stops it. CLI reads use the server when present and otherwise use the filesystem. MCP /mcp executes corpus and UI commands. --port allows recovery startup with invalid configuration; raw file commands remain available. Authentication belongs to the reverse proxy. Host and port changes require restart.',
    example: 'aterm server run',
  };
  async prepare(): Promise<undefined> {
    return undefined;
  }
}
