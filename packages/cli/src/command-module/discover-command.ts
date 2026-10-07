import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition } from '../contracts.js';

export class DiscoverCommand implements ICommandDefinition {
  readonly name = 'corpus discover';
  readonly argument = '<question>';
  readonly options = [
    ['--mode <mode>', 'lexical, semantic or hybrid (default hybrid)'],
    ['--limit <number>', 'Maximum candidate Terms, 1–100 (default 10)'],
    [
      '--search-in <sections...>',
      'Search only these section bodies, e.g. definition (default all)',
    ],
    ['--detail', 'Show Definitions, Term Kind, section evidence and source locations'],
    ['--match <patterns...>', 'Select Term Declaration names by exact identity or quoted glob'],
    ['--viewpoint <patterns...>', 'Include Viewpoints by name or quoted glob'],
    ['--exclude-viewpoint <patterns...>', 'Exclude Viewpoints before ranking'],
    ['--no-remark', 'Exclude Remarks from source chunks'],
  ] as const;
  readonly help = {
    summary: 'Discover Terms from intent, with ranked source evidence',
    behavior:
      'Hybrid combines lexical and semantic rank. Default output is a Term / Score table; --detail shows Definitions and source evidence. --search-in restricts section bodies before ranking and disables standalone name matches. Matching defaults to case-insensitive; --case-sensitive affects selectors and lexical ranking, not vector similarity. Prepare the embedded Model with corpus index build; later semantic queries run offline and reuse cached chunks. Lexical mode needs no Model. Scores are not probabilities. External files remain in corpus search. JSON/YAML retain every eligible Definition, Term Kind and evidence item; use term view to read the candidate contract.',
    example: 'aterm corpus discover "compare several concepts together" --limit 5 --output json',
  };
  readonly action = 'query' as const;
  async prepare(args: unknown[], options: Record<string, unknown>): Promise<AtermQuery> {
    return {
      operation: 'discover',
      question: args[0],
      ...(options.mode !== undefined ? { searchMode: options.mode } : {}),
      ...(options.searchIn !== undefined ? { searchSections: options.searchIn } : {}),
      ...(options.limit !== undefined ? { limit: Number(options.limit) } : {}),
      ...(options.match !== undefined ? { termPatterns: options.match } : {}),
      ...(options.viewpoint !== undefined ? { viewpoints: options.viewpoint } : {}),
      ...(options.excludeViewpoint !== undefined
        ? { excludeViewpoints: options.excludeViewpoint }
        : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
