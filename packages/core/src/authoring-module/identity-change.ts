import { AtermError } from '../error.js';
import {
  knowledgePattern,
  localTermPattern,
  referencePattern,
  localTerm,
  termKnowledge,
  termIdentity,
} from '../syntax-module/identity.js';
import { AtermParser, type IParsedFile } from '../syntax-module/index.js';
import { termKindPattern, termKindIdentity, resolveTermKind } from '../syntax-module/term-kind.js';
import { sameTermKind } from '../home-module/config.js';
import { TermDeclarationIndex } from '../query-module/registry.js';
import { GlobPattern } from '../query-module/pattern.js';
import type { ITextFile } from '../file-module/index.js';
import type { IAtermRenameInput, IAtermMoveInput } from './editor.js';
import { DeclarationDraft } from './declaration-draft.js';

const termName = new RegExp(`^${referencePattern}$`);

export type IdentityChangeAction =
  | { type: 'rename' | 'rename-knowledge'; input: IAtermRenameInput }
  | { type: 'move'; input: IAtermMoveInput };

/** Maps identities and rewrites their declarations and references in a corpus candidate. */
export class IdentityChange {
  constructor(
    private readonly draft: DeclarationDraft,
    private readonly guard: (doc: ITextFile) => Promise<void>,
  ) {}
  mappingFor(action: IdentityChangeAction): Map<string, string> {
    const { initialIndex, parsed } = this.draft;
    switch (action.type) {
      case 'rename':
        return this.mapping(initialIndex, action.input);
      case 'rename-knowledge':
        return this.knowledgeMapping(initialIndex, action.input);
      case 'move':
        return this.moveMapping([...parsed.values()], initialIndex, action.input);
    }
  }
  async stage(action: IdentityChangeAction, renames: ReadonlyMap<string, string>): Promise<void> {
    const rename = action.type !== 'move' ? action.input : undefined;
    const renameKnowledge = action.type === 'rename-knowledge';
    const move = action.type === 'move' ? action.input : undefined;
    const { documents: termDeclarations, parsed, terms, initialIndex } = this.draft;
    const planned = this.renamePatches([...parsed.values()], renames);
    const movedBlocks: string[][] = [];
    const staged = new Map<string, string[]>();
    for (const doc of termDeclarations) {
      const bom = doc.text.startsWith('\uFEFF') ? '\uFEFF' : '';
      const lines = doc.text.slice(bom.length).split(/\r?\n/);
      for (const patch of planned
        .filter((p) => p.file === doc.absolutePath)
        .sort((a, b) => b.line - a.line)) {
        lines.splice(patch.line - 1, patch.hunks[0]!.before.length, ...patch.hunks[0]!.after);
        terms.add(patch.id);
      }
      if (renameKnowledge && doc.parsed!.knowledge === rename!.from) {
        lines[doc.parsed!.knowledgeLine! - 1] = lines[doc.parsed!.knowledgeLine! - 1]!.replace(
          /^(@knowledge[ \t]+)\S+/,
          (_match, prefix: string) => prefix + rename!.to,
        );
        terms.add(rename!.to);
      }
      if (move)
        movedBlocks.push(
          ...this.extractMovedBlocks(
            doc,
            lines,
            renames,
            [...parsed.values()].find((file) => file.knowledge === move.to)!,
          ),
        );
      staged.set(doc.absolutePath, lines);
    }
    if (move) {
      const path = initialIndex.knowledges.get(move.to)!;
      const lines = staged.get(path)!;
      if (lines.at(-1) !== '') lines.push('');
      for (const block of movedBlocks) lines.push('', ...block, '');
    }
    await this.stageDocuments(staged);
  }
  private extractMovedBlocks(
    doc: DeclarationDraft['documents'][number],
    lines: string[],
    renames: ReadonlyMap<string, string>,
    destination: IParsedFile,
  ): string[][] {
    const movedBlocks: string[][] = [];
    const selected = doc.parsed!.termDeclarations.filter((termDeclaration) =>
      renames.has(termDeclaration.id),
    );
    for (const termDeclaration of selected) {
      const block = lines.slice(termDeclaration.line - 1, termDeclaration.endLine);
      // A short name can become ambiguous in the destination vocabulary.
      if (
        !termDeclaration.termKind.includes('.') &&
        destination.termKinds!.filter((termKind) => termKind.name === termDeclaration.termKind)
          .length > 1
      )
        block[0] = block[0]!.replace(
          new RegExp(`^${termKindPattern}`),
          termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint),
        );
      movedBlocks.push(block);
      this.draft.terms.add(renames.get(termDeclaration.id)!);
    }
    for (const termDeclaration of [...selected].reverse())
      lines.splice(termDeclaration.line - 1, termDeclaration.endLine - termDeclaration.line + 1);
    return movedBlocks;
  }
  private async stageDocuments(staged: ReadonlyMap<string, string[]>): Promise<void> {
    for (const doc of this.draft.documents) {
      const eol = doc.text.includes('\r\n') ? '\r\n' : '\n';
      const bom = doc.text.startsWith('\uFEFF') ? '\uFEFF' : '';
      const lines = staged.get(doc.absolutePath)!;
      const next = bom + lines.join(eol);
      if (next === doc.text) continue;
      await this.guard(doc);
      this.draft.stage(
        doc,
        next,
        new AtermParser(doc.parsed!.termKinds).parse(doc.absolutePath, next),
      );
    }
  }
  private moveMapping(
    files: readonly IParsedFile[],
    index: TermDeclarationIndex,
    input: IAtermMoveInput,
  ): Map<string, string> {
    index.requireKnowledge(input.to);
    if (!input.termPatterns.length)
      throw new AtermError('aterm.move', 'Move requires at least one Term selector.');
    const selected = index.select(input.termPatterns, input.knowledge);
    if (!selected.length) throw new AtermError('aterm.move', 'No Terms match the move selection.');
    const destination = files.find((file) => file.knowledge === input.to)!;
    const names = new Set<string>();
    const mapping = new Map<string, string>();
    for (const termDeclaration of selected) {
      if (termDeclaration.knowledge === input.to)
        throw new AtermError(
          'aterm.move',
          `${termDeclaration.id} already belongs to Knowledge ${input.to}.`,
        );
      const id = termIdentity(termDeclaration.name, input.to);
      if (
        index.termDeclarations.some((existing) => existing.id === id) ||
        (names.has(id) && !mapping.has(termDeclaration.id))
      )
        throw new AtermError('aterm.move', `Move would merge distinct Terms at ${id}.`);
      const identity = termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint);
      const sourceTermKind = resolveTermKind(
        files.find((file) => file.knowledge === termDeclaration.knowledge)!.termKinds!,
        identity,
      );
      const targetTermKind = destination.termKinds?.find(
        (termKind) => termKindIdentity(termKind.name, termKind.viewpoint) === identity,
      );
      if (!targetTermKind || !sameTermKind(sourceTermKind, targetTermKind))
        throw new AtermError(
          'aterm.move',
          `Destination Knowledge ${input.to} has no compatible Term Kind ${identity} for ${termDeclaration.id}; align its Viewpoints before moving.`,
        );
      names.add(id);
      mapping.set(termDeclaration.id, id);
    }
    return mapping;
  }
  private knowledgeMapping(
    index: TermDeclarationIndex,
    input: IAtermRenameInput,
  ): Map<string, string> {
    index.requireKnowledge(input.from);
    if (!new RegExp(`^${knowledgePattern}$`).test(input.to))
      throw new AtermError('aterm.knowledge', 'Invalid Knowledge ID ' + input.to);
    if (input.from !== input.to && index.knowledges.has(input.to))
      throw new AtermError('aterm.knowledge', 'Duplicate Knowledge ' + input.to);
    return new Map(
      index.termDeclarations
        .filter((d) => d.knowledge === input.from)
        .map((d) => [d.id, termIdentity(d.name, input.to)]),
    );
  }
  private mapping(index: TermDeclarationIndex, input: IAtermRenameInput): Map<string, string> {
    const duplicate = index.diagnostics.find((d) => d.message.startsWith('Duplicate'));
    if (duplicate) throw new AtermError('aterm.duplicate', 'DUPLICATE ENTRY: ' + duplicate.message);
    const matches = index.select([input.from], input.knowledge);
    if (!matches.length) throw new AtermError('aterm.rename', 'No Terms match ' + input.from);
    const wildcard = new GlobPattern(input.from).isGlob;
    const parts = input.from.split('*');
    if (
      wildcard &&
      (parts.length !== 2 || /[?\[{}()]/.test(input.from) || input.to.split('*').length !== 2)
    )
      throw new AtermError(
        'aterm.rename',
        'Pattern rename requires one * capture in both from and to.',
      );
    const result = new Map(
      matches.map((d) => {
        const source = input.from.includes(':') ? d.id : d.name;
        const target = wildcard
          ? input.to.replace('*', source.slice(parts[0]!.length, source.length - parts[1]!.length))
          : input.to;
        if (!termName.test(target))
          throw new AtermError('aterm.rename', 'Invalid destination Term ' + target);
        if (termKnowledge(target) && termKnowledge(target) !== d.knowledge)
          throw new AtermError(
            'aterm.rename',
            'Term rename cannot move between Knowledges; use aterm term move for a Term or aterm knowledge rename for Knowledge identity.',
          );
        return [d.id, termIdentity(target, d.knowledge)];
      }),
    );
    const finalNames = [...new Set(index.termDeclarations.map((d) => d.id))].map(
      (name) => result.get(name) ?? name,
    );
    if (
      new Set(finalNames).size !== finalNames.length ||
      [...result.values()].some((n) => !termName.test(n))
    )
      throw new AtermError('aterm.rename', 'Rename would create an invalid or duplicate Term.');
    return result;
  }
  private renamePatches(files: readonly IParsedFile[], names: ReadonlyMap<string, string>) {
    return files.flatMap((file) =>
      file.termDeclarations.flatMap((d) => {
        const old = d.sourceLines!.map((l) => l.text);
        const next = [...old];
        for (const ref of [...d.references].sort(
          (a, b) => b.line - a.line || (b.column ?? 0) - (a.column ?? 0),
        )) {
          const renamed = names.get(ref.id) ?? ref.id;
          const owner = termKnowledge(names.get(d.id) ?? d.id);
          const value =
            ref.name.includes(':') || termKnowledge(renamed) !== owner
              ? renamed
              : localTerm(renamed);
          if (value === ref.name) continue;
          if (!ref.column)
            throw new AtermError(
              'aterm.rename',
              'Reference positions unavailable; refresh source.',
            );
          const i = ref.line - d.line,
            col = ref.column - 1;
          next[i] = next[i]!.slice(0, col) + value + next[i]!.slice(col + ref.name.length);
        }
        next[0] = next[0]!.replace(
          new RegExp(`^(${termKindPattern}\\s+)(${localTermPattern})`),
          (_match, termKind: string, name: string) => termKind + localTerm(names.get(d.id) ?? name),
        );
        if (old.join('\n') === next.join('\n')) return [];
        return [
          {
            file: d.file,
            line: d.line,
            id: d.id,
            hunks: [{ before: old, after: next, end: true }],
          },
        ];
      }),
    );
  }
}
