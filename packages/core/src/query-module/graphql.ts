import { createHash } from 'node:crypto';
import {
  defaultFieldResolver,
  execute,
  getOperationAST,
  GraphQLError,
  Kind as ASTKind,
  parse,
  validate,
  type DocumentNode,
  type SelectionSetNode,
} from 'graphql';
import { AtermError } from '../error.js';
import { byText } from '../order.js';
import { TextMatching } from '../matching.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';
import type { AtermTermKind, ITermDeclaration, IReferenceEdge } from '../syntax-module/index.js';
import {
  termDeclarationIdentity,
  termKindIdentity,
  resolveTermKind,
} from '../syntax-module/term-kind.js';
import { localTerm } from '../syntax-module/identity.js';
import { TermDeclarationGraph } from './graph.js';
import { AmbiguousTermError } from './registry.js';
import { GlobPattern } from './pattern.js';
import { ViewpointReading } from './viewpoint-result.js';
import type { IndexedCorpus } from './corpus.js';
import { graphqlRequest, type GraphQLRequest, type IGraphQLResponse } from './graphql-request.js';
import { graphqlSchema } from './graphql-schema.js';
import { readJq, type JqEvaluator } from './jq.js';
import type { JqRequest } from './jq-request.js';
import { termJson } from './corpus-json.js';
import {
  selectCollection,
  type CollectionSelection,
  type GraphQLContext,
} from './graphql-selection.js';

interface Page extends CollectionSelection {
  first?: number | null;
  after?: string | null;
}
interface Matching {
  caseSensitive?: boolean | null;
}
interface Selection extends Page, Matching {
  knowledge?: string | null;
  match?: string | null;
  termKind?: string | null;
  viewpoint?: string | null;
  text?: string | null;
}
interface Edges extends Page, Matching {
  knowledge?: string | null;
  phrase?: string | null;
  origin?: 'relation' | 'reference' | null;
  type?: string | null;
  structural?: boolean | null;
  includeRemarks?: boolean | null;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const limit = (message: string) =>
  new GraphQLError(message, { extensions: { code: 'graphql.limit' } });

/** Expanded selections count aliases and repeated fragment spreads, including skipped branches. */
function boundDocument(document: DocumentNode): void {
  const fragments = new Map(
    document.definitions.flatMap((node) =>
      node.kind === ASTKind.FRAGMENT_DEFINITION ? [[node.name.value, node] as const] : [],
    ),
  );
  let fields = 0;
  const active = new Set<string>();
  const walk = (selection: SelectionSetNode, depth: number): void => {
    if (depth > 16) throw limit('GraphQL selection depth exceeds 16.');
    for (const node of selection.selections) {
      if (++fields > 1000) throw limit('GraphQL expanded selection count exceeds 1000.');
      if (node.kind === ASTKind.FRAGMENT_SPREAD) {
        const name = node.name.value;
        if (active.has(name)) throw new GraphQLError(`Fragment cycle involving ${name}.`);
        const fragment = fragments.get(name);
        if (fragment) {
          active.add(name);
          walk(fragment.selectionSet, depth);
          active.delete(name);
        }
      } else if (node.selectionSet)
        walk(node.selectionSet, depth + (node.kind === ASTKind.FIELD ? 1 : 0));
    }
  };
  for (const node of document.definitions)
    if (node.kind === ASTKind.OPERATION_DEFINITION) walk(node.selectionSet, 1);
}

/** Pure, bounded projection of one validated corpus; resolvers never read the filesystem. */
export class GraphQLReading {
  private readonly graph: TermDeclarationGraph;
  private readonly trmFiles: Map<string, ITrmFile>;
  private readonly fingerprint: string;
  constructor(
    private readonly corpus: IndexedCorpus,
    private readonly evaluateJq: JqEvaluator,
  ) {
    this.graph = new TermDeclarationGraph(corpus.index);
    this.trmFiles = new Map(
      corpus.trmFiles
        .map((trmFile) => [trmFile.parsed!.knowledge!, trmFile] as const)
        .sort(([a], [b]) => byText(a, b)),
    );
    this.fingerprint = hash(
      [...this.trmFiles].map(([id, trmFile]) => [
        id,
        trmFile.absolutePath,
        trmFile.text,
        trmFile.readOnly ?? false,
        trmFile.parsed!.termKinds,
      ]),
    );
  }

