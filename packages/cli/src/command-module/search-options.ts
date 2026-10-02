/** Shared syntax for _aterm:Search_Space_; read selectors ignore case unless requested. */
export class SearchOptions {
  static readonly options = [
    [
      '--viewpoint <patterns...>',
      'Include Terms whose Term Kind comes from these Viewpoints (names or quoted globs); default all',
    ],
    [
      '--exclude-viewpoint <patterns...>',
      'Exclude Terms of these Viewpoints from endpoints and intermediate Terms; exclusion wins',
    ],
    ['--relation <patterns...>', 'Include Relation phrases as authored; quote multiword phrases'],
    [
      '--exclude-relation <patterns...>',
      'Exclude Relation phrases before traversal; exclusion wins',
    ],
  ] as const;
  static read(options: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      [
        ['viewpoints', options.viewpoint],
        ['excludeViewpoints', options.excludeViewpoint],
        ['relationPhrases', options.relation],
        ['excludeRelations', options.excludeRelation],
      ].filter(([, value]) => value !== undefined),
    );
  }
}
