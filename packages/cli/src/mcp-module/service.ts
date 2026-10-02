import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DrainingTransport } from './draining-transport.js';
import {
  AtermApplication,
  UsageLog,
  SkillCatalog,
  graphqlRequest,
  type IGraphQLResponse,
  type IAtermHome,
  type AtermServer,
  type ISkillDocument,
} from '@agent-workshop/aterm-core';
import { CommandRunner, commandArguments, type ICommandResult } from '../command-runner.js';
import { packageVersion } from '../package-info.js';

const commandInput = z.object({ cmd: z.string().min(1), stdin: z.string().optional() });
const emptyInput = z.object({}).strict();
const graphqlTool: Tool = {
  name: 'graphql',
  description:
    'Read one Aterm snapshot using GraphQL field selection, variables and Relation traversal. Discover the schema with introspection. Connections accept first (1–100, default 20) and after. Cursors expire when the corpus changes. No mutations; JSON/YAML sections return authored content. Discover reading guidance in the current skill_* tools.',
  inputSchema: z.toJSONSchema(graphqlRequest) as Tool['inputSchema'],
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
};
const commandTool: Tool = {
  name: 'aterm',
  description:
    'Run one Aterm CLI command. Read an applicable skill_* tool first and follow its reading and reminder commands. cmd omits the aterm executable; use CLI help for command syntax. Supply source or patch content in stdin. No shell execution. file list/read/write/delete remain available with invalid configuration. Host installation and process commands are local-only.',
  inputSchema: z.toJSONSchema(commandInput) as Tool['inputSchema'],
};

/** _aterm:MCP_Server_: one execution and catalog mechanism for both transports. */
export class CommandService {
  private readonly runner: CommandRunner;
  private catalogApplication?: AtermApplication;
  private catalog?: Promise<readonly ISkillDocument[]>;
  constructor(
    private readonly home: IAtermHome,
    private readonly host?: AtermServer,
  ) {
    this.runner = new CommandRunner(home, {
      mcp: true,
      ...(host
        ? {
            application: () => host.application(),
            query: (query) => host.query(query),
            ui: (request) => host.requestUI(request),
            afterWrite: () => host.refresh(),
          }
        : {}),
    });
  }
  private async skills(): Promise<readonly ISkillDocument[]> {
    try {
      const app = this.host
        ? await this.host.application()
        : await AtermApplication.open({ home: this.home.home });
      if (app !== this.catalogApplication) {
        this.catalogApplication = app;
        this.catalog = new SkillCatalog().read(app.config);
      }
      return await this.catalog!;
    } catch {
      return [];
    } // Never serve an invalid catalog's previous documents.
  }
  async tools(): Promise<Tool[]> {
    return [
      commandTool,
      graphqlTool,
      ...(await this.skills()).map(
        (skill): Tool => ({
          name: 'skill_' + skill.name,
          description: skill.description,
          inputSchema: z.toJSONSchema(emptyInput) as Tool['inputSchema'],
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        }),
      ),
    ];
  }
  async call(name: string, args: unknown): Promise<CallToolResult> {
    const operation =
      name === 'aterm' || name === 'graphql'
        ? name
        : name.startsWith('skill_')
          ? 'skill'
          : 'unknown';
    const span = new UsageLog(this.home.home).start('mcp', operation, {
      inputBytes: Buffer.byteLength(JSON.stringify(args) ?? ''),
    });
    return span.run(async () => {
      try {
        const result = await this.callTool(name, args);
        await span.finish({
          outcome: result.isError ? 'error' : 'ok',
          outputBytes: Buffer.byteLength(JSON.stringify(result)),
        });
        return result;
      } catch (error) {
        await span.finish({ outcome: 'error' });
        throw error;
      }
    });
  }
  private async callTool(name: string, args: unknown): Promise<CallToolResult> {
    if (name === 'graphql') {
      let response: IGraphQLResponse;
      try {
        const input = graphqlRequest.parse(args);
        const argv = ['corpus', 'query', '--output', 'json'];
        if (input.variables) argv.push('--variables', JSON.stringify(input.variables));
        if (input.operationName) argv.push('--operation-name', input.operationName);
        const result = await this.runner.run(argv, input.query);
        if (!result.stdout.trim()) throw new Error(result.stderr.trim() || 'GraphQL query failed.');
        response = JSON.parse(result.stdout) as IGraphQLResponse;
      } catch (error) {
        response = {
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
        structuredContent: { ...response },
        isError: Boolean(response.errors?.length),
      };
    }
    if (name === 'aterm') {
      let result: ICommandResult;
      try {
        const input = commandInput.parse(args);
        result = await this.runner.run(commandArguments(input.cmd), input.stdin);
      } catch (error) {
        result = { stdout: '', stderr: String(error) + '\n', exitCode: 1 };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : '') ||
              '(no output)',
          },
        ],
        structuredContent: { ...result },
        isError: result.exitCode !== 0,
      };
    }
    try {
      emptyInput.parse(args ?? {});
      const skill = (await this.skills()).find((item) => 'skill_' + item.name === name);
      if (!skill)
        throw new Error(
          `Tool ${name} is unavailable; refresh tools/list and check the current corpus.`,
        );
      return { content: [{ type: 'text', text: skill.text }] };
    } catch (error) {
      return { content: [{ type: 'text', text: String(error) }], isError: true };
    }
  }
}

/** Request-time discovery also refreshes a long-lived stdio connection's catalog. */
export class CommandConnection {
  // The lower-level SDK Server admits a dynamic catalog without transport-specific registration caches.
  readonly protocol = new Server(
    { name: 'aterm', version: packageVersion },
    { capabilities: { tools: {} } },
  );
  private readonly active = new Set<Promise<CallToolResult>>();
  private closing?: Promise<void>;
  private transport?: DrainingTransport;
  constructor(service: CommandService) {
    this.protocol.setRequestHandler(ListToolsRequestSchema, () =>
      service.tools().then((tools) => ({ tools })),
    );
    this.protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      if (this.closing)
        return { content: [{ type: 'text', text: 'MCP connection is closing.' }], isError: true };
      const pending = service.call(params.name, params.arguments);
      this.active.add(pending);
      try {
        return await pending;
      } finally {
        this.active.delete(pending);
      }
    });
  }
  connect(transport: Transport): Promise<void> {
    this.transport = new DrainingTransport(transport);
    return this.protocol.connect(this.transport);
  }
  discardResponses(): void {
    this.transport?.discardResponses();
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      await Promise.allSettled([...this.active]);
      await this.transport?.drain();
      await this.protocol.close();
    })());
  }
}