  async execute(input: GraphQLRequest, caseSensitive = false): Promise<IGraphQLResponse> {
    try {
      const request = graphqlRequest.parse(input);
      if (
        Buffer.byteLength(request.query) > 65536 ||
        Buffer.byteLength(JSON.stringify(request.variables ?? {})) > 65536
      )
        throw limit('GraphQL query and variables must each fit in 64 KiB.');
      const document = parse(request.query, { maxTokens: 5000 });
      // Bound fragment expansion before validation also traverses and merges selections.
      boundDocument(document);
      const errors = validate(graphqlSchema, document, undefined, { maxErrors: 20 });
      if (errors.length) return { errors: errors.map((error) => error.toJSON()) };
      const operation = getOperationAST(document, request.operationName);
      if (operation && operation.operation !== 'query')
        throw new GraphQLError('Only GraphQL queries are supported.', {
          extensions: { code: 'graphql.readonly' },
        });
      let fields = 0;
      let jqExecutions = 0;
      let bytes = 0;
      let exceeded: GraphQLError | undefined;
      const pending: ReturnType<JqEvaluator>[] = [];
      const context: GraphQLContext = {
        evaluate: async (input, program, bindings) => {
          if (++jqExecutions > 4) throw (exceeded = limit('GraphQL jq execution count exceeds 4.'));
          try {
            const evaluation = this.evaluateJq(input, program, bindings);
            pending.push(evaluation);
            return await evaluation;
          } catch (error) {
            if (error instanceof AtermError) {
              const failure = new GraphQLError(error.message, { extensions: { code: error.code } });
              if (error.code === 'jq.limit' || error.code === 'jq.busy') exceeded ??= failure;
              throw failure;
            }
            throw error;
          }
        },
      };
      const result = await execute({
        schema: graphqlSchema,
        document,
        variableValues: request.variables,
        operationName: request.operationName,
        contextValue: context,
        rootValue: {
          jq: ({ caseSensitive, ...request }: JqRequest & Matching) =>
            readJq(this.corpus, request, context.evaluate, caseSensitive ?? false),
          knowledge: ({ id, caseSensitive }: { id: string } & Matching) =>
            this.knowledge(this.requireKnowledge(id, caseSensitive ?? false)),
          knowledges: (args: Page, context: GraphQLContext) =>
            this.collection(
              [...this.trmFiles.keys()],
              args,
              ['knowledges'],
              (id) => this.knowledge(id),
              (id) => this.knowledgeJson(id),
              context,
            ),
          term: ({
            id,
            knowledge,
            caseSensitive,
          }: { id: string; knowledge?: string } & Matching) => {
            return this.term(
              this.corpus.index.resolve(id, knowledge ?? undefined, caseSensitive ?? false),
            );
          },
          terms: (args: Selection, context: GraphQLContext) => this.terms(args, context),
          relations: (args: Edges, context: GraphQLContext) =>
            this.edges(
              this.corpus.index.termDeclarations.flatMap((term) =>
                this.graph.outgoing(term.id, args.includeRemarks ?? true),
              ),
              args,
              ['relations'],
              context,
            ),
          viewpoints: (args: Selection, context: GraphQLContext) => this.viewpoints(args, context),
          termKinds: (args: Selection, context: GraphQLContext) => this.termKinds(args, context),
        },
        fieldResolver: async (source, args, context, info) => {
          if (exceeded) throw exceeded;
          if (++fields > 10000)
            throw (exceeded = limit('GraphQL field resolution budget exceeds 10000.'));
          let value: unknown;
          try {
            const supportsMatching = info.parentType
              .getFields()
              [info.fieldName]?.args.some((argument) => argument.name === 'caseSensitive');
            value = await defaultFieldResolver(
              source,
              supportsMatching
                ? { ...args, caseSensitive: args.caseSensitive ?? caseSensitive }
                : args,
              context,
              info,
            );
          } catch (error) {
            if (error instanceof AtermError) {
              const failure = new GraphQLError(error.message, { extensions: { code: error.code } });
              if (error.code === 'jq.limit' || error.code === 'jq.busy') exceeded ??= failure;
              throw failure;
            }
            if (error instanceof AmbiguousTermError)
              throw new GraphQLError(
                'Ambiguous Term; use a qualified ID, a knowledge argument or caseSensitive: true.',
                {
                  extensions: { code: 'graphql.ambiguity', candidates: error.candidates },
                },
              );
            throw error;
          }
          if (typeof value === 'string') bytes += Buffer.byteLength(value);
          if (bytes > 2 * 1024 * 1024) throw (exceeded = limit('GraphQL response exceeds 2 MiB.'));
          return value;
        },
      });
      await Promise.allSettled(pending);
      if (exceeded) throw exceeded;
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
        throw limit('GraphQL response exceeds 2 MiB.');
      return {
        ...(result.data !== undefined ? { data: result.data } : {}),
        ...(result.errors ? { errors: result.errors.map((error) => error.toJSON()) } : {}),
      };
    } catch (error) {
      return {
        errors: [
          error instanceof GraphQLError
            ? error.toJSON()
            : {
                message: error instanceof Error ? error.message : String(error),
                extensions: { code: error instanceof AtermError ? error.code : 'graphql.query' },
              },
        ],
      };
    }
  }

