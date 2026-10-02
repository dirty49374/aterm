import { DerivationIndex } from './derivation.js';
import { SectionContext } from './section-context.js';
import { termIdentity, termKnowledge } from '../syntax-module/identity.js';
import type {
  IAtermRelation,
  ITermDeclaration,
  IDiagnostic,
  IParsedFile,
} from '../syntax-module/index.js';
import { byText } from '../order.js';
import { termKindIdentity } from '../syntax-module/term-kind.js';
import { GlobPattern } from './pattern.js';
import { TextMatching } from '../matching.js';

export interface ISearchMatch<T = ITermDeclaration> {
  readonly termDeclaration: T;
  readonly section: string;
  readonly text: string;
}

export interface ITermCandidate {
  readonly id: string;
  readonly name: string;
  readonly knowledge: string;
  readonly termDeclarations: readonly { termKind: string; file: string; line: number }[];
}
export class AmbiguousTermError extends Error {
  constructor(readonly candidates: readonly ITermCandidate[]) {
    super(
      'Ambiguous Term; select a qualified Term, --knowledge <id>, or --case-sensitive:\n' +
        candidates
          .map(
            (c) =>
              `${c.id} (${c.termDeclarations.map((e) => `${e.termKind} ${e.file}:${e.line}`).join(', ')})`,
          )
          .join('\n'),
    );
  }
}

/** One exact symbol table for all selected files; declaration order has no meaning. */
export class TermDeclarationIndex {
  readonly termDeclarations: readonly ITermDeclaration[];
  readonly diagnostics: readonly IDiagnostic[];
  readonly relations: readonly IAtermRelation[];
  readonly knowledges = new Map<string, string>();
  private readonly names = new Map<string, ITermDeclaration[]>();

  constructor(files: readonly IParsedFile[]) {
    this.relations = files.flatMap((file) => file.relations ?? []);
    this.termDeclarations = files
      .flatMap((file) => file.termDeclarations)
      .sort(
        (a, b) =>
          byText(a.id, b.id) ||
          byText(
            termKindIdentity(a.termKind, a.viewpoint),
            termKindIdentity(b.termKind, b.viewpoint),
          ),
      );
    const diagnostics = files.flatMap((file) => file.diagnostics);
    for (const file of files) {
      if (!file.knowledge) continue;
      const path = file.file ?? file.termDeclarations[0]?.file ?? '';
      const previous = this.knowledges.get(file.knowledge);
      if (previous !== undefined)
        diagnostics.push({
          file: path,
          line: file.knowledgeLine ?? 1,
          message: `Duplicate Knowledge ${file.knowledge}; first declared at ${previous}.`,
        });
      else this.knowledges.set(file.knowledge, path);
    }
    for (const definition of this.termDeclarations) {
      const group = this.names.get(definition.id) ?? [];
      const previous = group[0];
      if (previous)
        diagnostics.push({
          file: definition.file,
          line: definition.line,
          message: `Duplicate Term ${definition.id}: ${termKindIdentity(previous.termKind, previous.viewpoint)} at ${previous.file}:${previous.line} and ${termKindIdentity(definition.termKind, definition.viewpoint)} at ${definition.file}:${definition.line}. Each Term must have exactly one Term Declaration in its Knowledge; resolve both declarations before continuing.`,
        });
      group.push(definition);
      this.names.set(definition.id, group);
    }
    for (const definition of this.termDeclarations) {
      // Parser validation makes each declaration row exactly one Target. Read imports from
      // this Term Declaration directly so declarations stay local and indexing stays linear.
      const declared = new Set(
        definition.references
          .filter((reference) => reference.section === 'relations')
          .map((reference) => reference.id),
      );
      for (const reference of definition.references) {
        if (
          reference.id !== definition.id &&
          reference.section !== 'relations' &&
          !declared.has(reference.id)
        )
          diagnostics.push({
            ...reference,
            message: `Undeclared reference ${reference.id} in ${definition.termKind} ${definition.id}; declare its target in this Term Declaration's .relations.`,
          });
        if (!this.names.has(reference.id))
          diagnostics.push({
            ...reference,
            message: `Unresolved reference ${reference.id} in ${definition.id}.`,
          });
      }
    }
    for (const relation of this.relations)
      for (const name of new Set([relation.source, relation.target]))
        if (!this.names.has(name))
          diagnostics.push({
            file: relation.file,
            line: relation.line,
            message: `Unresolved Relation endpoint ${name}.`,
          });
    diagnostics.push(...new DerivationIndex(this.relations).diagnostics());
    diagnostics.push(...new SectionContext(this.termDeclarations).diagnostics());
    this.diagnostics = diagnostics;
  }

  get(name: string): readonly ITermDeclaration[] {
    return this.names.get(this.resolve(name))!;
  }

