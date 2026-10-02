import { SectionContext } from './section-context.js';
import type { IExternalMatch, IExternalReference } from '../external-module/index.js';
import { byText } from '../order.js';
import { AtermError } from '../error.js';
import type { IAtermDiagnostic, ITrmFile } from '../corpus-module/trm-file.js';
import { IndexedCorpus } from './corpus.js';
import { TermDeclarationGraph } from './graph.js';
import {
  ConceptMap,
  type IConceptMap,
  type IConceptRelation,
  type RelationOrigin,
} from './concept-map.js';
import type {
  ITermDeclaration,
  IDiagnostic,
  IReferenceEdge,
  IKnowledgeText,
} from '../syntax-module/index.js';
import { AmbiguousTermError, type ITermCandidate, type ISearchMatch } from './registry.js';
import { TermDeclarationProjection, type ITermDeclarationView } from './projection.js';
import { AtermSearchSpace, type IAtermSearchSpace } from './search-space.js';

export interface ITermDeclarationQueryInput extends IAtermSearchSpace {
  readonly operation:
    | 'list'
    | 'search'
    | 'show'
    | 'view'
    | 'check'
    | 'grep'
    | 'path'
    | 'overview'
    | 'connect'
    | 'relations';
  readonly edgeOrigins?: readonly RelationOrigin[];
  /** Workspace-relative Aterm file paths or quoted globs selecting every Term they declare. */
  readonly files?: readonly string[];
  readonly from?: string;
  readonly to?: string;
  readonly termPatterns?: readonly string[];
  readonly searchText?: string;
  readonly referencePattern?: string;
  readonly unreferenced?: boolean;
  readonly roots?: readonly string[];
  readonly remarks?: boolean;
  readonly limit?: number;
}
export interface ITermDeclarationResult {
  /** Resources for Markdown section expansion; separate from selected/required Term Declarations. */
  readonly sectionContext?: readonly ITermDeclarationView[];
  readonly ambiguity?: { readonly candidates: readonly ITermCandidate[]; readonly hint: string };
  readonly referenceTargets?: readonly string[];
  readonly externalOccurrences?: readonly IExternalReference[];
  readonly externalMatches?: readonly IExternalMatch[];
  /** The operation that produced this result, so that presentation needs no other input. */
  readonly operation: ITermDeclarationQueryInput['operation'];
  readonly conceptMap?: IConceptMap;
  readonly relations?: readonly IConceptRelation[];
  readonly knowledges?: readonly {
    readonly id: string;
    readonly file: string;
    readonly description?: IKnowledgeText;
  }[];
  readonly files: readonly string[];
  readonly termDeclarations: readonly ITermDeclarationView[];
  readonly edges: readonly IReferenceEdge[];
  readonly matches?: readonly ISearchMatch<ITermDeclarationView>[];
  readonly diagnostics: readonly IDiagnostic[];
  readonly warnings?: readonly IDiagnostic[];
  readonly includeRemarks: boolean;
  readonly paths?: readonly (readonly string[])[];
  readonly occurrences?: readonly {
    term: string;
    termKind: string;
    file?: string;
    line?: number;
    lines: readonly { line: number; text: string }[];
  }[];
}

interface ReaderContext {
  readonly corpus: IndexedCorpus;
  readonly index: IndexedCorpus['index'];
  readonly graph: TermDeclarationGraph;
  readonly space: AtermSearchSpace;
  readonly base: ITermDeclarationResult;
  readonly diagnostics: IDiagnostic[];
  readonly includeRemarks: boolean;
  readonly caseSensitive: boolean;
  readonly requestedPatterns: readonly string[];
}

