import { AtermError } from '../error.js';
import { TermDeclarationIndex } from './registry.js';
import { GlobPattern } from './pattern.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';

/** Query-owned _aterm:Corpus_Index_ over the admitted Knowledges of one scan. */
export class IndexedCorpus {
  readonly trmFiles: readonly ITrmFile[];
  readonly index: TermDeclarationIndex;
  constructor(trmFiles: readonly ITrmFile[]) {
    this.trmFiles = trmFiles.filter((d) => d.parsed !== undefined);
    this.index = new TermDeclarationIndex(
      this.trmFiles.map((d) => ({
        ...d.parsed!,
        file: d.absolutePath,
        termKinds: d.parsed!.termKinds,
        relations: d.parsed!.relations?.map((r) => ({ ...r, file: d.absolutePath })),
        termDeclarations: d.parsed!.termDeclarations.map((definition) => ({
          ...definition,
          file: d.absolutePath,
          references: definition.references.map((ref) => ({ ...ref, file: d.absolutePath })),
        })),
        diagnostics: d.parsed!.diagnostics.map((issue) => ({ ...issue, file: d.absolutePath })),
      })),
    );
  }
  /** Workspace-relative source file paths to index file identities, with Term selector glob rules. */
  files(selectors: readonly string[], caseSensitive = false): readonly string[] {
    const filePatterns = selectors.map((selector) => new GlobPattern(selector, caseSensitive));
    for (const pattern of filePatterns)
      if (!pattern.isGlob && !this.trmFiles.some((d) => pattern.matches(d.path)))
        throw new AtermError(
          'aterm.file',
          `Unknown Aterm file ${pattern.text}. Use a workspace-relative path such as docs/SPEC-core.trm or a quoted glob.`,
        );
    return this.trmFiles
      .filter((d) => filePatterns.some((pattern) => pattern.matches(d.path)))
      .map((d) => d.absolutePath);
  }
}