  private requireKnowledge(id: string, caseSensitive = true): string {
    return this.corpus.index.requireKnowledge(id, caseSensitive)!;
  }
  private vocabulary(knowledge?: string | null): readonly AtermTermKind[] {
    if (knowledge != null) this.requireKnowledge(knowledge);
    return [...this.trmFiles]
      .filter(([id]) => !knowledge || id === knowledge)
      .flatMap(([, trmFile]) => trmFile.parsed!.termKinds ?? []);
  }
  private filters(args: Selection): { termKind?: string; viewpoint?: GlobPattern } {
    const termKinds = this.vocabulary(args.knowledge);
    const viewpoint =
      args.viewpoint == null
        ? undefined
        : new GlobPattern(args.viewpoint, args.caseSensitive ?? false);
    new ViewpointReading().validate(
      [...new Set(termKinds.map((termKind) => termKind.viewpoint!))],
      viewpoint ? [viewpoint.text] : [],
      args.caseSensitive ?? false,
    );
    if (args.termKind == null) return { viewpoint };
    const unique = [
      ...new Map(
        termKinds.map((termKind) => [
          termKindIdentity(termKind.name, termKind.viewpoint),
          termKind,
        ]),
      ).values(),
    ];
    const termKind = resolveTermKind(unique, args.termKind, args.caseSensitive ?? false);
    return { termKind: termKindIdentity(termKind.name, termKind.viewpoint), viewpoint };
  }
  private terms(args: Selection, context: GraphQLContext) {
    const index = this.corpus.index;
    if (args.knowledge != null)
      args = {
        ...args,
        knowledge: this.requireKnowledge(args.knowledge, args.caseSensitive ?? false),
      };
    const patterns = [args.match ?? '*'];
    index.selectors(patterns, args.knowledge ?? undefined, args.caseSensitive ?? false);
    const filter = this.filters(args);
    if (args.text != null && !args.text.trim()) throw new Error('Search text must not be empty.');
    const termDeclarations =
      args.text == null
        ? index.select(patterns, args.knowledge ?? undefined, args.caseSensitive ?? false)
        : index
            .search(
              args.text,
              true,
              patterns,
              index.relations,
              args.knowledge ?? undefined,
              args.caseSensitive ?? false,
            )
            .map((match) => match.termDeclaration);
    const ids = [
      ...new Set(
        termDeclarations
          .filter(
            (termDeclaration) =>
              (!filter.termKind ||
                termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint) ===
                  filter.termKind) &&
              (!filter.viewpoint || filter.viewpoint.matches(termDeclaration.viewpoint ?? '')),
          )
          .map((termDeclaration) => termDeclaration.id),
      ),
    ].sort(byText);
    return this.collection(
      ids,
      args,
      [
        'terms',
        args.knowledge ?? null,
        args.match ?? '*',
        filter.termKind ?? null,
        filter.viewpoint?.text ?? null,
        args.text ?? null,
        args.caseSensitive ?? false,
      ],
      (id) => this.term(id),
      (id) => termJson(this.corpus.index.get(id)[0]!),
      context,
    );
  }
  private knowledgeJson(id: string) {
    const trmFile = this.trmFiles.get(id)!;
    return {
      id,
      file: trmFile.path,
      description: trmFile.parsed!.description?.content ?? null,
      scope: trmFile.parsed!.scope?.content ?? null,
      readOnly: trmFile.readOnly ?? false,
    };
  }
  private knowledge(id: string): object {
    return {
      ...this.knowledgeJson(id),
      viewpoints: (args: Page, context: GraphQLContext) =>
        this.viewpoints({ ...args, knowledge: id }, context),
      terms: (args: Selection, context: GraphQLContext) =>
        this.terms({ ...args, knowledge: id }, context),
    };
  }
  private viewpointBindings(args: Selection): { knowledge: string; name: string }[] {
    const knowledge =
      args.knowledge == null
        ? undefined
        : this.requireKnowledge(args.knowledge, args.caseSensitive ?? false);
    return [...this.trmFiles]
      .filter(([id]) => !knowledge || id === knowledge)
      .flatMap(([id, file]) =>
        [...(file.parsed!.viewpoints ?? [])].sort(byText).map((name) => ({ knowledge: id, name })),
      );
  }
  private viewpointJson(knowledge: string, name: string) {
    return { name, knowledge: this.knowledgeJson(knowledge) };
  }
  private viewpoints(args: Selection, context: GraphQLContext) {
    return this.collection(
      this.viewpointBindings(args),
      args,
      ['viewpoints', args.knowledge ?? null, args.caseSensitive ?? false],
      ({ knowledge, name }) => this.viewpoint(knowledge, name),
      ({ knowledge, name }) => this.viewpointJson(knowledge, name),
      context,
    );
  }
  private viewpoint(knowledge: string, name: string): object {
    return {
      name,
      knowledge: () => this.knowledge(knowledge),
      termKinds: (args: Page, context: GraphQLContext) =>
        this.termKinds({ ...args, knowledge, viewpoint: name }, context),
    };
  }
  private termKinds(args: Selection, context: GraphQLContext) {
    const values = this.viewpointBindings(args)
      .filter((binding) => args.viewpoint == null || binding.name === args.viewpoint)
      .flatMap(({ knowledge, name }) =>
        this.vocabulary(knowledge)
          .filter((kind) => kind.viewpoint === name)
          .sort((a, b) => byText(a.name, b.name))
          .map((kind) => ({ knowledge, kind })),
      );
    return this.collection(
      values,
      args,
      ['termKinds', args.knowledge ?? null, args.viewpoint ?? null, args.caseSensitive ?? false],
      ({ knowledge, kind }) => this.termKind(knowledge, kind),
      ({ knowledge, kind }) => ({
        name: kind.name,
        qualifiedName: termKindIdentity(kind.name, kind.viewpoint),
        description: kind.description,
        viewpoint: this.viewpointJson(knowledge, kind.viewpoint!),
        sections: this.sectionDefinitions(kind),
      }),
      context,
    );
  }
  private sectionDefinitions(termKind: AtermTermKind) {
    return termKind.schema.sections.map((section) => ({
      key: section.name,
      format: section.type,
      description: section.description ?? null,
      example: section.example ?? null,
      questions: section.questions ?? [],
    }));
  }
  private termKind(knowledge: string, termKind: AtermTermKind): object {
    return {
      name: termKind.name,
      qualifiedName: termKindIdentity(termKind.name, termKind.viewpoint),
      description: termKind.description,
      viewpoint: () => this.viewpoint(knowledge, termKind.viewpoint!),
      sections: () => this.sectionDefinitions(termKind),
    };
  }
  private term(id: string): object {
    const termDeclarations = this.corpus.index.get(id);
    const first = termDeclarations[0]!;
    return {
      id,
      name: localTerm(id),
      knowledge: () => this.knowledge(first.knowledge),
      termDeclarations: (args: Selection) => {
        const filter = this.filters({ ...args, knowledge: first.knowledge });
        return termDeclarations
          .filter(
            (termDeclaration) =>
              (!filter.termKind ||
                termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint) ===
                  filter.termKind) &&
              (!filter.viewpoint || filter.viewpoint.matches(termDeclaration.viewpoint ?? '')),
          )
          .map((termDeclaration) => this.termDeclaration(termDeclaration));
      },
      outgoing: (args: Edges, context: GraphQLContext) =>
        this.edges(
          this.graph.outgoing(id, args.includeRemarks ?? true),
          args,
          ['outgoing', id],
          context,
        ),
      incoming: (args: Edges, context: GraphQLContext) =>
        this.edges(
          this.graph.incoming(id, args.includeRemarks ?? true),
          args,
          ['incoming', id],
          context,
        ),
    };
  }
  private termDeclaration(termDeclaration: ITermDeclaration): object {
    const termKind = this.vocabulary(termDeclaration.knowledge).find(
      (termKind) =>
        termKindIdentity(termKind.name, termKind.viewpoint) ===
        termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint),
    )!;
    return {
      id: termDeclarationIdentity(termDeclaration),
      term: () => this.term(termDeclaration.id),
      termKind: () => this.termKind(termDeclaration.knowledge, termKind),
      group: termDeclaration.group,
      definition: termDeclaration.sections.find((section) => section.key === 'definition')!.content,
      file: termDeclaration.file,
      line: termDeclaration.line,
      endLine: termDeclaration.endLine,
      sections: ({ keys, caseSensitive }: { keys?: string[] | null } & Matching) => {
        const matching = new TextMatching(caseSensitive ?? false);
        for (const key of keys ?? [])
          if (
            !termDeclaration.schema.sections.some((section) => matching.equals(section.name, key))
          )
            throw new Error(
              `Unknown section ${key} in ${termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint)}.`,
            );
        return termDeclaration.sections
          .filter((section) => !keys || keys.some((key) => matching.equals(key, section.key)))
          .map((section) => ({ ...section, format: section.filetype }));
      },
      outgoing: (args: Edges, context: GraphQLContext) =>
        this.edges(
          this.graph.outgoingTermDeclaration(termDeclaration, args.includeRemarks ?? true),
          args,
          ['termDeclaration', termDeclarationIdentity(termDeclaration)],
          context,
        ),
    };
  }
  private edges(
    edges: readonly IReferenceEdge[],
    args: Edges,
    owner: readonly string[],
    context: GraphQLContext,
  ) {
    const knowledge =
      args.knowledge == null
        ? undefined
        : this.requireKnowledge(args.knowledge, args.caseSensitive ?? false);
    const inKnowledge = (id: string) => this.corpus.index.get(id)[0]?.knowledge === knowledge;
    const phrase =
      args.phrase == null ? undefined : new GlobPattern(args.phrase, args.caseSensitive ?? false);
    const matching = new TextMatching(args.caseSensitive ?? false);
    const selected = edges.filter(
      (edge) =>
        (knowledge === undefined || inKnowledge(edge.source) || inKnowledge(edge.target)) &&
        (!phrase || phrase.matches(edge.phrase ?? 'references')) &&
        (args.origin == null ||
          (edge.origin === 'explicit' ? 'reference' : 'relation') === args.origin) &&
        (args.type == null || matching.equals(edge.type, args.type)) &&
        (args.structural == null || edge.structural === args.structural),
    );
    return this.collection(
      selected,
      args,
      [
        owner,
        knowledge ?? null,
        args.phrase ?? null,
        args.origin ?? null,
        args.type ?? null,
        args.structural ?? null,
        args.includeRemarks ?? true,
        args.caseSensitive ?? false,
      ],
      (edge) => ({
        ...this.edgeMetadata(edge),
        source: () => this.term(edge.source),
        target: () => this.term(edge.target),
      }),
      (edge) => this.edgeJson(edge),
      context,
    );
  }
  private edgeMetadata(edge: IReferenceEdge) {
    return {
      phrase: edge.phrase ?? 'references',
      required: edge.required ?? false,
      origin: edge.origin === 'explicit' ? 'reference' : 'relation',
      type: edge.type,
      structural: edge.structural,
      section: edge.section ?? null,
      targetSection: edge.targetSection ?? null,
      locations: edge.locations,
    };
  }
  private edgeJson(edge: IReferenceEdge) {
    return {
      ...this.edgeMetadata(edge),
      source: termJson(this.corpus.index.get(edge.source)[0]!),
      target: termJson(this.corpus.index.get(edge.target)[0]!),
    };
  }
  private async collection<T, R>(
    values: readonly T[],
    args: Page,
    key: unknown,
    project: (value: T) => R,
    json: (value: T) => unknown,
    context: GraphQLContext,
  ) {
    const selected = await selectCollection(values, args, json, context);
    return this.page(
      selected,
      args,
      [key, args.where ?? null, args.orderBy ?? [], args.bindings ?? {}, hash(selected)],
      project,
    );
  }
  private page<T, R>(values: readonly T[], args: Page, key: unknown, project: (value: T) => R) {
    const first = args.first ?? 20;
    if (!Number.isInteger(first) || first < 1 || first > 100)
      throw new Error('first must be between 1 and 100.');
    const signature = hash([this.fingerprint, key]);
    let offset = 0;
    if (args.after != null) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(args.after) || args.after.length > 256) throw new Error();
        const cursor: unknown = JSON.parse(Buffer.from(args.after, 'base64url').toString());
        if (
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          cursor[0] !== signature ||
          !Number.isSafeInteger(cursor[1]) ||
          cursor[1] < 1 ||
          cursor[1] > values.length
        )
          throw new Error();
        offset = cursor[1];
      } catch {
        throw new Error('Invalid or stale cursor for this collection; restart pagination.');
      }
    }
    const end = Math.min(offset + first, values.length);
    return {
      nodes: values.slice(offset, end).map(project),
      totalCount: values.length,
      pageInfo: {
        hasNextPage: end < values.length,
        endCursor:
          end > offset ? Buffer.from(JSON.stringify([signature, end])).toString('base64url') : null,
      },
    };
  }
}
