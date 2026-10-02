import { AtermError } from '../error.js';
import { byText } from '../order.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';
import type { ITextFile } from '../file-module/index.js';
import type { IParsedFile, ITermDeclaration } from '../syntax-module/index.js';
import { termDeclarationIdentity, termKindIdentity } from '../syntax-module/term-kind.js';
import { TermDeclarationIndex } from '../query-module/registry.js';

/** The evolving candidate and its immutable source snapshot for one locked operation. */
export class DeclarationDraft {
  readonly documents: readonly ITrmFile[];
  readonly parsed: Map<string, IParsedFile>;
  readonly texts: Map<string, string>;
  readonly initialIndex: TermDeclarationIndex;
  private readonly baseline: Set<string>;
  private readonly changed = new Map<string, ITextFile>();
  readonly terms = new Set<string>();
  readonly deletedTerms = new Set<string>();

  constructor(
    trmFiles: readonly ITrmFile[],
    private readonly policy: {
      readonly rejectUnresolved: boolean;
      readonly rejectDeletedReferences: boolean;
    },
  ) {
    this.documents = trmFiles.filter((d) => d.parsed !== undefined);
    this.parsed = new Map<string, IParsedFile>(
      this.documents.map((d) => [
        d.absolutePath,
        {
          ...d.parsed!,
          file: d.absolutePath,
          termKinds: d.parsed!.termKinds,
          relations: d.parsed!.relations?.map((r) => ({ ...r, file: d.absolutePath })),
          termDeclarations: d.parsed!.termDeclarations.map((value) => ({
            ...value,
            file: d.absolutePath,
            references: value.references.map((ref) => ({ ...ref, file: d.absolutePath })),
          })),
          diagnostics: d.parsed!.diagnostics.map((issue) => ({ ...issue, file: d.absolutePath })),
        },
      ]),
    );
    this.texts = new Map(this.documents.map((d) => [d.absolutePath, d.text]));
    this.initialIndex = new TermDeclarationIndex([...this.parsed.values()]);
    const forbidden = this.initialIndex.diagnostics.find(
      (d) => this.policy.rejectUnresolved || !d.message.startsWith('Unresolved '),
    );
    if (forbidden) throw new AtermError('aterm.duplicate', forbidden.message);
    this.baseline = new Set(this.initialIndex.diagnostics.map((d) => `${d.file}:${d.message}`));
  }
  stage(doc: ITextFile, text: string, parsed?: IParsedFile): void {
    if (parsed) this.parsed.set(doc.absolutePath, parsed);
    this.texts.set(doc.absolutePath, text);
    this.changed.set(doc.absolutePath, doc);
  }
  validate() {
    const finalIndex = new TermDeclarationIndex([...this.parsed.values()]);
    const remainingIds = new Set(finalIndex.termDeclarations.map((d) => d.id));
    const removedIds = new Set([...this.deletedTerms].filter((id) => !remainingIds.has(id)));
    if (this.policy.rejectDeletedReferences) {
      const dangling = finalIndex.termDeclarations.flatMap((d) =>
        d.references
          .filter((ref) => removedIds.has(ref.id))
          .map((ref) => `${d.id} still references deleted Term ${ref.id}.`),
      );
      if (dangling.length) throw new AtermError('aterm.invalid', [...new Set(dangling)].join('\n'));
    }
    const issues = finalIndex.diagnostics.filter(
      (d) => !this.baseline.has(`${d.file}:${d.message}`),
    );
    const errors = issues.filter(
      (d) => this.policy.rejectUnresolved || !d.message.startsWith('Unresolved '),
    );
    if (errors.length)
      throw new AtermError('aterm.invalid', errors.map((d) => d.message).join('\n'));
    return issues;
  }
  changes(): ITextFile[] {
    return [...this.changed.values()]
      .filter((doc) => this.texts.get(doc.absolutePath) !== doc.text)
      .sort((a, b) => byText(a.path, b.path));
  }
  changedTerms(renames: ReadonlyMap<string, string>, includeAdded: boolean): string[] {
    const candidateTermDeclarations = [...this.parsed.values()].flatMap(
      (file) => file.termDeclarations,
    );
    const candidateByIdentity = new Map(
      candidateTermDeclarations.map((termDeclaration) => [
        termDeclarationIdentity(termDeclaration),
        termDeclaration,
      ]),
    );
    const signature = (termDeclaration: ITermDeclaration) =>
      JSON.stringify({
        termKind: termKindIdentity(termDeclaration.termKind, termDeclaration.viewpoint),
        group: termDeclaration.group,
        sections: termDeclaration.sections.map(({ key, filetype, content }) => ({
          key,
          filetype,
          content,
        })),
      });
    const changedTerms = this.initialIndex.termDeclarations
      .filter((termDeclaration) => {
        const id = renames.get(termDeclaration.id) ?? termDeclaration.id;
        const candidate = candidateByIdentity.get(
          termDeclarationIdentity({ ...termDeclaration, id }),
        );
        return (
          id !== termDeclaration.id ||
          !candidate ||
          signature(candidate) !== signature(termDeclaration)
        );
      })
      .map((termDeclaration) => termDeclaration.id);
    if (includeAdded) {
      const originalIds = new Set(this.initialIndex.termDeclarations.map((d) => d.id));
      changedTerms.push(
        ...candidateTermDeclarations.filter((d) => !originalIds.has(d.id)).map((d) => d.id),
      );
    }
    return changedTerms;
  }
}
