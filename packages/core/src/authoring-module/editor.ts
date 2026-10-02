import { DerivationIndex, type IDerivedImpact } from '../query-module/derivation.js';
import { ExternalFiles, ExternalText, type IExternalSelection } from '../external-module/index.js';
import { FileAccess, type ITextFile } from '../file-module/index.js';
import type { IAtermConfig } from '../home-module/index.js';
import type { ITrmFile } from '../corpus-module/trm-file.js';
import { AtermParser } from '../syntax-module/index.js';
import { TermPatch } from './patch.js';
import { RelationFormatter } from './relation-formatter.js';
import { DeclarationDraft } from './declaration-draft.js';
import { DeclarationPatches } from './declaration-patches.js';
import { IdentityChange, type IdentityChangeAction } from './identity-change.js';
import { GuardedSave } from './guarded-save.js';

export interface IAtermFormatInput {
  readonly knowledge?: string;
  readonly termPatterns?: readonly string[];
  readonly dryRun?: boolean;
}
export interface IAtermEditInput {
  readonly knowledge?: string;
  readonly patch: string;
  readonly dryRun?: boolean;
}
export interface IAtermEditResult {
  readonly dryRun: boolean;
  readonly terms: readonly string[];
  readonly files: readonly { path: string; before: string; after: string }[];
  readonly warnings: readonly string[];
  readonly derivedImpacts: readonly IDerivedImpact[];
}
export interface IAtermRenameInput extends IExternalSelection {
  readonly knowledge?: string;
  readonly from: string;
  readonly to: string;
  readonly dryRun?: boolean;
}
export interface IAtermEditSource {
  load(): Promise<readonly ITrmFile[]>;
}
export interface IAtermMoveInput extends IExternalSelection {
  readonly knowledge?: string;
  readonly termPatterns: readonly string[];
  readonly to: string;
  readonly dryRun?: boolean;
}

type AuthoringAction = IdentityChangeAction | { type: 'format'; input: IAtermFormatInput };

/** _aterm:Edit_Term_Declarations_ coordinates one guarded operation under one Home lock. */
export class AtermEditor {
  private readonly files = new FileAccess();
  constructor(
    private readonly config: IAtermConfig,
    private readonly source: IAtermEditSource,
  ) {}
  rename(input: IAtermRenameInput): Promise<IAtermEditResult> {
    return this.apply({ patch: '', dryRun: input.dryRun }, { type: 'rename', input });
  }
  renameKnowledge(input: IAtermRenameInput): Promise<IAtermEditResult> {
    return this.apply({ patch: '', dryRun: input.dryRun }, { type: 'rename-knowledge', input });
  }
  move(input: IAtermMoveInput): Promise<IAtermEditResult> {
    return this.apply({ patch: '', dryRun: input.dryRun }, { type: 'move', input });
  }
  edit(input: IAtermEditInput): Promise<IAtermEditResult> {
    return this.apply(input);
  }
  format(input: IAtermFormatInput): Promise<IAtermEditResult> {
    return this.apply({ patch: '', dryRun: input.dryRun }, { type: 'format', input });
  }
  private async apply(input: IAtermEditInput, action?: AuthoringAction): Promise<IAtermEditResult> {
    const rename =
      action?.type === 'rename' || action?.type === 'rename-knowledge' ? action.input : undefined;
    const move = action?.type === 'move' ? action.input : undefined;
    const patches = action ? [] : new TermPatch().parse(input.patch);
    return this.files.exclusive(this.config.home.home, async () => {
      const draft = new DeclarationDraft(await this.source.load(), {
        rejectUnresolved: !!move,
        rejectDeletedReferences: !action,
      });
      const save = new GuardedSave(this.files, this.config, draft.documents);
      const guard = (doc: ITextFile) => save.guard(doc);
      const identity = new IdentityChange(draft, guard);
      const identityAction = action?.type !== 'format' ? action : undefined;
      const renames = identityAction
        ? identity.mappingFor(identityAction)
        : new Map<string, string>();
      if (identityAction) await identity.stage(identityAction, renames);
      if (action?.type === 'format') await this.stageFormat(draft, save, action.input);
      await new DeclarationPatches(draft, guard).apply(patches, input.knowledge);
      const issues = draft.validate();
      const externalWarnings = await this.stageExternal(draft, rename ?? move, renames);
      const changes = draft.changes();
      await save.preflight(changes);
      const changedTerms = draft.changedTerms(renames, !action);
      if (!input.dryRun) await save.save(changes, draft.texts);
      return {
        dryRun: input.dryRun ?? false,
        terms: [...draft.terms],
        files: changes.map((d) => ({
          path: d.path,
          before: d.text,
          after: draft.texts.get(d.absolutePath)!,
        })),
        derivedImpacts: changes.length
          ? new DerivationIndex([
              ...draft.initialIndex.relations,
              ...[...draft.parsed.values()].flatMap((f) => f.relations ?? []),
            ]).impacts(changedTerms, renames)
          : [],
        warnings: [...issues.map((d) => d.message), ...externalWarnings],
      };
    });
  }
  private async stageFormat(
    draft: DeclarationDraft,
    save: GuardedSave,
    format: IAtermFormatInput,
  ): Promise<void> {
    const { documents: termDeclarations, parsed, texts, terms } = draft;
    const implicit = !format.knowledge && !format.termPatterns?.length;
    const plan = new RelationFormatter().plan(
      parsed,
      texts,
      format.termPatterns ?? [],
      format.knowledge,
      implicit
        ? new Set(termDeclarations.filter((doc) => !doc.readOnly).map((doc) => doc.absolutePath))
        : undefined,
    );
    for (const [file, after] of plan.texts) {
      const doc = termDeclarations.find((d) => d.absolutePath === file)!;
      await save.guard(doc);
      const candidate = new AtermParser(parsed.get(file)!.termKinds).parse(file, after);
      draft.stage(doc, after, candidate);
    }
    for (const term of plan.terms) terms.add(term);
  }
  private async stageExternal(
    draft: DeclarationDraft,
    externalSelection: IExternalSelection | undefined,
    renames: ReadonlyMap<string, string>,
  ): Promise<string[]> {
    const externalWarnings: string[] = [];
    if (externalSelection?.externalSources) {
      const external = await new ExternalFiles(this.files).read(
        this.config.home.workspace,
        externalSelection,
      );
      externalWarnings.push(...external.warnings.map((warning) => warning.message));
      for (const file of external.files) {
        const after = new ExternalText().rename(file.text, renames);
        if (after === file.text) continue;
        draft.stage(file, after);
      }
    }
    return externalWarnings;
  }
}