/** One home-wide symbol table over every admitted .trm file, independent of Term Kind. */
export class TermDeclarationReader {
  private readonly prepared = new WeakMap<readonly ITrmFile[], IndexedCorpus>();
  /** One preparation and validity boundary for ordinary and GraphQL reads. */
  prepare(
    source: readonly ITrmFile[],
    scan: readonly IAtermDiagnostic[] = [],
    allowInvalid = false,
  ): { corpus: IndexedCorpus; diagnostics: IDiagnostic[] } {
    let corpus = this.prepared.get(source);
    if (!corpus) {
      corpus = new IndexedCorpus(source);
      new TermDeclarationGraph(corpus.index);
      this.prepared.set(source, corpus);
    }
    const diagnostics = [
      ...corpus.index.diagnostics,
      ...scan.filter((issue) => issue.severity === 'error').map(this.located),
    ];
    if (diagnostics.length && !allowInvalid)
      throw new AtermError(
        'aterm.invalid',
        diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`).join('\n'),
      );
    return { corpus, diagnostics };
  }
  query(
    source: readonly ITrmFile[],
    query: ITermDeclarationQueryInput,
    scan: readonly IAtermDiagnostic[] = [],
  ): ITermDeclarationResult {
    const { corpus, diagnostics } = this.prepare(source, scan, query.operation === 'check');
    const { trmFiles, index } = corpus;
    const space = new AtermSearchSpace(index, query);
    const graph = new TermDeclarationGraph(index, diagnostics.length ? undefined : space);
    const includeRemarks = query.remarks ?? true;
    const compact = ['overview', 'connect', 'relations'].includes(query.operation);
    const edges =
      compact || diagnostics.length
        ? []
        : [...new Set(index.termDeclarations.map((d) => d.id))].flatMap((name) =>
            graph.outgoing(name, includeRemarks),
          );
    const base = {
      operation: query.operation,
      files: trmFiles.map((d) => d.absolutePath).sort(byText),
      knowledges: trmFiles
        .flatMap((d) =>
          d.parsed?.knowledge
            ? [
                {
                  id: d.parsed.knowledge,
                  file: d.absolutePath,
                  ...(d.parsed.description ? { description: d.parsed.description } : {}),
                },
              ]
            : [],
        )
        .sort((a, b) => byText(a.id, b.id)),
      termDeclarations: compact ? [] : this.visible(index.termDeclarations, includeRemarks),
      edges,
      diagnostics,
      includeRemarks,
      warnings: scan.filter((issue) => issue.severity === 'warning').map(this.located),
    };
    if (diagnostics.length) return base;
    const requestedPatterns = query.termPatterns ?? [];
    const caseSensitive = query.caseSensitive ?? false;
    // Resolve exact identities before applying presentation filters or executing any part.
    try {
      query = this.resolveQuery(index, query, caseSensitive);
      const context: ReaderContext = {
        corpus,
        index,
        graph,
        space,
        base,
        diagnostics,
        includeRemarks,
        caseSensitive,
        requestedPatterns,
      };
      switch (query.operation) {
        case 'relations':
          return this.relationResult(query, context);
        case 'overview':
        case 'connect':
          return this.conceptMapResult(query, context);
        case 'path':
          return this.pathResult(query, context);
        case 'grep':
          return this.grepResult(query, context);
        case 'check':
          return this.checkResult(query, context);
        default:
          return this.termResult(query, context);
      }
    } catch (error) {
      if (error instanceof AmbiguousTermError)
        return {
          ...base,
          termDeclarations: [],
          edges: [],
          ambiguity: {
            candidates: error.candidates,
            hint: 'Use a qualified Term, --knowledge <id>, or --case-sensitive.',
          },
        };
      throw new AtermError('aterm.query', error instanceof Error ? error.message : String(error));
    }
  }
  private resolveQuery(
    index: IndexedCorpus['index'],
    query: ITermDeclarationQueryInput,
    caseSensitive: boolean,
  ): ITermDeclarationQueryInput {
    const supplied = [
      ...(query.termPatterns ?? []),
      ...(query.roots ?? []),
      ...[query.from, query.to, query.referencePattern].filter((v): v is string => v !== undefined),
    ];
    index.selectors(supplied, query.knowledge, caseSensitive);
    const selectors = (values: readonly string[]) =>
      index.selectors(values, query.knowledge, caseSensitive);
    return {
      ...query,
      knowledge: index.requireKnowledge(query.knowledge, caseSensitive),
      termPatterns: selectors(query.termPatterns?.length ? query.termPatterns : ['*']),
      ...(query.roots ? { roots: selectors(query.roots) } : {}),
      ...(query.from ? { from: index.resolve(query.from, query.knowledge, caseSensitive) } : {}),
      ...(query.to ? { to: index.resolve(query.to, query.knowledge, caseSensitive) } : {}),
    };
  }
  private relationResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { index, space, base, includeRemarks } = context;
    const termPatterns = query.termPatterns!;
    const selected = new Set(space.select(termPatterns).map((d) => d.id));
    return {
      ...base,
      termDeclarations: [],
      edges: [],
      relations: new ConceptMap(index, space)
        .relations(includeRemarks, query.edgeOrigins)
        .filter((r) => selected.has(r.source) || selected.has(r.target)),
    };
  }
  private conceptMapResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { corpus, index, space, base, includeRemarks, caseSensitive, requestedPatterns } =
      context;
    const map = new ConceptMap(index, space);
    const conceptMap =
      query.operation === 'overview'
        ? map.overview(
            requestedPatterns.length ? (query.termPatterns ?? []) : [],
            query.edgeOrigins,
            includeRemarks,
            query.files?.length ? corpus.files(query.files, caseSensitive) : undefined,
          )
        : map.connect(query.termPatterns ?? [], query.edgeOrigins, includeRemarks, query.limit);
    return { ...base, termDeclarations: [], edges: [], conceptMap };
  }
  private pathResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { index, graph, space, base, includeRemarks } = context;
    if (!query.from || !query.to) throw new Error('Path requires from and to Terms.');
    index.get(query.from);
    index.get(query.to);
    space.require(query.from);
    space.require(query.to);
    return {
      ...base,
      termDeclarations: [],
      paths: graph.paths(query.from, query.to, includeRemarks),
    };
  }
  private grepResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { index, base, includeRemarks, caseSensitive } = context;
    const termPatterns = query.termPatterns!;
    if (!query.referencePattern) throw new Error('Grep requires a Term or quoted Term glob.');
    const targets = new Set(
      index.select([query.referencePattern], query.knowledge, caseSensitive).map((d) => d.id),
    );
    const occurrences = index.select(termPatterns, query.knowledge, caseSensitive).flatMap((d) => {
      const lines = new Set(
        d.references
          .filter((r) => targets.has(r.id) && (includeRemarks || r.section !== 'remarks'))
          .map((r) => r.line),
      );
      if (targets.has(d.id)) lines.add(d.line);
      return [...lines]
        .sort((a, b) => a - b)
        .map((line) => ({
          term: d.id,
          termKind: d.termKind,
          file: d.file,
          line,
          lines: (d.sourceLines ?? [])
            .filter(
              (l) =>
                l.line >= Math.max(d.line, line - 1) && l.line <= Math.min(d.endLine, line + 1),
            )
            .map((l) => ({ line: l.line - d.line + 1, text: l.text })),
        }));
    });
    return { ...base, termDeclarations: [], occurrences, referenceTargets: [...targets] };
  }
  private checkResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { graph, base, diagnostics, includeRemarks } = context;
    if (query.roots?.length)
      diagnostics.push(
        ...graph.unreachableFrom(query.roots, includeRemarks).map((d) => ({
          file: d.file,
          line: d.line,
          message: `Unreachable Term Declaration ${d.id} from ${query.roots!.join(', ')}.`,
        })),
      );
    return {
      ...base,
      termDeclarations: query.knowledge
        ? base.termDeclarations.filter((e) => e.knowledge === query.knowledge)
        : base.termDeclarations,
    };
  }
  private termResult(
    query: ITermDeclarationQueryInput,
    context: ReaderContext,
  ): ITermDeclarationResult {
    const { index, graph, space, base, includeRemarks, caseSensitive } = context;
    const edges = base.edges;
    const termPatterns = query.termPatterns!;
    let termDeclarations =
      query.operation === 'list' || query.operation === 'search'
        ? space.select(termPatterns)
        : index.select(termPatterns, query.knowledge, caseSensitive);
    if (query.operation === 'list') {
      if (query.unreferenced) {
        const names = new Set(graph.unreferenced(includeRemarks).map((d) => d.id));
        termDeclarations = termDeclarations.filter((d) => names.has(d.id));
      }
      if (query.roots?.length) {
        const names = new Set(graph.unreachableFrom(query.roots, includeRemarks).map((d) => d.id));
        termDeclarations = termDeclarations.filter((d) => names.has(d.id));
      }
    }
    if (query.operation === 'search') {
      if (!query.searchText?.trim()) throw new Error('Search text must not be empty.');
      const matches = index
        .search(
          query.searchText,
          includeRemarks,
          termPatterns,
          index.relations.filter((r) => space.relation(r) && space.locations([r]).length),
          query.knowledge,
          caseSensitive,
        )
        .filter((m) => space.termDeclaration(m.termDeclaration));
      return {
        ...base,
        termDeclarations: this.visible(
          matches.map((m) => m.termDeclaration),
          includeRemarks,
        ),
        matches: matches.map((m) => ({
          ...m,
          termDeclaration: this.visible([m.termDeclaration], includeRemarks)[0]!,
        })),
      };
    }
    if (query.operation === 'view')
      termDeclarations = graph.requiredContext(termDeclarations, includeRemarks);
    const selectedNames = new Set(termDeclarations.map((d) => d.id));
    return {
      ...base,
      ...(['view', 'show'].includes(query.operation)
        ? {
            sectionContext: this.visible(
              new SectionContext(index.termDeclarations).collect(termDeclarations, includeRemarks),
              includeRemarks,
            ),
            edges: edges.filter(
              (edge) => selectedNames.has(edge.source) || selectedNames.has(edge.target),
            ),
          }
        : {}),
      ...(['view', 'show'].includes(query.operation)
        ? {
            relations: new ConceptMap(index)
              .relations(includeRemarks, ['relation'])
              .filter((r) => termDeclarations.some((d) => d.id === r.source || d.id === r.target)),
          }
        : {}),
      termDeclarations: this.visible(termDeclarations, includeRemarks, query.operation === 'view'),
    };
  }
  private located({ file, line, message }: IAtermDiagnostic): IDiagnostic {
    return { file, line, message };
  }
  private visible(
    termDeclarations: readonly ITermDeclaration[],
    remarks: boolean,
    source = false,
  ): readonly ITermDeclarationView[] {
    const projection = new TermDeclarationProjection();
    return termDeclarations.map((definition) =>
      projection.termDeclaration(definition, remarks, source),
    );
  }
}
