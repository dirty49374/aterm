import type {
  IAtermRelation,
  IAtermSection,
  ITermDeclaration,
  IDiagnostic,
  IParsedFile,
} from '../syntax-module/index.js';
import type { AtermFiletype } from '../syntax-module/index.js';

/**
 * Stable wire sections; content is stored only in internal sections.
 * `sections` carries every Schema-keyed section in order. `definition`, `contract` and
 * `remarks` are the SPEC public projection of the sections with those keys, kept for
 * existing consumers; a Schema that declares other keys is read through `sections`.
 */
export interface ITermDeclarationView extends Omit<ITermDeclaration, 'schema' | 'sections'> {
  readonly sections: readonly IAtermSection[];
  readonly language: AtermFiletype;
  readonly definition: string;
  readonly contract?: string;
  readonly remarks?: string;
  readonly contractLanguage?: AtermFiletype;
  readonly remarksLanguage?: AtermFiletype;
  readonly contractLine?: number;
  readonly remarksLine?: number;
}

export interface IParsedView {
  readonly relations?: readonly IAtermRelation[];
  readonly termDeclarations: readonly ITermDeclarationView[];
  readonly diagnostics: readonly IDiagnostic[];
}

/** The sole internal-section to legacy SPEC projection for CLI/MCP and documents. */
export class TermDeclarationProjection {
  termDeclaration(value: ITermDeclaration, remarks = true, source = true): ITermDeclarationView {
    const { schema: _schema, sections, sourceLines, references, ...identity } = value;
    const definition = sections.find((section) => section.key === 'definition');
    if (!definition) throw new Error('SPEC projection requires a definition section.');
    const contract = sections.find((section) => section.key === 'contract');
    const explanation = sections.find((section) => section.key === 'remarks');
    return {
      ...identity,
      sections: sections.filter((section) => remarks || section.key !== 'remarks'),
      language: definition.filetype,
      definition: definition.content,
      contract: contract?.content,
      ...(remarks ? { remarks: explanation?.content } : {}),
      contractLanguage: contract?.filetype,
      remarksLanguage: explanation?.filetype,
      contractLine: contract?.line,
      remarksLine: explanation?.line,
      ...(source
        ? {
            sourceLines: sourceLines?.filter(
              (line) =>
                remarks ||
                explanation === undefined ||
                line.line < explanation.line ||
                line.line === value.endLine,
            ),
          }
        : {}),
      references: references.filter((reference) => remarks || reference.section !== 'remarks'),
    };
  }

  file(value: IParsedFile): IParsedView {
    return {
      relations: value.relations,
      termDeclarations: value.termDeclarations.map((d) => this.termDeclaration(d)),
      diagnostics: value.diagnostics,
    };
  }
}
