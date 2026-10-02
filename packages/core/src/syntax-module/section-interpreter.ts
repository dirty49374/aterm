import type { IAtermSection, IAtermRelation, IReference } from './model.js';
import { builtInRelations, relationSemantics } from './relation.js';
import { referencePattern, termIdentity, termTokens } from './identity.js';
import { parse, postprocess, preprocess } from 'micromark';
import { readStructured } from './structured.js';
import { sectionContent, type ISectionSource, type ParseIssue } from './parsing-source.js';
import type { IDeclarationStructure } from './declaration-reader.js';

/** Lexes explicit symbols, not arbitrary Markdown links or TypeScript identifiers. */
class ReferenceScanner {
  scan(
    file: string,
    lines: readonly { text: string; line: number; column: number }[],
    section: IReference['section'],
    knowledge: string,
    issue: (line: number, message: string) => void,
  ): IReference[] {
    const references: IReference[] = [];
    const symbol = termTokens('trm');
    const text = lines.map((line) => line.text).join('\n');
    const events = postprocess(
      parse()
        .document()
        .write(preprocess()(text, undefined, true)),
    );
    const opaque = events
      .filter(
        ([event, token]) =>
          event === 'enter' && ['codeFenced', 'codeIndented'].includes(token.type),
      )
      .map(([, token]) => ({ start: token.start.offset, end: token.end.offset }));
    const leading = text.length - text.replace(/^(?:[ \t]*\n)+/, '').length;
    let offset = 0;
    for (const { text, line, column } of lines) {
      for (const match of text.matchAll(symbol)) {
        const start = offset + match.index;
        if (opaque.some((range) => range.start <= start && start < range.end)) continue;
        const tail = text.slice(match.index + match[0].length);
        const selector = tail.match(/^\.([a-z][a-z0-9_]*)(?![A-Za-z0-9_])/);
        const required = tail[selector?.[0].length ?? 0] === '†';
        if (selector && required && text.trim() !== match[0] + selector[0] + '†')
          issue(line, 'Section expansion must occupy a line by itself: _Term_.section†.');
        references.push({
          column: match.index + column,
          name: match[0],
          id: termIdentity(match[0], knowledge),
          file,
          line,
          section,
          ...(selector ? { targetSection: selector[1]!, contentOffset: start - leading } : {}),
          ...(required ? { required: true as const } : {}),
        });
      }
      offset += text.length + 1;
    }
    return references;
  }
}

interface IInterpretedSections {
  readonly sections: readonly IAtermSection[];
  readonly relations: readonly IAtermRelation[];
  readonly references: readonly IReference[];
}

/** Interprets collected section source; never consumes the file cursor. */
export class SectionInterpreter {
  private readonly relation = new RegExp(
    '^([A-Za-z]+(?:_[A-Za-z]+)+|[A-Za-z]+(?:-[A-Za-z]+)*(?:[ \t]+[A-Za-z]+(?:-[A-Za-z]+)*){0,4})[ \t]+(' +
      referencePattern +
      ')(†)?[ \t]*$',
  );
  private readonly references = new ReferenceScanner();
  constructor(
    private readonly file: string,
    private readonly issue: ParseIssue,
  ) {}

  read(declaration: IDeclarationStructure, knowledge: string): IInterpretedSections | undefined {
    const { sections, schema, name, line: start } = declaration;
    const content = sections.map(({ key, filetype, line, lines }) => ({
      key,
      filetype,
      line,
      content: sectionContent(lines.map((line) => line.text)),
    }));
    if (!content[0]?.content.trim())
      this.issue(start, 'First section ' + schema.sections[0]!.name + ' must not be empty.');
    if (!content.some((section) => section.key === schema.sections[0]!.name)) return undefined;
    const relations: IAtermRelation[] = [];
    for (const section of sections) {
      if (section.filetype !== 'md') continue;
      if (section.key === 'relations') {
        for (const relation of this.readRelations(section, name, knowledge))
          relations.push(relation);
      } else this.checkLegacyRelations(section);
    }
    // Preserve diagnostic order: relation/legacy checks, structured parsing, Markdown references.
    const structuredReferences = sections.flatMap((section) =>
      section.filetype === 'yaml' || section.filetype === 'json'
        ? this.readStructuredReferences(section, knowledge)
        : [],
    );
    const references = sections.flatMap((section) =>
      section.filetype === 'md'
        ? this.references.scan(this.file, section.lines, section.key, knowledge, this.issue)
        : [],
    );
    return { sections: content, relations, references: [...references, ...structuredReferences] };
  }

  private readRelations(
    section: ISectionSource,
    name: string,
    knowledge: string,
  ): IAtermRelation[] {
    const relations: IAtermRelation[] = [];
    const { file, issue } = this;
    for (const line of section.lines) {
      if (!line.text.trim()) continue;
      const assertion = line.text.match(this.relation);
      if (!assertion) {
        issue(
          line.line,
          'Invalid Relation declaration; expected <built-in name or one to five English words> _Target_ with optional adjacent † in .relations.',
        );
        continue;
      }
      const phrase = assertion[1]!.split(/[ \t]+/).join(' ');
      const semantics = relationSemantics(phrase);
      if (!semantics) {
        issue(
          line.line,
          `Unknown built-in Relation ${phrase}; expected one of: ${Object.keys(builtInRelations).join(', ')}.`,
        );
        continue;
      }
      relations.push({
        source: termIdentity(name, knowledge),
        phrase,
        ...semantics,
        target: termIdentity(assertion[2]!, knowledge),
        ...(assertion[3] ? { required: true as const } : {}),
        file,
        line: line.line,
      });
    }
    return relations;
  }

  private checkLegacyRelations(section: ISectionSource): void {
    const issue = this.issue;
    // The previous marker is never silently treated as a new-style declaration.
    // Markdown examples remain opaque, including inline-code explanations.
    const markdown = section.lines.map((l) => l.text).join('\n');
    const events = postprocess(
      parse()
        .document()
        .write(preprocess()(markdown, undefined, true)),
    );
    for (const [event, token] of events) {
      if (
        event === 'enter' &&
        token.type === 'strong' &&
        markdown.slice(token.start.offset, token.end.offset) === '**Relation**' &&
        markdown[token.end.offset] === ':'
      ) {
        const sourceLine = section.lines[token.start.line - 1];
        issue(
          sourceLine?.line ?? section.line,
          'Legacy **Relation** declaration; move phrase and target to .relations and omit the source.',
        );
      }
    }
  }

  private readStructuredReferences(section: ISectionSource, knowledge: string): IReference[] {
    const { file, issue } = this;
    const structuredReferences: IReference[] = [];
    const text = section.lines.map((line) => line.text).join('\n');
    try {
      const parsed = readStructured(text, section.filetype as 'yaml' | 'json');
      for (const ref of parsed.references) {
        const prefix = text.slice(0, ref.offset);
        const index = prefix.split('\n').length - 1;
        const source = section.lines[index]!;
        structuredReferences.push({
          name: ref.name,
          id: termIdentity(ref.name, knowledge),
          file,
          line: source.line,
          column: ref.offset - (prefix.lastIndexOf('\n') + 1) + source.column,
          section: section.key,
          ...(ref.targetSection ? { targetSection: ref.targetSection } : {}),
        });
      }
    } catch (error) {
      issue(
        section.line,
        `Invalid ${section.filetype} section ${section.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return structuredReferences;
  }
}