  list(termPatterns: readonly string[] = ['*']): readonly ITermDeclaration[] {
    return this.select(termPatterns);
  }

  requireKnowledge(knowledge?: string, caseSensitive = true): string | undefined {
    if (knowledge === undefined) return undefined;
    if (caseSensitive && this.knowledges.has(knowledge)) return knowledge;
    const matching = new TextMatching(caseSensitive);
    const found = [...this.knowledges.keys()].find((id) => matching.equals(id, knowledge));
    if (found === undefined) throw new Error(`Unknown Knowledge ${knowledge}.`);
    return found;
  }

  resolve(name: string, knowledge?: string, caseSensitive = true): string {
    knowledge = this.requireKnowledge(knowledge, caseSensitive);
    const matching = new TextMatching(caseSensitive);
    const qualified = termKnowledge(name);
    if (qualified) {
      if (knowledge && !matching.equals(qualified, knowledge))
        throw new Error(`Term ${name} conflicts with --knowledge ${knowledge}.`);
      if (caseSensitive && this.names.has(name)) return name;
    }
    {
      const matches = [...this.names.values()].filter(
        (group) =>
          matching.equals(qualified ? group[0]!.id : group[0]!.name, name) &&
          (!knowledge || group[0]!.knowledge === knowledge),
      );
      if (matches.length === 1) return matches[0]![0]!.id;
      if (matches.length > 1)
        throw new AmbiguousTermError(
          matches.map((group) => ({
            id: group[0]!.id,
            name: group[0]!.name,
            knowledge: group[0]!.knowledge,
            termDeclarations: group.map(({ termKind, file, line }) => ({ termKind, file, line })),
          })),
        );
    }
    throw new Error(
      `Unknown Term Declaration ${knowledge ? termIdentity(name, knowledge) : name}. Use aterm term list '*fragment*' to find its exact name.`,
    );
  }

  /** Resolve identity before presentation filters, collecting all ambiguous selectors. */
  selectors(patterns: readonly string[], knowledge?: string, caseSensitive = true): string[] {
    knowledge = this.requireKnowledge(knowledge, caseSensitive);
    const matching = new TextMatching(caseSensitive);
    const candidates = new Map<string, ITermCandidate>();
    const result = patterns.flatMap((pattern) => {
      const glob = new GlobPattern(pattern, caseSensitive);
      if (glob.isGlob) {
        const qualifier = termKnowledge(pattern);
        if (
          knowledge &&
          qualifier &&
          !new GlobPattern(qualifier).isGlob &&
          !matching.equals(qualifier, knowledge)
        )
          throw new Error(`Term pattern ${pattern} conflicts with --knowledge ${knowledge}.`);
        return [pattern];
      }
      try {
        return [this.resolve(pattern, knowledge, caseSensitive)];
      } catch (error) {
        if (!(error instanceof AmbiguousTermError)) throw error;
        for (const candidate of error.candidates) candidates.set(candidate.id, candidate);
        return [];
      }
    });
    if (candidates.size) throw new AmbiguousTermError([...candidates.values()]);
    return result;
  }

  select(
    termPatterns: readonly string[],
    knowledge?: string,
    caseSensitive = true,
  ): readonly ITermDeclaration[] {
    knowledge = this.requireKnowledge(knowledge, caseSensitive);
    const selectors = this.selectors(termPatterns, knowledge, caseSensitive).map(
      (p) => new GlobPattern(p, caseSensitive),
    );
    return this.termDeclarations.filter(
      (d) =>
        (!knowledge || d.knowledge === knowledge) &&
        selectors.some((p) => p.matches(p.text.includes(':') ? d.id : d.name)),
    );
  }

  search(
    text: string,
    includeRemarks = true,
    termPatterns: readonly string[] = ['*'],
    relations: readonly IAtermRelation[] = this.relations,
    knowledge?: string,
    caseSensitive = false,
  ): readonly ISearchMatch[] {
    const needle = new TextMatching(caseSensitive).literal(text);
    const matches: ISearchMatch[] = [];
    for (const definition of this.select(termPatterns, knowledge, caseSensitive)) {
      const sections: [ISearchMatch['section'], string][] = [
        ['name', definition.name],
        ['id', definition.id],
        ...definition.sections
          .filter((section) => includeRemarks || section.key !== 'remarks')
          .map((section): [string, string] => [section.key, section.content]),
        ...relations
          .filter((r) => r.source === definition.id || r.target === definition.id)
          .map((r): [string, string] => ['relation', `${r.source} ${r.phrase} ${r.target}`]),
      ];
      for (const [section, content] of sections) {
        const line = content.split('\n').find((line) => needle.test(line));
        if (line !== undefined) {
          matches.push({ termDeclaration: definition, section, text: line.trim() });
          break;
        }
      }
    }
    return matches;
  }
}
