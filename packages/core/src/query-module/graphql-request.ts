import { z } from 'zod';

/** Shared GraphQL envelope for CLI, MCP and HTTP; values never contain executable shell text. */
export const graphqlRequest = z
  .object({
    query: z.string().min(1).max(65536),
    variables: z.record(z.string(), z.unknown()).nullish(),
    operationName: z.string().min(1).nullish(),
  })
  .strict();
export type GraphQLRequest = z.infer<typeof graphqlRequest>;

export interface IGraphQLResponse {
  readonly data?: Record<string, unknown> | null;
  readonly errors?: readonly {
    readonly message: string;
    readonly locations?: readonly { line: number; column: number }[];
    readonly path?: readonly (string | number)[];
    readonly extensions?: Readonly<Record<string, unknown>>;
  }[];
}
export interface IGraphQLResult {
  readonly operation: 'graphql';
  readonly response: IGraphQLResponse;
}
