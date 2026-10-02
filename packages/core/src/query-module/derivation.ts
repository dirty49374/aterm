import type { IAtermRelation, IDiagnostic } from '../syntax-module/model.js';
import { byText } from '../order.js';

export interface IDerivedImpact {
  readonly term: string;
  readonly sources: readonly string[];
}

/** Source provenance is a directed acyclic graph, independent of structural grouping. */
export class DerivationIndex {
  private readonly relations: readonly IAtermRelation[];
  constructor(relations: readonly IAtermRelation[]) {
    this.relations = relations.filter((r) => r.phrase === 'derived_from');
  }
  diagnostics(): IDiagnostic[] {
    const outgoing = new Map<string, IAtermRelation[]>();
    for (const r of this.relations) outgoing.set(r.source, [...(outgoing.get(r.source) ?? []), r]);
    const active = new Set<string>(),
      done = new Set<string>(),
      issues: IDiagnostic[] = [];
    const visit = (id: string, path: string[]) => {
      if (done.has(id)) return;
      active.add(id);
      for (const r of outgoing.get(id) ?? []) {
        if (active.has(r.target))
          issues.push({
            file: r.file,
            line: r.line,
            message: `Derivation cycle: ${[...path, id, r.target].join(' -> ')}.`,
          });
        else visit(r.target, [...path, id]);
      }
      active.delete(id);
      done.add(id);
    };
    for (const id of outgoing.keys()) visit(id, []);
    return issues;
  }
  impacts(
    changed: readonly string[],
    mapping: ReadonlyMap<string, string> = new Map(),
  ): IDerivedImpact[] {
    const canonical = (id: string) => mapping.get(id) ?? id;
    const incoming = new Map<string, Set<string>>();
    for (const r of this.relations) {
      const target = canonical(r.target);
      const sources = incoming.get(target) ?? new Set<string>();
      sources.add(canonical(r.source));
      incoming.set(target, sources);
    }
    const impacts = new Map<string, Set<string>>();
    for (const changedId of changed) {
      const source = canonical(changedId),
        seen = new Set([source]),
        queue = [source];
      for (let i = 0; i < queue.length; i++)
        for (const term of incoming.get(queue[i]!) ?? []) {
          if (seen.has(term)) continue;
          seen.add(term);
          queue.push(term);
          const roots = impacts.get(term) ?? new Set<string>();
          roots.add(source);
          impacts.set(term, roots);
        }
    }
    return [...impacts]
      .sort(([a], [b]) => byText(a, b))
      .map(([term, sources]) => ({ term, sources: [...sources].sort(byText) }));
  }
}
