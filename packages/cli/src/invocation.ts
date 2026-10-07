import {
  AtermApplication,
  UsageLog,
  type UsageSpan,
  AtermHomeDiscovery,
  writeOperations,
  type IAtermHome,
  type AtermQuery,
  type AtermResult,
  type UIRequest,
  type UIResult,
  AtermDispatch,
  UIClient,
  AtermError,
  AtermInitialization,
  SkillInstallation,
  type ISkillInstallationRequest,
  type IAtermOpenOptions,
} from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from './contracts.js';
import { CliOutput, type ICliStreams } from './presentation-module/index.js';

import { executeWorkspace } from './workspace-invocation.js';
import { executeRuntime } from './runtime-invocation.js';

export interface ICommandExecutionContext {
  readonly home?: IAtermHome;
  readonly mcp?: boolean;
  readonly application?: () => Promise<AtermApplication>;
  readonly query?: (query: AtermQuery) => Promise<AtermResult>;
  readonly ui?: (request: UIRequest) => Promise<UIResult>;
  readonly usage?: UsageSpan;
  readonly afterWrite?: () => Promise<void>;
}

export interface IInvocationRequest {
  readonly definition: ICommandDefinition;
  readonly args: unknown[];
  readonly options: Record<string, unknown>;
}

/** Coordinates one registered command across its execution, publication and presentation boundaries. */
export class CommandInvocation {
  constructor(
    private readonly input: ICommandInputContext,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly streams?: ICliStreams,
    private readonly context: ICommandExecutionContext = {},
  ) {}

  async execute(request: IInvocationRequest): Promise<number> {
    if (request.definition.action === 'initialize') return this.executeCommand(request);
    const home =
      this.context.home ??
      (await new AtermHomeDiscovery(this.env)
        .discover(
          this.input.cwd(),
          typeof request.options.home === 'string' ? request.options.home : undefined,
        )
        .catch(() => undefined));
    // Help/package-only fallback and first initialization have no existing Home.
    if (!home) return this.executeCommand(request);
    const span = new UsageLog(home.home).start('command', request.definition.name, {
      transport: this.context.mcp ? 'mcp' : 'cli',
      dryRun: request.options.dryRun === true,
    });
    let inputBytes = 0,
      stdoutBytes = 0,
      stderrBytes = 0;
    const input: ICommandInputContext = {
      cwd: () => this.input.cwd(),
      text: async (path) => {
        await span.phase('input');
        const text = await this.input.text(path);
        inputBytes += Buffer.byteLength(text);
        await span.phase('input-read', { inputBytes });
        return text;
      },
    };
    const streams: ICliStreams = {
      stdout: (text) => {
        stdoutBytes += Buffer.byteLength(text);
        (this.streams?.stdout ?? ((value) => process.stdout.write(value)))(text);
      },
      stderr: (text) => {
        stderrBytes += Buffer.byteLength(text);
        (this.streams?.stderr ?? ((value) => process.stderr.write(value)))(text);
      },
    };
    return span.run(async () => {
      try {
        const code = await new CommandInvocation(input, this.env, streams, {
          ...this.context,
          usage: span,
        }).executeCommand(request);
        await span.finish({
          outcome: code ? 'error' : 'ok',
          exitCode: code,
          inputBytes,
          stdoutBytes,
          stderrBytes,
        });
        return code;
      } catch (error) {
        await span.finish({
          outcome: 'error',
          exitCode: 1,
          inputBytes,
          stdoutBytes,
          stderrBytes,
          errorCode: error instanceof AtermError ? error.code : 'internal',
        });
        throw error;
      }
    });
  }

  private async publish(): Promise<void> {
    if (!this.context.afterWrite) return;
    await this.context.usage?.phase('publish');
    await this.context.afterWrite();
    await this.context.usage?.phase('published');
  }

  private async executeCommand(request: IInvocationRequest): Promise<number> {
    const { definition, args, options } = request;
    const output = new CliOutput(options, this.streams);
    this.validateOptions(request);
    if (definition.action === 'initialize') return this.initialize(args, output);
    const open: IAtermOpenOptions = {
      cwd: this.input.cwd(),
      env: this.env,
      ...(typeof options.home === 'string' ? { home: options.home } : {}),
    };
    if (definition.action === 'workspace') {
      const home =
        this.context.home ??
        (await new AtermHomeDiscovery(this.env).discover(open.cwd!, open.home));
      const workspace = await definition.workspace!(args, options, this.input);
      return executeWorkspace(home, workspace, output, this.context, () => this.publish());
    }
    if (definition.action === 'serve' || definition.action === 'mcp')
      return executeRuntime(definition.action, options, open, this.env, output, this.streams);
    const installation = definition.installation?.(args, options);
    if (installation) return this.install(installation, open, output);
    const app = await this.openApplication(request, open);
    if (definition.action === 'ui') return this.executeUI(request, app, output);
    return this.executeQuery(request, app, output);
  }

