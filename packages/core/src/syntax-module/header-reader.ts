import type { IKnowledgeText } from './model.js';
import { knowledgePattern } from './identity.js';
import { viewpointNamePattern } from './term-kind.js';
import {
  sectionContent,
  SourceCursor,
  type ISourceLine,
  type ParseIssue,
} from './parsing-source.js';

const knowledgeDirective = new RegExp(`^@knowledge[ \t]+(${knowledgePattern})[ \t]*$`);
/** Viewpoint selection follows Knowledge identity and precedes Term Declarations. */
const directive = new RegExp(
  `^@viewpoints(?:[ \\t]+(${viewpointNamePattern}(?:[ \\t]+${viewpointNamePattern})*))?[ \\t]*$`,
);

/** Reads the `@viewpoints` line of a Knowledge: the names and the line, or nothing. */
export function readViewpointsDirective(
  text: string,
): { readonly names: readonly string[]; readonly line: number } | undefined {
  const source = new SourceCursor(text);
  while (!source.done) {
    const { text: line, line: number } = source.take();
    if (!line.trim() || line.startsWith('//')) continue;
    if (line.match(knowledgeDirective)) continue;
    const match = line.match(directive);
    if (!match) return undefined;
    return { names: (match[1] ?? '').split(/[ \t]+/).filter(Boolean), line: number };
  }
  return undefined;
}

/** Knowledge metadata, directive order and metadata block recovery. One instance per file. */
export class KnowledgeHeaderReader {
  knowledge: string | undefined;
  knowledgeLine: number | undefined;
  viewpoints: string[] | undefined;
  readonly metadata: Partial<Record<'description' | 'scope', IKnowledgeText>> = {};
  private knowledgeSeen = false;
  private readonly textSeen = new Set<string>();
  constructor(private readonly issue: ParseIssue) {}

  read(input: ISourceLine, source: SourceCursor, hasDeclarations: boolean): boolean {
    const { text, line: start } = input;
    const issue = this.issue;
    if (/^@knowledge(?:[ \t]|$)/.test(text)) {
      const match = text.match(knowledgeDirective);
      if (this.knowledgeSeen) issue(start, 'A Knowledge declares @knowledge once.');
      if (this.viewpoints || this.textSeen.size || hasDeclarations)
        issue(
          start,
          '@knowledge must precede @viewpoints, @description, @scope and Term Declarations.',
        );
      this.knowledgeSeen = true;
      if (!match) issue(start, 'Expected @knowledge <lowercase_snake_case_id>.');
      else if (!this.knowledge) {
        this.knowledge = match[1]!;
        this.knowledgeLine = start;
      }
      return true;
    }
    const textField = /^@(description|scope)(?:[ \t]|$)/.exec(text)?.[1] as
      | 'description'
      | 'scope'
      | undefined;
    if (textField) {
      if (!new RegExp(`^@${textField}[ \\t]+\\{[ \\t]*$`).test(text)) {
        issue(start, `Expected @${textField} { on its own line.`);
        return true;
      }
      if (this.textSeen.has(textField)) issue(start, `A Knowledge declares @${textField} once.`);
      if (!this.viewpoints || hasDeclarations)
        issue(
          start,
          `@${textField} must follow @viewpoints and precede the first Term Declaration.`,
        );
      this.textSeen.add(textField);
      const block = this.readMetadataBlock(source, textField, start);
      this.metadata[textField] ??= block;
      return true;
    }
    if (text.startsWith('@')) {
      const match = text.match(directive);
      if (!match)
        issue(
          start,
          'Unknown directive; expected @knowledge <id>, @viewpoints <name> [<name>…], @description { or @scope {.',
        );
      else if (this.viewpoints) issue(start, 'A Knowledge declares @viewpoints once.');
      else if (hasDeclarations)
        issue(start, '@viewpoints must precede the first Term Declaration.');
      else this.viewpoints = (match[1] ?? '').split(/[ \t]+/).filter(Boolean);
      return true;
    }
    return false;
  }

  private readMetadataBlock(
    source: SourceCursor,
    textField: 'description' | 'scope',
    start: number,
  ): IKnowledgeText {
    const issue = this.issue;
    const body: string[] = [];
    while (!source.done && !/^}[ \t]*$/.test(source.peek())) {
      const line = source.peek();
      // Recover at the next structural line instead of swallowing a Term Declaration.
      if (line.trim() && !line.startsWith('  ')) {
        issue(
          source.position + 1,
          `${textField === 'scope' ? 'Scope' : 'Description'} body lines must have two leading spaces.`,
        );
        break;
      }
      body.push(line.startsWith('  ') ? line.slice(2) : '');
      source.take();
    }
    if (!source.done && /^}[ \t]*$/.test(source.peek())) source.take();
    else issue(start, `Unclosed @${textField} block.`);
    const content = sectionContent(body);
    if (!content.trim()) issue(start, `@${textField} must not be empty.`);
    return { content, line: start, endLine: source.position };
  }
}
