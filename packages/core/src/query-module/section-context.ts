import type { ITermDeclaration, IReference, IDiagnostic } from '../syntax-module/index.js';

/** Resolves section references without choosing a Term Kind or changing Term identity. */
type SectionTermDeclaration = Pick<
  ITermDeclaration,
  'id' | 'termKind' | 'viewpoint' | 'sections' | 'references'
>;

export class SectionContext<T extends SectionTermDeclaration> {
  private readonly terms = new Map<string, T[]>();
  constructor(private readonly termDeclarations: readonly T[]) {
    for (const termDeclaration of termDeclarations)
      this.terms.set(termDeclaration.id, [
        ...(this.terms.get(termDeclaration.id) ?? []),
        termDeclaration,
      ]);
  }

  target(reference: Pick<IReference, 'id' | 'targetSection'>): T {
    const candidates = this.terms.get(reference.id) ?? [];
    const name = `${reference.id}.${reference.targetSection}`;
    if (candidates.length > 1)
      throw new Error(
        `Duplicate Term ${reference.id}; each Term must have exactly one Term Declaration.`,
      );
    if (!candidates[0]?.sections.some((section) => section.key === reference.targetSection))
      throw new Error(`Missing section ${name}.`);
    return candidates[0]!;
  }

  diagnostics(): IDiagnostic[] {
    const diagnostics: IDiagnostic[] = [];
    const targets = new Map<IReference, T>();
    for (const termDeclaration of this.termDeclarations)
      for (const reference of termDeclaration.references.filter((ref) => ref.targetSection)) {
        if (!this.terms.has(reference.id)) continue; // The ordinary reference check owns this error.
        try {
          targets.set(reference, this.target(reference));
        } catch (error) {
          diagnostics.push({
            file: reference.file,
            line: reference.line,
            message: (error as Error).message,
          });
        }
      }
    const done = new Set<string>();
    const visiting: string[] = [];
    const walk = (termDeclaration: T, section: string): void => {
      const key = `${termDeclaration.id}.${section}`;
      if (done.has(key)) return;
      visiting.push(key);
      for (const ref of termDeclaration.references.filter(
        (r) => r.section === section && r.targetSection && r.required,
      )) {
        const target = targets.get(ref);
        if (!target) continue;
        const next = `${target.id}.${ref.targetSection}`;
        const cycle = visiting.indexOf(next);
        if (cycle >= 0)
          diagnostics.push({
            file: ref.file,
            line: ref.line,
            message: `Section expansion cycle: ${[...visiting.slice(cycle), next].join(' -> ')}.`,
          });
        else walk(target, ref.targetSection!);
      }
      visiting.pop();
      done.add(key);
    };
    for (const termDeclaration of this.termDeclarations)
      for (const section of termDeclaration.sections) walk(termDeclaration, section.key);
    return diagnostics;
  }

  /** Include only resources reached by section expansion, recursively through that section. */
  collect(seeds: readonly T[], remarks: boolean): T[] {
    const context = new Map<string, T>();
    const visited = new Set<string>();
    const walk = (termDeclaration: T, section: string): void => {
      const key = `${termDeclaration.id}.${section}`;
      if (visited.has(key) || (!remarks && section === 'remarks')) return;
      visited.add(key);
      for (const ref of termDeclaration.references.filter(
        (r) => r.section === section && r.targetSection && r.required,
      )) {
        if (!remarks && ref.targetSection === 'remarks') continue;
        const target = this.target(ref);
        context.set(`${target.id}`, target);
        walk(target, ref.targetSection!);
      }
    };
    for (const termDeclaration of seeds)
      for (const section of termDeclaration.sections) walk(termDeclaration, section.key);
    return [...context.values()];
  }
}
