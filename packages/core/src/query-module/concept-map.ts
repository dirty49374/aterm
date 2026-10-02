import { TermDeclarationGraph } from './graph.js';
import type { TermDeclarationIndex } from './registry.js';
import type { ISourceLocation, IRelationSemantics } from '../syntax-module/index.js';
import type { AtermSearchSpace } from './search-space.js';
import { ConceptPaths } from './concept-paths.js';
import { byText } from '../order.js';

export type RelationOrigin = 'relation' | 'reference';
/** Authored direction only; a reading from the target uses a reverse arrow, never invented wording. */
export interface IConceptRelation extends IRelationSemantics {
  readonly source: string;
  readonly phrase: string;
  readonly target: string;
  readonly origin: RelationOrigin;
  readonly locations: readonly ISourceLocation[];
}
export interface IConceptTermDeclaration extends ISourceLocation {
  readonly termKind: string;
  readonly group?: string;
  readonly definition: string;
  readonly viewpoint?: string;
}
export interface IConceptTerm {
  readonly id: string;
  readonly knowledge: string;
  readonly name: string;
  readonly termDeclarations: readonly IConceptTermDeclaration[];
}
export interface IConceptMap {
  /** Terms matched by the selectors; other terms are connected neighbors or path steps. */
  readonly selected: readonly string[];
  readonly terms: readonly IConceptTerm[];
  readonly relations: readonly IConceptRelation[];
  readonly paths?: readonly (readonly string[])[];
  readonly disconnected?: readonly (readonly string[])[];
}

/** Discovery projection: semantic direction is independent of traversal direction. */
export class ConceptMap {
  constructor(
    private readonly index: TermDeclarationIndex,
    private readonly space?: AtermSearchSpace,
  ) {}

  relations(
    includeRemarks = true,
    origins: readonly RelationOrigin[] = ['relation', 'reference'],
  ): IConceptRelation[] {
    const graph = new TermDeclarationGraph(this.index);
    const grouped = new Map<string, IConceptRelation>();
    for (const name of new Set(this.index.termDeclarations.map((d) => d.id)))
      for (const e of graph.outgoing(name, includeRemarks)) {
        const eligibleLocations = this.space ? this.space.locations(e.locations) : e.locations;
        if (!eligibleLocations.length) continue;
        const origin = e.origin === 'explicit' ? 'reference' : e.origin;
        const r: IConceptRelation = {
          source: e.source,
          target: e.target,
          phrase: e.origin === 'explicit' ? 'references' : e.phrase!,
          origin,
          type: e.type,
          structural: e.structural,
          locations: eligibleLocations,
        };
        const key = JSON.stringify([r.origin, r.source, r.phrase, r.target]);
        const previous = grouped.get(key);
        const locations = [...(previous?.locations ?? []), ...r.locations];
        grouped.set(key, {
          ...r,
          locations: locations.filter(
            (v, i) => locations.findIndex((p) => p.file === v.file && p.line === v.line) === i,
          ),
        });
      }
    // An explicit Relation for the same ordered pair replaces the generic reference edge in
    // this projection only; raw reference occurrences stay in the index and graph.
    const explicit = new Set(
      [...grouped.values()]
        .filter((r) => r.origin === 'relation')
        .map((r) => JSON.stringify([r.source, r.target])),
    );
    const rank = { relation: 0, reference: 1 };
    return [...grouped.values()]
      .filter(
        (r) =>
          origins.includes(r.origin) &&
          (!this.space || this.space.relation(r)) &&
          !(r.origin === 'reference' && explicit.has(JSON.stringify([r.source, r.target]))),
      )
      .sort((a, b) => rank[a.origin] - rank[b.origin] || byText(this.key(a), this.key(b)));
  }

