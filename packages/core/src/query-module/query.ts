import { knowledgePattern } from '../syntax-module/identity.js';
import { externalSelectionShape } from '../external-module/selection.js';
import { z } from 'zod';
import { graphqlRequest } from './graphql-request.js';
import { jqRequest } from './jq-request.js';

const operations = [
  'graphql',
  'jq',
  'skill-list',
  'skill-toc',
  'skill-view',
  'skill-remind',
  'discover',
  'index-build',
  'index-status',
  'list',
  'search',
  'show',
  'view',
  'check',
  'changes',
  'edit',
  'grep',
  'path',
  'rename',
  'rename-knowledge',
  'move',
  'format',
  'overview',
  'connect',
  'relations',
  'viewpoint',
  'knowledge-list',
  'knowledge-view',
] as const;
export type AtermOperation = (typeof operations)[number];
export const readOperations = [
  'graphql',
  'jq',
  'skill-list',
  'skill-toc',
  'skill-view',
  'skill-remind',
  'discover',
  'index-status',
  'changes',
  'list',
  'search',
  'show',
  'view',
  'check',
  'grep',
  'path',
  'overview',
  'connect',
  'relations',
  'viewpoint',
  'knowledge-list',
  'knowledge-view',
] as const satisfies readonly AtermOperation[];
export const writeOperations = [
  'edit',
  'rename',
  'rename-knowledge',
  'move',
  'format',
] as const satisfies readonly AtermOperation[];

/**
 * The _aterm:Search_Space_ projection: `viewpoints` selects eligible Term Declaration Viewpoints and the
 * other three exclude Viewpoints and authored phrases. `viewpoints` means one thing wherever it
 * appears, restrict the answer to these Viewpoints. Skill reading uses its declared vocabulary
 * and does not accept this selector.
 */
const searchSpace = [
  'viewpoints',
  'excludeViewpoints',
  'relationPhrases',
  'excludeRelations',
] as const;

/**
 * Which selectors, filters and options each operation accepts. This is the one place a request
 * shape is decided: an operation's implementation never repeats the rule, and a field an
 * operation does not use is rejected rather than accepted and ignored.
 */
export const operationFields = {
  graphql: ['caseSensitive', 'graphql'],
  jq: ['caseSensitive', 'jq'],
  'skill-list': ['caseSensitive', 'knowledge'],
  'skill-toc': ['caseSensitive', 'knowledge', 'skillTerms'],
  'skill-view': ['caseSensitive', 'knowledge', 'skillTerms'],
  'skill-remind': ['caseSensitive', 'knowledge', 'skillTerms'],
  discover: [
    'caseSensitive',
    'knowledge',
    'question',
    'searchMode',
    'searchSections',
    'limit',
    'termPatterns',
    'viewpoints',
    'excludeViewpoints',
    'remarks',
  ],
  'index-build': [],
  'index-status': [],
  list: [
    'caseSensitive',
    'knowledge',
    'termPatterns',
    'unreferenced',
    'roots',
    'remarks',
    ...searchSpace,
  ],
  search: [
    'caseSensitive',
    'knowledge',
    'externalSources',
    'searchText',
    'termPatterns',
    'remarks',
    ...searchSpace,
  ],
  show: ['caseSensitive', 'knowledge', 'termPatterns', 'remarks'],
  view: ['caseSensitive', 'knowledge', 'termPatterns', 'remarks'],
  check: ['caseSensitive', 'knowledge', 'roots', 'remarks'],
  changes: ['caseSensitive', 'files', 'commit'],
  edit: ['knowledge', 'patch', 'dryRun'],
  grep: [
    'caseSensitive',
    'knowledge',
    'externalSources',
    'referencePattern',
    'termPatterns',
    'remarks',
  ],
  path: ['caseSensitive', 'knowledge', 'from', 'to', 'remarks', ...searchSpace],
  'rename-knowledge': ['externalSources', 'from', 'to', 'dryRun'],
  rename: ['knowledge', 'externalSources', 'from', 'to', 'dryRun'],
  move: ['knowledge', 'externalSources', 'termPatterns', 'to', 'dryRun'],
  format: ['knowledge', 'termPatterns', 'dryRun'],
  overview: [
    'caseSensitive',
    'knowledge',
    'termPatterns',
    'files',
    'edgeOrigins',
    'remarks',
    ...searchSpace,
  ],
  connect: [
    'caseSensitive',
    'knowledge',
    'termPatterns',
    'limit',
    'edgeOrigins',
    'remarks',
    ...searchSpace,
  ],
  relations: [
    'caseSensitive',
    'knowledge',
    'termPatterns',
    'edgeOrigins',
    'remarks',
    ...searchSpace,
  ],
  viewpoint: ['caseSensitive', 'viewpoints', 'guidance'],
  'knowledge-list': ['caseSensitive'],
  'knowledge-view': ['caseSensitive', 'knowledgeIds'],
} as const satisfies Record<AtermOperation, readonly string[]>;

