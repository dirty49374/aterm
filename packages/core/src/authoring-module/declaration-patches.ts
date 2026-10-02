import { AtermError } from '../error.js';
import { referencePattern, termKnowledge, termIdentity } from '../syntax-module/identity.js';
import { termKindPattern, matchesTermKind } from '../syntax-module/term-kind.js';
import { AtermParser } from '../syntax-module/index.js';
import { TermDeclarationIndex } from '../query-module/registry.js';
import type { ITextFile } from '../file-module/index.js';
import { TermPatch, type ITermPatch } from './patch.js';
import { DeclarationDraft } from './declaration-draft.js';

/** Applies ordered Term patches without saving any source file. */
export class DeclarationPatches {
  constructor(
    private readonly draft: DeclarationDraft,
    private readonly guard: (doc: ITextFile) => Promise<void>,
  ) {}
  async apply(patches: readonly ITermPatch[], knowledgeContext?: string): Promise<void> {
    for (const patch of patches) await this.applyOne(patch, knowledgeContext);
  }
  private async applyOne(patch: ITermPatch, knowledgeContext?: string): Promise<void> {
    const { parsed } = this.draft;
    const selector = patch.target.match(
      new RegExp(
        `^(?:(${termKindPattern})[ \t]+)?(${referencePattern})(?:\\.([A-Za-z][A-Za-z0-9_-]*))?$`,
      ),
    );
    if (!selector)
      throw new AtermError('aterm.selector', 'Use [term-kind ]Term[.section]: ' + patch.target);
    const [, termKind, name, key] = selector;
    if (patch.operation !== 'update' && key)
      throw new AtermError(
        'aterm.selector',
        'Add and Delete Term require a complete-Term selector, not a section.',
      );
    const currentIndex = new TermDeclarationIndex([...parsed.values()]);
    if (patch.operation === 'add')
      await this.add(patch, currentIndex, name!, termKind, knowledgeContext);
    else await this.updateOrDelete(patch, currentIndex, name!, termKind, key, knowledgeContext);
  }
  private async add(
    patch: Extract<ITermPatch, { operation: 'add' }>,
    currentIndex: TermDeclarationIndex,
    name: string,
    termKind: string | undefined,
    knowledgeContext: string | undefined,
  ): Promise<void> {
    const { documents: termDeclarations, parsed, texts, terms } = this.draft;
    const qualified = termKnowledge(name!);
    if (qualified && knowledgeContext && qualified !== knowledgeContext)
      throw new AtermError(
        'aterm.selector',
        `Term ${name} conflicts with --knowledge ${knowledgeContext}.`,
      );
    const knowledge = qualified ?? knowledgeContext;
    if (!knowledge)
      throw new AtermError(
        'aterm.selector',
        'Add Term requires a Knowledge-qualified Term or --knowledge <id>.',
      );
    currentIndex.requireKnowledge(knowledge);
    const id = termIdentity(name!, knowledge);
    if (currentIndex.termDeclarations.some((d) => d.id === id))
      throw new AtermError(
        'aterm.duplicate',
        `Duplicate Term ${id}; use Update Term for an existing declaration.`,
      );
    const path = currentIndex.knowledges.get(knowledge)!;
    const doc = termDeclarations.find((d) => d.absolutePath === path)!;
    await this.guard(doc);
    const original = parsed.get(path)!;
    const fragment = new AtermParser(original.termKinds).parse(
      path,
      `@knowledge ${knowledge}\n@viewpoints ${(original.viewpoints ?? []).join(' ')}\n` +
        patch.lines.join('\n'),
    );
    const added = fragment.termDeclarations[0];
    const first = patch.lines.findIndex((line) => line.trim());
    let last = patch.lines.length - 1;
    while (last >= 0 && !patch.lines[last]!.trim()) last--;
    if (
      fragment.diagnostics.length ||
      fragment.termDeclarations.length !== 1 ||
      !added ||
      added.id !== id ||
      added.line !== first + 3 ||
      added.endLine !== last + 3 ||
      (termKind && !matchesTermKind(termKind, added.termKind, added.viewpoint))
    )
      throw new AtermError(
        'aterm.patch',
        `Add Term ${patch.target} requires exactly one matching complete Term Declaration.\n` +
          fragment.diagnostics.map((d) => d.message).join('\n'),
      );
    const text = texts.get(path)!;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const next = text + (text.endsWith(eol) ? '' : eol) + eol + patch.lines.join(eol) + eol;
    const candidate = new AtermParser(original.termKinds).parse(path, next);
    if (candidate.diagnostics.length)
      throw new AtermError('aterm.patch', candidate.diagnostics.map((d) => d.message).join('\n'));
    this.draft.stage(doc, next, candidate);
    terms.add(id);
  }
  private async updateOrDelete(
    patch: Exclude<ITermPatch, { operation: 'add' }>,
    currentIndex: TermDeclarationIndex,
    name: string,
    termKind: string | undefined,
    key: string | undefined,
    knowledgeContext: string | undefined,
  ): Promise<void> {
    const { documents: termDeclarations, parsed, texts, terms, deletedTerms } = this.draft;
    const id = currentIndex.resolve(name!, knowledgeContext);
    if (patch.operation === 'delete') deletedTerms.add(id);
    const matches = termDeclarations.flatMap((doc) =>
      parsed
        .get(doc.absolutePath)!
        .termDeclarations.flatMap((d, index) =>
          d.id === id && (!termKind || matchesTermKind(termKind, d.termKind, d.viewpoint))
            ? [{ doc, index, def: parsed.get(doc.absolutePath)!.termDeclarations[index]! }]
            : [],
        ),
    );
    if (matches.length !== 1)
      throw new AtermError(
        'aterm.selector',
        matches.length
          ? `Duplicate Term ${id}; each Term must have exactly one Term Declaration.`
          : `Unknown Term or Term Kind ${patch.target}.`,
      );
    const { doc, def, index: definitionIndex } = matches[0]!;
    await this.guard(doc);
    const text = texts.get(doc.absolutePath)!;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const lines = text.slice(bom.length).split(/\r?\n/);
    let start = def.line - 1;
    let end = def.endLine;
    if (key) {
      const index = def.sections.findIndex((s) => s.key === key);
      if (index < 0)
        throw new AtermError(
          'aterm.section',
          `Absent section ${patch.target}; edit the complete Term Declaration to introduce it.`,
        );
      if (def.endLine === def.line)
        throw new AtermError(
          'aterm.section',
          `One-line Term Declaration ${name}; edit it with the complete-Term selector.`,
        );
      start = def.sections[index]!.line;
      end = (def.sections[index + 1]?.line ?? def.endLine) - 1;
    }
    lines.splice(
      start,
      end - start,
      ...(patch.operation === 'delete'
        ? []
        : new TermPatch().apply(lines.slice(start, end), patch)),
    );
    const next = bom + lines.join(eol);
    const candidate = new AtermParser(parsed.get(doc.absolutePath)!.termKinds).parse(
      doc.absolutePath,
      next,
    );
    if (candidate.diagnostics.length)
      throw new AtermError('aterm.patch', candidate.diagnostics.map((d) => d.message).join('\n'));
    if (key) {
      const updated = candidate.termDeclarations[definitionIndex];
      if (
        !updated ||
        updated.termKind !== def.termKind ||
        updated.group !== def.group ||
        updated.fence !== def.fence ||
        JSON.stringify(updated.sections.map((s) => [s.key, s.filetype])) !==
          JSON.stringify(def.sections.map((s) => [s.key, s.filetype]))
      )
        throw new AtermError(
          'aterm.section',
          'A section patch must not change declaration or section delimiters; target the complete Term.',
        );
    }
    const beforeNames = parsed
      .get(doc.absolutePath)!
      .termDeclarations.filter((d) => patch.operation !== 'delete' || d.id !== id)
      .map((d) => d.id);
    if (JSON.stringify(beforeNames) !== JSON.stringify(candidate.termDeclarations.map((d) => d.id)))
      throw new AtermError(
        'aterm.identity',
        'Edit must preserve Term identities and order; use aterm term rename for identity changes.',
      );
    this.draft.stage(doc, next, candidate);
    terms.add(id);
  }
}
