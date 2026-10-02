import type { AtermTermKind, AtermFiletype, AtermSchema } from './schema.js';
import type { IRelationSemantics } from './relation.js';

export interface ISourceLocation {
  readonly file: string;
  readonly line: number;
}

/** Authored Knowledge metadata; prose with its physical source bounds, not a Term Declaration. */
export interface IKnowledgeText {
  readonly content: string;
  readonly line: number;
  readonly endLine: number;
}

/** Authoring coverage obligations in Knowledge metadata. */
export type IKnowledgeScope = IKnowledgeText;

export interface ITermDeclaration extends ISourceLocation {
  readonly id: string;
  readonly knowledge: string;
  readonly scope?: IKnowledgeScope;
  readonly endLine: number;
  readonly sourceLines?: readonly { readonly line: number; readonly text: string }[];
  readonly name: string;
  /** Authored Term Kind spelling: local name or Viewpoint-qualified name. */
  readonly termKind: string;
  /** Authored organization path within this Knowledge; independent of Term identity. */
  readonly group?: string;
  /** The Viewpoint that supplied the kind; absent when the kind is unknown. */
  readonly viewpoint?: string;
  readonly schema: AtermSchema;
  readonly sections: readonly IAtermSection[];
  readonly fence: string;
  readonly references: readonly IReference[];
}

export interface IAtermSection {
  readonly key: string;
  readonly filetype: AtermFiletype;
  readonly content: string;
  /** Physical declaration opener or section separator line. */
  readonly line: number;
}

export interface IReference extends ISourceLocation {
  readonly id: string;
  readonly column?: number;
  readonly name: string;
  readonly section: string;
  /** Exact destination section, when the occurrence uses _Term_.section. */
  readonly targetSection?: string;
  /** Offset of the Term token in its normalized section content. */
  readonly contentOffset?: number;
  readonly required?: true;
}

export interface IReferenceEdge extends IRelationSemantics {
  readonly source: string;
  readonly target: string;
  readonly origin: 'explicit' | 'relation';
  readonly phrase?: string;
  readonly section?: string;
  readonly targetSection?: string;
  readonly required?: true;
  readonly locations: readonly ISourceLocation[];
}

/** A labeled Target declaration in a Term Declaration's reserved .relations section. */
export interface IAtermRelation extends ISourceLocation, IRelationSemantics {
  readonly source: string;
  readonly phrase: string;
  readonly target: string;
  /** The target was written with an adjacent dagger: required context for reads of the source. */
  readonly required?: true;
}

export interface IDiagnostic extends ISourceLocation {
  readonly message: string;
}

export interface IParsedFile {
  readonly file?: string;
  readonly knowledge?: string;
  readonly knowledgeLine?: number;
  /** Reader-facing description of what this Knowledge contains. */
  readonly description?: IKnowledgeText;
  readonly scope?: IKnowledgeScope;
  /** The Viewpoint names the Knowledge's `@viewpoints` line declares, in order. */
  readonly viewpoints?: readonly string[];
  /** The kinds the declared Viewpoints supply, each with the Schema its Term Declarations follow. */
  readonly termKinds?: readonly AtermTermKind[];
  readonly relations?: readonly IAtermRelation[];
  readonly termDeclarations: readonly ITermDeclaration[];
  readonly diagnostics: readonly IDiagnostic[];
}
