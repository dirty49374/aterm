import { SectionContext } from './section-context.js';
import type { TermDeclarationIndex } from './registry.js';
import { byText } from '../order.js';
import type { AtermSearchSpace } from './search-space.js';
import type { ITermDeclaration, IReferenceEdge, ISourceLocation } from '../syntax-module/index.js';

/** Navigation graph, not an execution DAG or an inheritance graph. */
export class TermDeclarationGraph {
  private static readonly prepared = new WeakMap<TermDeclarationIndex, TermDeclarationGraph>();
  private readonly forward = new Map<string, IReferenceEdge[]>();
  private readonly reverse = new Map<string, IReferenceEdge[]>();

  constructor(
    private readonly index: TermDeclarationIndex,
    private readonly space?: AtermSearchSpace,
  ) {
    const prepared = TermDeclarationGraph.prepared.get(index);
    if (prepared) {
      for (const [name, edges] of prepared.forward) {
        const visible = space
          ? edges
              .map((edge) => ({ ...edge, locations: space.locations(edge.locations) }))
              .filter(
                (edge) =>
                  edge.locations.length &&
                  space.relation({
                    ...edge,
                    phrase: edge.origin === 'explicit' ? 'references' : edge.phrase!,
                  }),
              )
          : edges;
        this.forward.set(name, visible);
        for (const edge of visible)
          this.reverse.set(edge.target, [...(this.reverse.get(edge.target) ?? []), edge]);
      }
      return;
    }
    const edges = new Map<string, IReferenceEdge & { locations: ISourceLocation[] }>();
    const add = (edge: Omit<IReferenceEdge, 'locations'>, location: ISourceLocation) => {
      if (
        space &&
        !space.relation({
          ...edge,
          phrase: edge.origin === 'explicit' ? 'references' : edge.phrase!,
        })
      )
        return;
      if (space && !space.locations([location]).length) return;
      const key = JSON.stringify([
        edge.source,
        edge.target,
        edge.origin,
        edge.section,
        edge.targetSection,
        edge.phrase,
      ]);
      const existing = edges.get(key);
      if (existing)
        edges.set(key, {
          ...existing,
          ...(edge.required ? { required: true } : {}),
          locations: [...existing.locations, location],
        });
      else edges.set(key, { ...edge, locations: [location] });
    };
    const assertionLines = new Set(index.relations.map((r) => JSON.stringify([r.file, r.line])));
    for (const definition of index.termDeclarations) {
      for (const reference of definition.references) {
        if (
          reference.id === definition.id ||
          assertionLines.has(JSON.stringify([reference.file, reference.line]))
        )
          continue;
        add(
          {
            source: definition.id,
            target: reference.id,
            origin: 'explicit',
            type: 'reference',
            structural: false,
            section: reference.section,
            ...(reference.targetSection ? { targetSection: reference.targetSection } : {}),
            ...(reference.required ? { required: true } : {}),
          },
          reference,
        );
      }
    }
    for (const relation of index.relations)
      add(
        {
          source: relation.source,
          target: relation.target,
          origin: 'relation',
          phrase: relation.phrase,
          type: relation.type,
          structural: relation.structural,
          ...(relation.required ? { required: true } : {}),
        },
        { file: relation.file, line: relation.line },
      );
    // Edges leave a source in the order they first occur in its Term Declaration, so that a reader
    // pulling required context in follows the text: a table of contents reads as written.
    const first = (edge: { locations: ISourceLocation[] }) => edge.locations[0]!;
    const ordered = [...edges.values()].sort(
      (a, b) =>
        byText(a.source, b.source) ||
        byText(first(a).file, first(b).file) ||
        first(a).line - first(b).line ||
        ((first(a) as { column?: number }).column ?? 0) -
          ((first(b) as { column?: number }).column ?? 0) ||
        byText(a.target, b.target),
    );
    for (const edge of ordered) {
      edge.locations.forEach((location) => Object.freeze(location));
      Object.freeze(edge.locations);
      Object.freeze(edge);
      this.forward.set(edge.source, [...(this.forward.get(edge.source) ?? []), edge]);
      this.reverse.set(edge.target, [...(this.reverse.get(edge.target) ?? []), edge]);
    }
    if (!space) TermDeclarationGraph.prepared.set(index, this);
  }

  outgoing(name: string, includeRemarks = true): readonly IReferenceEdge[] {
    name = this.index.resolve(name);
    return (this.forward.get(name) ?? []).filter(
      (edge) => includeRemarks || edge.section !== 'remarks',
    );
  }

  incoming(name: string, includeRemarks = true): readonly IReferenceEdge[] {
    name = this.index.resolve(name);
    return (this.reverse.get(name) ?? []).filter(
      (edge) => includeRemarks || edge.section !== 'remarks',
    );
  }