  /** Pattern seeds are bounded; file seeds are bounded by the selected files themselves. */
  overview(
    termPatterns: readonly string[],
    origins?: readonly RelationOrigin[],
    includeRemarks = true,
    files?: readonly string[],
  ): IConceptMap {
    if (!termPatterns.length && files === undefined)
      throw new Error('Overview requires a Term, quoted Term glob or --file selection.');
    const declared = new Set(files ?? []);
    const seeds = new Set([
      ...(termPatterns.length
        ? (this.space?.select(termPatterns) ?? this.index.select(termPatterns)).map((d) => d.id)
        : []),
      ...(this.space?.select(['*']) ?? this.index.termDeclarations)
        .filter((d) => declared.has(d.file))
        .map((d) => d.id),
    ]);
    const relations = this.relations(includeRemarks, origins).filter(
      (r) => seeds.has(r.source) || seeds.has(r.target),
    );
    const names = new Set([...seeds, ...relations.flatMap((r) => [r.source, r.target])]);
    if (termPatterns.length && names.size > 100)
      throw new Error('Overview exceeds 100 Terms; narrow selectors, --edges or use --file.');
    return { selected: [...seeds].sort(byText), terms: this.terms(seeds), relations };
  }

  /** Union of bounded shortest-first paths per pair, not an inferred flow or a Steiner tree. */
  connect(
    names: readonly string[],
    origins?: readonly RelationOrigin[],
    includeRemarks = true,
    limit = 5,
  ): IConceptMap {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error('Connect limit must be a positive integer.');
    const seeds = [...new Set(names.map((name) => this.index.resolve(name)))];
    if (seeds.length < 2 || seeds.length > 10)
      throw new Error('Connect requires two to ten distinct exact Terms.');
    seeds.forEach((name) => this.index.get(name));
    seeds.forEach((name) => this.space?.require(name));
    const relations = this.relations(includeRemarks, origins);
    const adjacency = new Map<string, { name: string; relation: IConceptRelation }[]>();
    for (const relation of relations) {
      if (relation.source === relation.target) continue;
      for (const [source, target] of [
        [relation.source, relation.target],
        [relation.target, relation.source],
      ] as const)
        adjacency.set(source, [...(adjacency.get(source) ?? []), { name: target, relation }]);
    }
    const selected = new Set<IConceptRelation>();
    const finder = new ConceptPaths(
      new Map(
        [...adjacency].map(([name, edges]) => [name, [...new Set(edges.map((e) => e.name))]]),
      ),
    );
    const paths: string[][] = [],
      disconnected: string[][] = [];
    for (let i = 0; i < seeds.length; i++) {
      const source = seeds[i]!;
      for (const target of seeds.slice(i + 1)) {
        const found = finder.find(source, target, limit);
        if (!found.length) {
          disconnected.push([source, target]);
          continue;
        }
        for (const path of found)
          for (let j = 1; j < path.length; j++)
            selected.add(adjacency.get(path[j - 1]!)!.find((e) => e.name === path[j])!.relation);
        paths.push(...found);
      }
    }
    return {
      selected: seeds,
      terms: this.terms(new Set([...seeds, ...paths.flat()])),
      relations: relations.filter((r) => selected.has(r)),
      paths,
      disconnected,
    };
  }

  private terms(names: ReadonlySet<string>): IConceptMap['terms'] {
    return [...names].sort(byText).map((name) => ({
      name: this.index.get(name)[0]!.name,
      id: name,
      knowledge: this.index.get(name)[0]!.knowledge,
      termDeclarations: this.index
        .get(name)
        .filter((d) => !this.space || this.space.termDeclaration(d))
        .map((d) => ({
          termKind: d.termKind,
          ...(d.group ? { group: d.group } : {}),
          viewpoint: d.viewpoint,
          definition: d.sections.find((s) => s.key === 'definition')?.content ?? '',
          file: d.file,
          line: d.line,
        })),
    }));
  }

  private key(r: IConceptRelation): string {
    return [r.source, r.phrase, r.target].join('\t');
  }
}
