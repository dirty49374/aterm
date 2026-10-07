import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class ViewpointCommand implements ICommandDefinition {
  readonly name = 'viewpoint view';
  readonly argument = '<pattern...>';
  readonly options = [] as const;
  readonly help = {
    summary: 'Read the original Viewpoint Markdown file, including frontmatter',
    behavior:
      'Answers from the loaded configuration without scanning corpus sources. Exact names or quoted whole-name globs select bound Viewpoints; unknown exact names fail and unmatched globs select nothing. Text and Markdown output concatenate the original files in binding order, preserving frontmatter, whitespace and line endings. JSON and YAML retain metadata and the full source.',
    example: 'aterm viewpoint view domain',
  };
  readonly action = 'query' as const;
  async prepare(args: unknown[]): Promise<AtermQuery> {
    return {
      operation: 'viewpoint',
      ...(Array.isArray(args[0]) && args[0].length ? { viewpoints: args[0] } : {}),
    } as AtermQuery;
  }
}