  /** The single Term Declaration and its Term expose the same owned occurrences. */
  outgoingTermDeclaration(
    termDeclaration: ITermDeclaration,
    includeRemarks = true,
  ): readonly IReferenceEdge[] {
    return this.outgoing(termDeclaration.id, includeRemarks).flatMap((edge) => {
      const locations = edge.locations.filter(
        (location) =>
          location.file === termDeclaration.file &&
          location.line >= termDeclaration.line &&
          location.line <= termDeclaration.endLine,
      );
      if (!locations.length) return [];
      const required =
        edge.origin === 'relation'
          ? this.index.relations.some(
              (relation) =>
                relation.required &&
                locations.some(
                  (location) => relation.file === location.file && relation.line === location.line,
                ),
            )
          : termDeclaration.references.some(
              (reference) =>
                reference.required &&
                reference.id === edge.target &&
                reference.section === edge.section &&
                reference.targetSection === edge.targetSection,
            );
      const { required: _required, ...rest } = edge;
      return [{ ...rest, locations, ...(required ? { required: true as const } : {}) }];
    });
  }

  /** Selected declarations first, then required context in breadth-first order, once per name. */
  requiredContext(
    seeds: readonly ITermDeclaration[],
    includeRemarks = true,
  ): readonly ITermDeclaration[] {
    const result = [...seeds];
    const visited = new Set(seeds.map((d) => d.id));
    const sections = new SectionContext(this.index.termDeclarations);
    const visitedSections = new Set<string>();
    const queue: { termDeclaration: ITermDeclaration; section?: string }[] = seeds.map(
      (termDeclaration) => ({ termDeclaration }),
    );
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { termDeclaration, section } = queue[cursor]!;
      const references = (
        section === undefined ? this.index.get(termDeclaration.id) : [termDeclaration]
      )
        .flatMap((source) => source.references)
        .filter(
          (ref) =>
            (section === undefined || ref.section === section) &&
            (includeRemarks || ref.section !== 'remarks'),
        )
        .sort(
          (a, b) => byText(a.file, b.file) || a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
        );
      for (const ref of references) {
        if (!ref.required) continue;
        if (ref.targetSection) {
          if (!includeRemarks && ref.targetSection === 'remarks') continue;
          const target = sections.target(ref);
          const key = `${target.id}.${ref.targetSection}`;
          if (visitedSections.has(key)) continue;
          visitedSections.add(key);
          queue.push({ termDeclaration: target, section: ref.targetSection });
        } else if (!visited.has(ref.id)) {
          visited.add(ref.id);
          const targets = this.index.get(ref.id);
          result.push(...targets);
          queue.push(...targets.map((termDeclaration) => ({ termDeclaration })));
        }
      }
    }
    return result;
  }

  /** First ten simple paths in BFS order; parallel edge kinds share a symbol sequence. */
  paths(termDeclaration: string, target: string, includeRemarks = true): string[][] {
    try {
      termDeclaration = this.index.resolve(termDeclaration);
      target = this.index.resolve(target);
    } catch (error) {
      if (String(error).includes('Unknown Term Declaration')) return [];
      throw error;
    }
    const names = new Set(this.index.termDeclarations.map((d) => d.id));
    if (!names.has(termDeclaration) || !names.has(target)) return [];
    const ancestors = new Set<string>();
    const pending = [target];
    while (pending.length) {
      const name = pending.pop()!;
      if (ancestors.has(name)) continue;
      ancestors.add(name);
      pending.push(...this.incoming(name, includeRemarks).map((edge) => edge.source));
    }
    const result: string[][] = [];
    const queue: string[][] = ancestors.has(termDeclaration) ? [[termDeclaration]] : [];
    for (let cursor = 0; cursor < queue.length && result.length < 10; cursor++) {
      const path = queue[cursor]!;
      const last = path.at(-1)!;
      if (last === target) {
        result.push(path);
        continue;
      }
      for (const next of new Set(this.outgoing(last, includeRemarks).map((edge) => edge.target)))
        if (ancestors.has(next) && !path.includes(next)) queue.push([...path, next]);
    }
    return result;
  }

  unreferenced(includeRemarks = true): readonly ITermDeclaration[] {
    return this.index.termDeclarations.filter(
      (definition) =>
        (!this.space || this.space.termDeclaration(definition)) &&
        !this.incoming(definition.id, includeRemarks).some((edge) => edge.source !== definition.id),
    );
  }

  unreachableFrom(
    termPatterns: readonly string[],
    includeRemarks = true,
  ): readonly ITermDeclaration[] {
    const pending = (this.space?.select(termPatterns) ?? this.index.select(termPatterns)).map(
      (definition) => definition.id,
    );
    if (!pending.length) throw new Error('No root Terms match: ' + termPatterns.join(', '));
    const reached = new Set<string>();
    while (pending.length) {
      const name = pending.pop()!;
      if (reached.has(name)) continue;
      reached.add(name);
      for (const edge of this.outgoing(name, includeRemarks)) pending.push(edge.target);
    }
    return this.index.termDeclarations.filter(
      (definition) =>
        !reached.has(definition.id) && (!this.space || this.space.termDeclaration(definition)),
    );
  }
}
