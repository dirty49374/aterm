import { UIText } from './ui-text.js';
import { skillText } from './skill-text.js';
import { DiscoveryText } from './discovery-text.js';
import { markdownEnd } from './markdown.js';
import type { UIResult, IWorkspaceFileResult, ISourceAuthoringResult } from '@aterm/core';
import { alignedTable } from './table.js';
import { KnowledgeText } from './knowledge-text.js';
import { ResultMarkdown } from './result-markdown.js';
import { stringify } from 'yaml';
import { AtermError, type AtermResult } from '@aterm/core';
import { TermDeclarationText } from './term-declaration-text.js';
import { ViewpointText } from './viewpoint-text.js';

export type CliOutputFormat = 'text' | 'json' | 'yaml' | 'markdown';
export interface ICliStreams {
  stdout(text: string): void;
  stderr(text: string): void;
}
export interface IResultContext {
  readonly caseSensitive?: boolean;
  readonly withFileline?: boolean;
  readonly detail?: boolean;
  readonly tree?: boolean;
  /** Print one section of each Term Declaration as plain text and nothing else. */
  readonly section?: string;
}

export function outputSelection(options: Record<string, unknown>): CliOutputFormat {
  const requested = Array.isArray(options.output)
    ? options.output
    : options.output
      ? [options.output]
      : [];
  if (requested.some((v) => v !== 'json' && v !== 'yaml' && v !== 'markdown'))
    throw new AtermError('cli.output', 'Choose --output json, --output yaml or --output markdown');
  if (new Set(requested).size > 1)
    throw new AtermError('cli.output', 'Conflicting output selectors');
  return (requested[0] as CliOutputFormat | undefined) ?? 'text';
}

/** Presentation only: never changes a domain result. */
export class CliOutput {
  readonly format: CliOutputFormat;
  constructor(
    options: Record<string, unknown> = {},
    private readonly streams: ICliStreams = {
      stdout: (text) => {
        process.stdout.write(text);
      },
      stderr: (text) => {
        process.stderr.write(text);
      },
    },
  ) {
    this.format = outputSelection(options);
  }
  result(value: AtermResult, context: IResultContext = {}): void {
    if ('operation' in value && value.operation === 'jq') {
      if (this.format === 'markdown')
        return this.streams.stdout(new ResultMarkdown().render(value));
      if (this.format === 'yaml') return this.structured(value.values);
      return this.line(JSON.stringify(value.values, null, 2));
    }
    if ('operation' in value && value.operation === 'graphql') {
      if (this.format === 'markdown')
        return this.streams.stdout(new ResultMarkdown().render(value));
      if (this.format === 'yaml') return this.structured(value.response);
      return this.line(JSON.stringify(value.response, null, 2));
    }
    if (this.format === 'markdown')
      return this.streams.stdout(new ResultMarkdown().render(value, context));
    if (this.format !== 'text') return this.structured(value);
    if ('skills' in value) return this.streams.stdout(skillText(value));
    if ('candidates' in value || 'cachedChunks' in value)
      return this.streams.stdout(new DiscoveryText().render(value, context.detail));
    if ('selected' in value && 'knowledges' in value)
      return this.streams.stdout(new KnowledgeText().render(value));
    if ('ambiguity' in value && value.ambiguity)
      return this.line(
        value.ambiguity.candidates
          .map(
            (c) =>
              `${c.id}  ${c.termDeclarations.map((e) => `${e.termKind} ${e.file}:${e.line}`).join(', ')}`,
          )
          .join('\n') +
          '\n' +
          value.ambiguity.hint,
      );
    if ('viewpoints' in value) return this.streams.stdout(new ViewpointText().render(value));
    if (context.section !== undefined && 'termDeclarations' in value)
      return this.streams.stdout(
        new TermDeclarationText().field(value, context.section, context.caseSensitive),
      );
    this.streams.stdout(
      new TermDeclarationText().render(value, context.withFileline, context.detail, context.tree),
    );
  }
  ui(value: UIResult): void {
    if (this.format === 'json' || this.format === 'yaml') return this.structured(value);
    const text = new UIText().render(value, this.format === 'markdown');
    this.streams.stdout(this.format === 'markdown' ? markdownEnd(text) : text + '\n');
  }
  workspace(
    result: IWorkspaceFileResult | ISourceAuthoringResult,
    diagnostics: readonly string[],
    dryRun = false,
  ): void {
    if (this.format !== 'text' || dryRun) this.structured({ ...result, diagnostics });
    else if ('text' in result && result.text !== undefined) this.streams.stdout(result.text);
    else if ('entries' in result)
      this.line(
        alignedTable({
          headers: ['type', 'name'],
          rows: result.entries!.map((e) => [e.type, e.name]),
        }),
      );
    else
      this.structured({
        ...result,
        ...('files' in result
          ? { files: result.files.map(({ path, version }) => ({ path, version })) }
          : { before: undefined, after: undefined }),
        diagnostics,
      });
  }
  structured(value: unknown): void {
    if (this.format === 'markdown') return this.streams.stdout(new ResultMarkdown().record(value));
    const publicValue = JSON.parse(JSON.stringify(value ?? null));
    this.streams.stdout(
      this.format === 'json'
        ? JSON.stringify(publicValue, null, 2) + '\n'
        : stringify(publicValue, { aliasDuplicateObjects: false }),
    );
  }
  line(text: string): void {
    this.streams.stdout(text + '\n');
  }
}
