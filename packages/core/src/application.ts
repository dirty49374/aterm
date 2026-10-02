import { ExternalFiles, ExternalText, type IExternalScan } from './external-module/index.js';
import { TermRetrieval, type ISemanticIndexResult } from './retrieval-module/retrieval.js';
import type { IDiscoveryResult } from './query-module/discovery.js';
import { AtermError } from './error.js';
import { TextMatching } from './matching.js';
import { AtermScanner, type ITrmFile, type IScanResult } from './corpus-module/index.js';
import {
  AtermConfigReader,
  AtermHomeDiscovery,
  type IAtermConfig,
  type IAtermHome,
} from './home-module/index.js';
import {
  atermQuery,
  TermDeclarationReader,
  ViewpointReading,
  KnowledgeReading,
  type IKnowledgeResult,
  type AtermQuery,
  type ITermDeclarationResult,
  type IViewpointResult,
  GraphQLReading,
  type IGraphQLResult,
  type IndexedCorpus,
} from './query-module/index.js';
import {
  checkCorpus,
  AtermEditor,
  TermDeclarationChanges,
  type IAtermEditResult,
  type ITermDeclarationDiff,
} from './authoring-module/index.js';
import { GuidanceCatalog } from './skill-module/guidance-catalog.js';
import { SkillReading, type ISkillResult } from './skill-module/index.js';
import { readJq } from './query-module/jq.js';
import { executeJq } from './jq-module/index.js';
import type { IJqResult } from './query-module/jq-request.js';

export type AtermResult =
  | IJqResult
  | IGraphQLResult
  | ISkillResult
  | IDiscoveryResult
  | ISemanticIndexResult
  | ITermDeclarationResult
  | ITermDeclarationDiff
  | IAtermEditResult
  | IViewpointResult
  | IKnowledgeResult;

export interface IAtermOpenOptions {
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

type SnapshotQuery = Omit<AtermQuery, 'operation'> & {
  operation: Exclude<AtermQuery['operation'], 'edit' | 'rename' | 'rename-knowledge' | 'move' | 'format' | 'viewpoint' | 'changes'>;
};

/** The one entry every adapter uses: a selected home, its config, and query dispatch. */
export class AtermApplication {
  private readonly scanner = new AtermScanner();
  private readonly reader: TermDeclarationReader;
  private readonly graphqlReadings = new WeakMap<IndexedCorpus, GraphQLReading>();
  constructor(
    readonly config: IAtermConfig,
    private readonly readSnapshot?: IScanResult,
    private readonly externalSnapshot?: IExternalScan | Error,
  ) {
    this.reader = new TermDeclarationReader();
  }

  get home(): IAtermHome {
    return this.config.home;
  }

  static async open(options: IAtermOpenOptions = {}): Promise<AtermApplication> {
    const cwd = options.cwd ?? process.cwd();
    const home = await new AtermHomeDiscovery(options.env ?? process.env).discover(
      cwd,
      options.home,
    );
    return new AtermApplication(await new AtermConfigReader().read(home));
  }

  scan(): Promise<IScanResult> {
    return this.scanner.scan(this.config);
  }

  async trmFiles(): Promise<readonly ITrmFile[]> {
    return (await this.scan()).trmFiles;
  }