/** The operations that accept one field, named in a refusal so the caller can retarget it. */
function accepting(field: string): readonly AtermOperation[] {
  return operations.filter((operation) =>
    (operationFields[operation] as readonly string[]).includes(field),
  );
}

/** Bounded Term Declaration query: one operation with its selectors and filters; no filesystem roots. */
export const atermQuery = z
  .object({
    operation: z.enum(operations),
    caseSensitive: z.boolean().optional(),
    graphql: graphqlRequest.optional(),
    jq: jqRequest.optional(),
    skillTerms: z.array(z.string().min(1)).min(1).optional(),
    question: z.string().trim().min(1).max(4000).optional(),
    searchMode: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
    searchSections: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/i))
      .min(1)
      .transform((keys) => [...new Set(keys)])
      .optional(),
    knowledge: z
      .string()
      .regex(new RegExp(`^${knowledgePattern}$`, 'i'))
      .optional(),
    ...externalSelectionShape,
    from: z.string().min(1).optional(),
    excludeViewpoints: z.array(z.string().min(1)).optional(),
    relationPhrases: z.array(z.string().min(1)).optional(),
    excludeRelations: z.array(z.string().min(1)).optional(),
    edgeOrigins: z
      .array(z.enum(['relation', 'reference']))
      .min(1)
      .optional(),
    to: z.string().min(1).optional(),
    patch: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
    termPatterns: z.array(z.string().min(1)).optional(),
    files: z.array(z.string().min(1)).optional(),
    searchText: z.string().min(1).optional(),
    referencePattern: z.string().min(1).optional(),
    knowledgeIds: z.array(z.string().min(1)).min(1).optional(),
    unreferenced: z.boolean().optional(),
    roots: z.array(z.string().min(1)).optional(),
    remarks: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    guidance: z.boolean().optional(),
    viewpoints: z.array(z.string().min(1)).optional(),
    commit: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === 'jq' && !value.jq)
      context.addIssue({ code: 'custom', path: ['jq'], message: 'jq requires a request.' });
    if (value.operation === 'graphql' && !value.graphql)
      context.addIssue({
        code: 'custom',
        path: ['graphql'],
        message: 'GraphQL requires a request.',
      });
    if (value.operation === 'discover') {
      if (value.question === undefined)
        context.addIssue({
          code: 'custom',
          path: ['question'],
          message: 'Discovery requires a question.',
        });
      if ((value.limit ?? 10) > 100)
        context.addIssue({
          code: 'custom',
          path: ['limit'],
          message: 'Discovery limit must not exceed 100.',
        });
    }
    const accepted: readonly string[] = operationFields[value.operation];
    for (const [field, supplied] of Object.entries(value)) {
      if (field === 'operation' || supplied === undefined || accepted.includes(field)) continue;
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `Operation ${value.operation} does not accept ${field}; ${accepting(field).join(', ')} does.`,
      });
    }
  });
export type AtermQuery = z.infer<typeof atermQuery>;
