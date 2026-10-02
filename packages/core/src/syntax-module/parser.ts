import type { IAtermRelation, ITermDeclaration, IDiagnostic, IParsedFile } from './model.js';
import { specTermKinds, type AtermTermKind } from './schema.js';
import { termIdentity } from './identity.js';
import { SourceCursor } from './parsing-source.js';
import { KnowledgeHeaderReader } from './header-reader.js';
import { DeclarationReader } from './declaration-reader.js';
import { SectionInterpreter } from './section-interpreter.js';

export { readViewpointsDirective } from './header-reader.js';

/** Coordinates file reading; grammar and content interpretation have separate owners. */
export class AtermParser {
  constructor(private readonly termKinds: readonly AtermTermKind[] = specTermKinds) {}

  parse(file: string, text: string): IParsedFile {
    const source = new SourceCursor(text);
    const termDeclarations: ITermDeclaration[] = [];
    const relations: IAtermRelation[] = [];
    const diagnostics: IDiagnostic[] = [];
    const issue = (line: number, message: string) => {
      diagnostics.push({ file, line, message });
    };
    const header = new KnowledgeHeaderReader(issue);
    const declarations = new DeclarationReader(this.termKinds);
    const interpreter = new SectionInterpreter(file, issue);

    while (!source.done) {
      const input = source.take();
      if (!input.text.trim() || input.text.startsWith('//')) continue;
      if (header.read(input, source, termDeclarations.length > 0)) continue;
      const structure = declarations.read(input, source, issue);
      if (!structure) continue;
      const knowledge = header.knowledge ?? '';
      const interpreted = interpreter.read(structure, knowledge);
      if (!interpreted) continue;
      for (const relation of interpreted.relations) relations.push(relation);
      termDeclarations.push({
        ...structure,
        id: termIdentity(structure.name, knowledge),
        knowledge,
        file,
        sections: interpreted.sections,
        references: interpreted.references,
      });
    }
    if (!header.knowledge) issue(1, 'Knowledge requires @knowledge <lowercase_snake_case_id>.');
    return {
      file,
      knowledge: header.knowledge,
      knowledgeLine: header.knowledgeLine,
      termDeclarations: termDeclarations.map((declaration) => ({
        ...declaration,
        ...(header.metadata.scope ? { scope: header.metadata.scope } : {}),
      })),
      ...header.metadata,
      relations,
      diagnostics,
      termKinds: this.termKinds,
      ...(header.viewpoints ? { viewpoints: header.viewpoints } : {}),
    };
  }
}
