import { graphqlRequest, type AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class QueryCommand implements ICommandDefinition {
  readonly name = 'corpus query';
  readonly argument = '[document]';
  readonly options = [
    [
      '--file <path>',
      'GraphQL document; - or omitted reads stdin when no inline document is supplied',
    ],
    ['--variables <json>', 'GraphQL variables as a JSON object'],
    ['--operation-name <name>', 'Choose one named operation from the document'],
  ] as const;
  readonly help = {
    summary: 'Project Knowledge, Terms, Term Declarations and Relations with read-only GraphQL',
    behavior:
      'Use an inline query, --file or stdin. Output is the standard GraphQL JSON response; errors set exit status 1. Variables remain data. Each request uses one validated snapshot. Connections default to 20 nodes and accept first 1–100 plus after; changed corpora invalidate cursors. Introspection discovers the common schema. Domain sections return raw content, not typed object fields. Use GraphQL knowledge arguments instead of --knowledge.',
    example: `aterm corpus query '{ knowledges { nodes { id description } } }'`,
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<AtermQuery> {
    if (args[0] !== undefined && options.file !== undefined)
      throw new Error('Use either an inline GraphQL document or --file.');
    return {
      operation: 'graphql',
      graphql: graphqlRequest.parse({
        query: args[0] ?? (await input.text(options.file ?? '-')),
        ...(options.variables !== undefined
          ? { variables: JSON.parse(String(options.variables)) }
          : {}),
        ...(options.operationName !== undefined ? { operationName: options.operationName } : {}),
      }),
    };
  }
}
