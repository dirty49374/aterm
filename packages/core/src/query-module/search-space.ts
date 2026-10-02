import type { ITermDeclaration, ISourceLocation } from '../syntax-module/index.js';
import { GlobPattern } from './pattern.js';
import type { TermDeclarationIndex } from './registry.js';

export interface IAtermSearchSpace {
  readonly caseSensitive?: boolean;
  readonly knowledge?: string;
  readonly viewpoints?: readonly string[];
  readonly excludeViewpoints?: readonly string[];
  readonly relationPhrases?: readonly string[];
  readonly excludeRelations?: readonly string[];
}

/** _aterm:Search_Space_ is a query projection, never a smaller validation corpus. */
export class AtermSearchSpace {
  private readonly termDeclarationsByFile = new Map<string, ITermDeclaration[]>();
  private readonly includeViewpoints: GlobPattern[];
  private readonly excludeViewpoints: GlobPattern[];
  private readonly includeRelations: GlobPattern[];
  private readonly excludeRelations: GlobPattern[];
  constructor(
    private readonly index: TermDeclarationIndex,
    private readonly input: IAtermSearchSpace = {},
  ) {
    for (const termDeclaration of index.termDeclarations) {
      const termDeclarations = this.termDeclarationsByFile.get(termDeclaration.file) ?? [];
      termDeclarations.push(termDeclaration);
      this.termDeclarationsByFile.set(termDeclaration.file, termDeclarations);
    }
    for (const termDeclarations of this.termDeclarationsByFile.values())
      termDeclarations.sort((a, b) => a.line - b.line);
    const pattern = (p: string) => new GlobPattern(p, input.caseSensitive ?? false);
    this.includeViewpoints = (input.viewpoints ?? []).map(pattern);
    this.excludeViewpoints = (input.excludeViewpoints ?? []).map(pattern);
    this.includeRelations = (input.relationPhrases ?? []).map(pattern);
    this.excludeRelations = (input.excludeRelations ?? []).map(pattern);
  }
  term(name: string): boolean {
    return this.index.get(name).some((termDeclaration) => this.termDeclaration(termDeclaration));
  }
  termDeclaration(termDeclaration: ITermDeclaration): boolean {
    const viewpoint = termDeclaration.viewpoint ?? '';
    return (
      (!this.includeViewpoints.length ||
        this.includeViewpoints.some((p) => p.matches(viewpoint))) &&
      !this.excludeViewpoints.some((p) => p.matches(viewpoint))
    );
  }
  locations(locations: readonly ISourceLocation[]): readonly ISourceLocation[] {
    return locations.filter((location) => {
      const termDeclarations = this.termDeclarationsByFile.get(location.file) ?? [];
      let low = 0,
        high = termDeclarations.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (termDeclarations[middle]!.line <= location.line) low = middle + 1;
        else high = middle;
      }
      const owner = termDeclarations[low - 1];
      return owner !== undefined && owner.endLine >= location.line && this.termDeclaration(owner);
    });
  }

  require(name: string): void {
    if (!this.term(name))
      throw new Error(`Term ${name} is outside the search space; adjust Viewpoint filters.`);
  }
  select(termPatterns: readonly string[]): readonly ITermDeclaration[] {
    for (const pattern of termPatterns)
      if (!new GlobPattern(pattern).isGlob)
        this.require(
          this.index.resolve(pattern, this.input.knowledge, this.input.caseSensitive ?? false),
        );
    return this.index
      .select(termPatterns, this.input.knowledge, this.input.caseSensitive ?? false)
      .filter((d) => this.termDeclaration(d));
  }
  relation(r: { source: string; phrase: string; target: string }): boolean {
    if (!this.term(r.source) || !this.term(r.target)) return false;
    return (
      (!this.includeRelations.length || this.includeRelations.some((p) => p.matches(r.phrase))) &&
      !this.excludeRelations.some((p) => p.matches(r.phrase))
    );
  }
}