  async query(input: AtermQuery): Promise<AtermResult> {
    const parsed = atermQuery.safeParse(input);
    if (!parsed.success)
      throw new AtermError(
        'aterm.query',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '),
      );
    const query = parsed.data;
    const caseSensitive = query.caseSensitive ?? false;
    const matching = new TextMatching(caseSensitive);
    if (
      query.operation === 'edit' ||
      query.operation === 'rename' ||
      query.operation === 'rename-knowledge' ||
      query.operation === 'move' ||
      query.operation === 'format'
    ) {
      return this.author(query);
    }
    // A Viewpoint is settled by the configuration, so this answer never scans a source.
    if (query.operation === 'viewpoint')
      return new ViewpointReading().read(this.config, {
        viewpoints: query.viewpoints,
        caseSensitive,
        guidance: query.guidance,
      });
    if (query.operation === 'changes')
      return new TermDeclarationChanges().read(
        this.config.home.workspace,
        this.config.sources,
        query.commit,
        query.files,
        caseSensitive,
      );
    return this.readQuery({ ...query, operation: query.operation }, matching, caseSensitive);
  }
  private async readQuery(
    query: SnapshotQuery,
    matching: TextMatching,
    caseSensitive: boolean,
  ): Promise<AtermResult> {
    const { operation, ...rest } = query;
    const scan = this.readSnapshot ?? (await this.scan());
    if (operation === 'jq') {
      const { corpus } = this.reader.prepare(scan.trmFiles, scan.diagnostics);
      return { operation, values: await readJq(corpus, query.jq!, executeJq, caseSensitive) };
    }
    if (operation === 'graphql') return this.graphql(query, scan, caseSensitive);
    this.validateReadSelection(query, scan, matching, caseSensitive);

    if (operation === 'discover' || operation === 'index-build' || operation === 'index-status') {
      return this.discover(query, scan, caseSensitive);
    }
    if (operation === 'knowledge-list' || operation === 'knowledge-view') {
      const validated = this.reader.query(scan.trmFiles, { operation: 'list' }, scan.diagnostics);
      return new KnowledgeReading().read(
        scan.trmFiles,
        validated.termDeclarations,
        operation,
        query.knowledgeIds,
        caseSensitive,
      );
    }
    if (
      operation === 'skill-list' ||
      operation === 'skill-toc' ||
      operation === 'skill-view' ||
      operation === 'skill-remind'
    ) {
      const catalog = await new GuidanceCatalog().read(this.config, () => scan);
      return new SkillReading(
        catalog.termDeclarations,
        catalog.scan.trmFiles.flatMap((f) => f.parsed?.relations ?? []),
      ).read(operation, query.skillTerms, query.knowledge, caseSensitive);
    }
    if (operation === 'check') return checkCorpus(this.config, scan, rest);
    const result = this.reader.query(scan.trmFiles, { ...rest, operation }, scan.diagnostics);
    if (result.ambiguity) return result;
    if (operation !== 'search' && operation !== 'grep') return result;
    return this.externalRead(query, result, caseSensitive);
  }
  private async author(query: AtermQuery): Promise<IAtermEditResult> {
    const editor = new AtermEditor(this.config, {
      load: async () => {
        const scan = await this.scan();
        const errors = scan.diagnostics.filter((d) => d.severity === 'error');
        if (errors.length)
          throw new AtermError(
            'aterm.invalid',
            errors.map((d) => `${d.file}:${d.line}: ${d.message}`).join('\n'),
          );
        return scan.trmFiles;
      },
    });
    if (query.operation === 'rename-knowledge')
      return editor.renameKnowledge({
        from: query.from ?? '',
        to: query.to ?? '',
        dryRun: query.dryRun,
        externalSources: query.externalSources ?? this.config.externalSources,
      });
    if (query.operation === 'move')
      return editor.move({
        knowledge: query.knowledge,
        termPatterns: query.termPatterns ?? [],
        to: query.to ?? '',
        dryRun: query.dryRun,
        externalSources: query.externalSources ?? this.config.externalSources,
      });
    if (query.operation === 'format')
      return editor.format({
        knowledge: query.knowledge,
        termPatterns: query.termPatterns,
        dryRun: query.dryRun,
      });
    return query.operation === 'edit'
      ? editor.edit({
          knowledge: query.knowledge,
          patch: query.patch ?? '',
          dryRun: query.dryRun,
        })
      : editor.rename({
          knowledge: query.knowledge,
          from: query.from ?? '',
          to: query.to ?? '',
          dryRun: query.dryRun,
          externalSources: query.externalSources ?? this.config.externalSources,
        });
  }
  private async graphql(
    query: AtermQuery,
    scan: IScanResult,
    caseSensitive: boolean,
  ): Promise<IGraphQLResult> {
    const operation = 'graphql';
    try {
      const { corpus } = this.reader.prepare(scan.trmFiles, scan.diagnostics);
      let reading = this.graphqlReadings.get(corpus);
      if (!reading) {
        reading = new GraphQLReading(corpus, executeJq);
        this.graphqlReadings.set(corpus, reading);
      }
      return { operation, response: await reading.execute(query.graphql!, caseSensitive) };
    } catch (error) {
      return {
        operation,
        response: {
          errors: [
            {
              message: error instanceof Error ? error.message : String(error),
              extensions: { code: error instanceof AtermError ? error.code : 'graphql.query' },
            },
          ],
        },
      };
    }
  }
  private validateReadSelection(
    query: AtermQuery,
    scan: IScanResult,
    matching: TextMatching,
    caseSensitive: boolean,
  ): void {
    const vocabulary = [
      ...this.config.viewpoints.flatMap((viewpoint) => viewpoint.termKinds),
      ...scan.trmFiles.flatMap((trmFile) => trmFile.parsed?.termKinds ?? []),
    ];
    if (query.searchSections) {
      const sections = new Set(
        vocabulary.flatMap((termKind) => termKind.schema.sections.map((section) => section.name)),
      );
      query.searchSections = [
        ...new Set(
          query.searchSections.flatMap((key) => {
            const canonical = [...sections].filter((section) => matching.equals(section, key));
            if (!canonical.length)
              throw new AtermError(
                'search.section',
                `Unknown search section ${key}; expected one of ${[...sections].sort().join(', ')}.`,
              );
            return canonical;
          }),
        ),
      ];
    }
    const viewpointNames = [
      ...new Set([
        ...this.config.viewpoints.map((viewpoint) => viewpoint.name),
        ...scan.trmFiles.flatMap((trmFile) => trmFile.viewpoints ?? []),
      ]),
    ];
    for (const selected of [query.viewpoints, query.excludeViewpoints])
      new ViewpointReading().validate(viewpointNames, selected, caseSensitive);
  }
  private async discover(
    query: AtermQuery,
    scan: IScanResult,
    caseSensitive: boolean,
  ): Promise<AtermResult> {
    const operation = query.operation;
    const selected = this.reader.query(
      scan.trmFiles,
      {
        operation: 'list',
        knowledge: query.knowledge,
        termPatterns: query.termPatterns,
        viewpoints: query.viewpoints,
        caseSensitive,
        excludeViewpoints: query.excludeViewpoints,
        remarks: true,
      },
      scan.diagnostics,
    );
    if (selected.ambiguity) return selected;
    const retrieval = new TermRetrieval(this.home.home);
    return operation === 'discover'
      ? retrieval.discover(
          selected,
          query.question!,
          query.searchMode ?? 'hybrid',
          query.limit ?? 10,
          query.remarks ?? true,
          query.searchSections,
          caseSensitive,
        )
      : retrieval.index(selected, operation === 'index-build');
  }
  private async externalRead(
    query: AtermQuery,
    result: ITermDeclarationResult,
    caseSensitive: boolean,
  ): Promise<ITermDeclarationResult> {
    const operation = query.operation;
    const configured = this.config;
    const selection = query.externalSources ? query : configured;
    if (!selection?.externalSources) return result;
    if (!query.externalSources && this.externalSnapshot instanceof Error)
      throw this.externalSnapshot;
    const external =
      !query.externalSources && this.externalSnapshot && !(this.externalSnapshot instanceof Error)
        ? this.externalSnapshot
        : await new ExternalFiles().read(this.home.workspace, selection);
    const text = new ExternalText();
    const names = new Set(result.referenceTargets ?? []);
    return {
      ...result,
      ...(operation === 'search'
        ? { externalMatches: text.search(external.files, query.searchText!, caseSensitive) }
        : { externalOccurrences: text.references(external.files, names, caseSensitive) }),
      warnings: [...(result.warnings ?? []), ...external.warnings],
    };
  }
}
