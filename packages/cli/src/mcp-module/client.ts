import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { quote } from 'shell-quote';
import type { ICommandResult } from '../command-runner.js';
import { packageVersion } from '../package-info.js';
import { CommandInputContext } from '../input-context.js';
import type { IInvocationRequest } from '../invocation.js';

/** Parse through the normal registry; only the selected stdin source is read locally. */
export class RemoteCommandInvocation {
  constructor(
    private readonly url: string,
    private readonly argv: readonly string[],
  ) {}

  async execute({ definition, args, options }: IInvocationRequest): Promise<number> {
    const path = definition.textInput?.path(args, options);
    const stdin =
      path === '-' && !process.stdin.isTTY ? await new CommandInputContext().text('-') : undefined;
    const result = await remoteCommand(this.url, this.argv, stdin);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }
}

/** The remote CLI is an MCP client of the same aterm tool, with no local fallback. */
export async function remoteCommand(
  url: string,
  argv: readonly string[],
  stdin?: string,
): Promise<ICommandResult> {
  const client = new Client({ name: 'aterm-cli', version: packageVersion });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const result = await client.callTool(
      {
        name: 'aterm',
        arguments: { cmd: quote([...argv]), ...(stdin !== undefined ? { stdin } : {}) },
      },
      undefined,
      { timeout: 300_000 },
    );
    const value = result.structuredContent as Partial<ICommandResult> | undefined;
    if (
      !value ||
      typeof value.stdout !== 'string' ||
      typeof value.stderr !== 'string' ||
      !Number.isInteger(value.exitCode)
    )
      throw new Error('Remote server did not return an Aterm command result.');
    return value as ICommandResult;
  } catch (error) {
    return {
      stdout: '',
      stderr: `Remote request failed; no local fallback or automatic retry. A write may have completed; inspect server files before retrying. ${String(error)}\n`,
      exitCode: 1,
    };
  } finally {
    await client.close();
  }
}

export function remoteSelection(
  argv: readonly string[],
): { url: string; argv: string[] } | undefined {
  const end = argv.indexOf('--');
  const options = end < 0 ? argv : argv.slice(0, end);
  const at = options.findIndex((arg) => arg === '--server' || arg.startsWith('--server='));
  if (at < 0) return undefined;
  const inline = argv[at]!.startsWith('--server=');
  const url = inline ? argv[at]!.slice('--server='.length) : argv[at + 1];
  if (!url) throw new Error('--server requires an MCP endpoint URL.');
  const rest = [...argv];
  rest.splice(at, inline ? 1 : 2);
  if (
    options
      .slice(at + (inline ? 1 : 2))
      .some((arg) => arg === '--server' || arg.startsWith('--server='))
  )
    throw new Error('Select exactly one --server.');
  return { url, argv: rest };
}
