import { ExternalOptions } from './external-options.js';
import type { AtermQuery } from '@agent-workshop/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class GrepCommand implements ICommandDefinition {
  readonly name = 'term occurrences';
  readonly legacyName = 'grep';
  readonly argument = '<text>';
  readonly options = [
    ...ExternalOptions.options,
    ['--match <pattern...>', 'Limit containing Terms by quoted globs'],
    ['--no-remark', 'Exclude Remarks references'],
    ['--with-fileline', 'Include physical locations alongside Term-relative addresses'],
  ] as const;
  readonly help = {
    summary: 'Find Term occurrences with nearby source lines',
    behavior:
      'Find exact Term references, Term Declaration headers and .relations Targets. Body snippets use Term Declaration-relative addresses with one neighboring line; Relations are part of their owning Term Declaration. In Aterm Knowledges fenced code and TypeScript text are not references. Selected external files match exact Term tokens in any text.',
    example: "aterm term occurrences '_Project_*'",
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'grep',
      ...ExternalOptions.read(options),
      referencePattern: args[0],
      ...(Array.isArray(options.match) ? { termPatterns: options.match } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
