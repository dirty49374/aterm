import { join } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from '../file-module/file-access.js';
import { NativeEmbedding, embeddingModel, type ITextEmbedding } from '../file-module/embedding.js';
import { discoveryChunks, rankDiscovery, type SearchMode } from '../query-module/discovery.js';
import type { ITermDeclarationResult } from '../query-module/reader.js';
import type { IDiagnostic } from '../syntax-module/model.js';

export interface ISemanticIndexResult {
  readonly operation: 'index-build' | 'index-status';
  readonly model: typeof embeddingModel;
  readonly cache: string;
  readonly corpusFingerprint: string;
  readonly chunks: number;
  readonly cachedChunks: number;
  readonly missingChunks: number;
  readonly modelReady: boolean;
  readonly ready: boolean;
  readonly warnings: readonly IDiagnostic[];
}

/** _aterm_development:Retrieval_Module_ consumes a validated snapshot, never rescans it. */
export class TermRetrieval {
  private readonly files = new FileAccess();
  private readonly directory: string;
  private readonly path: string;
  private readonly embedding: ITextEmbedding;
  constructor(
    private readonly home: string,
    embedding?: ITextEmbedding,
  ) {
    this.directory = join(home, 'cache', 'semantic');
    this.path = join(this.directory, 'vectors.sqlite');
    this.embedding = embedding ?? new NativeEmbedding(join(this.directory, 'models'));
  }
  private source(
    result: ITermDeclarationResult,
    includeRemarks = true,
    searchSections?: readonly string[],
  ) {
    const chunks = discoveryChunks(result.termDeclarations, includeRemarks, searchSections);
    const keys = chunks.map((chunk) =>
      this.files.hash(JSON.stringify([embeddingModel, chunk.input])),
    );
    const fingerprint = this.files.hash(
      JSON.stringify(
        result.termDeclarations.map((termDeclaration) => [
          termDeclaration.id,
          termDeclaration.termKind,
          termDeclaration.file,
          termDeclaration.line,
          termDeclaration.endLine,
          termDeclaration.sections,
        ]),
      ),
    );
    return { chunks, keys, fingerprint };
  }
  async index(result: ITermDeclarationResult, build: boolean): Promise<ISemanticIndexResult> {
    await this.files.guard(this.home, join(this.directory, 'models'));
    const { chunks, keys, fingerprint } = this.source(result);
    const operation = build ? 'index-build' : 'index-status';
    if (!build && !(await this.files.exists(this.path)))
      return {
        operation,
        model: embeddingModel,
        cache: this.path,
        corpusFingerprint: fingerprint,
        chunks: chunks.length,
        cachedChunks: 0,
        missingChunks: chunks.length,
        modelReady: await this.embedding.ready(),
        ready: false,
        warnings: result.warnings ?? [],
      };
    const cache = await this.cache(!build);
    try {
      const vectors = build
        ? await this.fill(
            cache,
            chunks.map((c) => c.input),
            keys,
            true,
          )
        : cache.read(keys);
      const cachedChunks = keys.filter((key) => vectors.has(key)).length;
      const modelReady = await this.embedding.ready();
      return {
        operation,
        model: embeddingModel,
        cache: this.path,
        corpusFingerprint: fingerprint,
        chunks: chunks.length,
        cachedChunks,
        missingChunks: chunks.length - cachedChunks,
        modelReady,
        ready: modelReady && cachedChunks === chunks.length,
        warnings: result.warnings ?? [],
      };
    } finally {
      cache.close();
    }
  }
  async discover(
    result: ITermDeclarationResult,
    question: string,
    mode: SearchMode,
    limit: number,
    includeRemarks = true,
    searchSections?: readonly string[],
    caseSensitive = false,
  ) {
    const { chunks, keys, fingerprint } = this.source(result, includeRemarks, searchSections);
    if (mode === 'lexical')
      return rankDiscovery(
        chunks,
        question,
        mode,
        limit,
        fingerprint,
        undefined,
        result.warnings,
        searchSections,
        caseSensitive,
      );
    // Query inference fails before creating a cache when the Model is unavailable.
    await this.files.guard(this.home, join(this.directory, 'models'));
    const [query] = await this.embedding.embed([question], 'query');
    const cache = await this.cache();
    try {
      const vectors = await this.fill(
        cache,
        chunks.map((c) => c.input),
        keys,
        false,
      );
      const distances = cache.distances(
        keys.map((key) => vectors.get(key)!),
        query!,
      );
      return rankDiscovery(
        chunks,
        question,
        mode,
        limit,
        fingerprint,
        distances,
        result.warnings,
        searchSections,
        caseSensitive,
      );
    } finally {
      cache.close();
    }
  }
  private async cache(readonlyMode = false) {
    await this.files.guard(this.home, this.path);
    if (!readonlyMode) await this.files.ensureDirectory(this.directory);
    try {
      const { VectorCache } = await import('../file-module/vector-cache.js');
      return new VectorCache(this.path, embeddingModel.dimensions, readonlyMode);
    } catch (error) {
      throw new AtermError(
        'search.cache',
        `Cannot open derived cache ${this.path}: ${String(error)}. Move the damaged cache aside, then run aterm corpus index build.`,
      );
    }
  }
  private async fill(
    cache: import('../file-module/vector-cache.js').VectorCache,
    inputs: readonly string[],
    keys: readonly string[],
    download: boolean,
  ) {
    // Explicit build also prepares a Model when no source content is present or all vectors are cached.
    if (download) await this.embedding.embed(['prepare'], 'query', true);
    const vectors = cache.read(keys);
    const missing = [
      ...new Map(
        keys.flatMap((key, index) => (vectors.has(key) ? [] : [[key, inputs[index]!] as const])),
      ),
    ];
    for (let start = 0; start < missing.length; start += 16) {
      const batch = missing.slice(start, start + 16);
      const embedded = await this.embedding.embed(
        batch.map(([, input]) => input),
        'passage',
        download,
      );
      if (embedded.length !== batch.length)
        throw new AtermError('search.vector', 'Embedding batch size did not match its inputs.');
      const records = new Map(batch.map(([key], index) => [key, embedded[index]!]));
      cache.put(records);
      for (const [key, vector] of records) vectors.set(key, vector);
    }
    return vectors;
  }
}