  private validateOptions({ definition, args, options }: IInvocationRequest): void {
    if (
      this.context.mcp &&
      (definition.localOnly || options.home !== undefined || options.server !== undefined)
    )
      throw new AtermError(
        'command.mcp',
        'This command or Home override is local-only. MCP tools use their selected Home.',
      );
    if (
      options.caseSensitive !== undefined &&
      (definition.action !== 'query' || definition.installation?.(args, options))
    )
      throw new AtermError(
        'cli.matching',
        '--case-sensitive applies to corpus reads, not setup, authoring, installation or UI control.',
      );
    if (
      options.knowledge !== undefined &&
      (definition.action !== 'query' || definition.installation?.(args, options))
    )
      throw new AtermError(
        'cli.knowledge',
        '--knowledge applies to Term queries and authoring, not setup, installation or UI control.',
      );
  }

  private async initialize(args: unknown[], output: CliOutput): Promise<number> {
    const result = await new AtermInitialization().create(
      typeof args[0] === 'string' ? args[0] : this.input.cwd(),
    );
    if (output.format !== 'text') output.structured(result);
    else output.line(`Initialized ${result.configPath}`);
    return 0;
  }

  private async install(
    installation: ISkillInstallationRequest,
    open: IAtermOpenOptions,
    output: CliOutput,
  ): Promise<number> {
    const result = await new SkillInstallation().apply(installation, open);
    if (output.format !== 'text') output.structured(result);
    else
      output.line(
        `${result.operation}: ${result.directory} (${result.added.length} added, ${result.updated.length} updated, ${result.removed.length} removed, ${result.unchanged.length} unchanged)${result.command ? `; skills.${result.command.kind} completed` : '; local only'}`,
      );
    return 0;
  }

  private async openApplication(
    { definition, options }: IInvocationRequest,
    open: IAtermOpenOptions,
  ): Promise<AtermApplication> {
    return await (
      this.context.application
        ? this.context.application()
        : AtermApplication.open(
            typeof options.home === 'string' ? { ...open, home: options.home } : open,
          )
    ).catch(async (error: unknown) => {
      if (definition.fallback && error instanceof AtermError && error.code === 'home.missing')
        return new AtermApplication(await definition.fallback());
      throw error;
    });
  }

  private async executeUI(
    { definition, args, options }: IInvocationRequest,
    app: AtermApplication,
    output: CliOutput,
  ): Promise<number> {
    const request = await definition.ui!(args, options, this.input);
    const result = this.context.ui
      ? await this.context.ui(request)
      : await new UIClient().request(app.config, request);
    output.ui(result);
    return 'command' in result &&
      result.operation !== 'command-view' &&
      result.command.status !== 'applied'
      ? 1
      : 0;
  }

  private async executeQuery(
    { definition, args, options }: IInvocationRequest,
    app: AtermApplication,
    output: CliOutput,
  ): Promise<number> {
    const query = await definition.prepare(args, options, this.input);
    if (!query) throw new Error('Command produced no query: ' + definition.name);
    const prepared = {
      ...query,
      ...(options.caseSensitive === true ? { caseSensitive: true } : {}),
      ...(typeof options.knowledge === 'string' ? { knowledge: options.knowledge } : {}),
    };
    let result: AtermResult;
    await this.context.usage?.phase('execute', { operationId: prepared.operation });
    try {
      result = this.context.query
        ? await this.context.query(prepared)
        : await new AtermDispatch().query(app, prepared);
    } finally {
      if ((writeOperations as readonly string[]).includes(query.operation) && !query.dryRun)
        await this.publish();
    }
    await this.context.usage?.phase('render');
    output.result(result, {
      caseSensitive: options.caseSensitive === true,
      withFileline: options.withFileline === true,
      detail: options.detail === true,
      tree: options.tree === true,
      ...(typeof options.section === 'string' ? { section: options.section } : {}),
    });
    return 'operation' in result &&
      ((result.operation === 'check' && result.diagnostics.length) ||
        (result.operation === 'graphql' && result.response.errors?.length))
      ? 1
      : 0;
  }
}
