import type {
  AtermQuery,
  IAtermConfig,
  ISkillInstallationRequest,
  UIRequest,
  IFileRequest,
  ISourceAuthoringRequest,
} from '@agent-workshop/aterm-core';

/** File/stdin and process context supplied by the invoking adapter, never read during registration. */
export interface ICommandInputContext {
  text(path: unknown): Promise<string>;
  cwd(): string;
}

/** Transport-independent syntax and deferred input owned by one command class. */
export interface ICommandDefinition {
  readonly name: string;
  /** Removed flat spelling, used only to explain migration; never an alias. */
  readonly legacyName?: string;
  readonly argument?: string;
  readonly options: readonly (readonly [string, string])[];
  readonly help: {
    readonly summary: string;
    readonly behavior: string;
    readonly example: string;
  };
  readonly action: 'query' | 'initialize' | 'serve' | 'mcp' | 'ui' | 'workspace';
  /** Host installation and process management cannot be invoked through MCP tools. */
  readonly localOnly?: boolean;
  workspace?(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<IFileRequest | ISourceAuthoringRequest>;
  ui?(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): UIRequest | Promise<UIRequest>;
  /** Declares a local installation action; the invocation adapter executes it. */
  installation?(
    args: unknown[],
    options: Record<string, unknown>,
  ): ISkillInstallationRequest | undefined;
  /** The configuration to answer with when no home is found, for a command the package can serve alone. */
  fallback?(): Promise<IAtermConfig>;
  prepare(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<AtermQuery | undefined>;
}

export interface ICommandConstructor {
  new (): ICommandDefinition;
}
