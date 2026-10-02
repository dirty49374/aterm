import type { AtermFiletype, AtermSchema, AtermTermKind } from './schema.js';
import { termKindPattern, resolveTermKind } from './term-kind.js';
import { groupPathPattern, localTermPattern as namePattern } from './identity.js';
import type { SourceCursor, ISourceLine, ISectionSource, ParseIssue } from './parsing-source.js';

const termDeclarationOpener = `^(${termKindPattern})[ \\t]+(${namePattern})(?:[ \\t]+in[ \\t]+(${groupPathPattern}))?[ \\t]*=[ \\t]*`;

export interface IDeclarationStructure {
  readonly name: string;
  readonly termKind: string;
  readonly group?: string;
  readonly viewpoint?: string;
  readonly schema: AtermSchema;
  readonly fence: string;
  readonly line: number;
  readonly endLine: number;
  readonly sourceLines: readonly { line: number; text: string }[];
  readonly sections: readonly ISectionSource[];
}

/** Reads declaration structure without interpreting section contents. */
export class DeclarationReader {
  private readonly opener = new RegExp(termDeclarationOpener + '(`{3,})(md|ts)[ \\t]*$');
  /** `<term-kind> _Term_ = {` opens a block; `<term-kind> _Term_ = { text }` is a one-line Term Declaration. */
  private readonly keyedOpener = new RegExp(
    termDeclarationOpener + '\\{(?:[ \\t]*(\\S.*?)[ \\t]*\\}[ \\t]*|[ \\t]*)$',
  );

  constructor(private readonly termKinds: readonly AtermTermKind[]) {}
  read(
    input: ISourceLine,
    source: SourceCursor,
    issue: ParseIssue,
  ): IDeclarationStructure | undefined {
    const { text, line: start } = input;
    const termKinds = this.termKinds;
    const keyed = text.match(this.keyedOpener);
    const header = keyed ?? text.match(this.opener);
    if (!header) {
      issue(
        start,
        'Expected <term-kind> _Term_ [in group.path] = {. Group path segments use lowercase_snake_case; under and external Relations are not supported.',
      );
      return undefined;
    }
    const [, termKind, name, group] = header as [string, string, string, string?];
    const inline = keyed ? keyed[4] : undefined;
    const [legacyFence, language] = keyed
      ? ['}', undefined]
      : (header.slice(4) as [string, 'md' | 'ts']);
    let selected: AtermTermKind | undefined;
    try {
      selected = resolveTermKind(termKinds, termKind);
    } catch (error) {
      issue(start, (error as Error).message);
    }
    // An unknown kind still parses against the first Schema, so section errors surface too.
    const schema = (selected ?? termKinds[0]!).schema;
    const fence = keyed ? '}' : legacyFence;
    const sections = readSections(
      source,
      { text, keyed: !!keyed, inline, language },
      schema,
      fence,
      name,
      start,
      issue,
    );
    return {
      name,
      termKind,
      ...(group ? { group } : {}),
      ...(selected ? { viewpoint: selected.viewpoint } : {}),
      schema,
      fence,
      sections,
      line: start,
      endLine: source.position,
      sourceLines: source.consumedFrom(start),
    };
  }
}

function readSections(
  source: SourceCursor,
  header: { text: string; keyed: boolean; inline?: string; language?: AtermFiletype },
  schema: AtermSchema,
  fence: string,
  name: string,
  start: number,
  issue: ParseIssue,
): ISectionSource[] {
  const sections: ISectionSource[] = [];
  // The first Schema field, definition, has no header: it starts right after the opener.
  beginSection(
    schema,
    sections,
    issue,
    header.keyed ? undefined : header.language,
    start,
    header.keyed ? schema.sections[0]!.name : undefined,
  );
  let closed = false;
  if (header.inline !== undefined) {
    sections[0]?.lines.push({
      text: header.inline,
      line: start,
      column: header.text.indexOf(header.inline, header.text.indexOf('{') + 1) + 1,
    });
    closed = true;
  }
  while (!closed && !source.done) {
    const { text: raw } = source.take();
    if (raw.trimEnd() === fence) {
      closed = true;
      break;
    }
    if (readSectionSeparator(raw, header.keyed, schema, sections, source.position, issue)) continue;
    appendSectionLine(raw, source.position, sections, issue);
  }
  if (!closed) issue(start, 'Unclosed Term Declaration ' + name + '; expected ' + fence + '.');
  return sections;
}

function readSectionSeparator(
  raw: string,
  keyed: boolean,
  schema: AtermSchema,
  sections: ISectionSource[],
  line: number,
  issue: ParseIssue,
): boolean {
  const separator = raw
    .trimEnd()
    .match(keyed ? /^\.([a-z][a-z0-9_]*)$/ : /^(?:---(md|ts)|\.(relations))$/);
  if (separator) {
    if (keyed && separator[1] === schema.sections[0]!.name)
      issue(
        line,
        'The ' + separator[1] + ' section has no header; its content follows the opener.',
      );
    else if (keyed || separator[2] === 'relations')
      beginSection(schema, sections, issue, undefined, line, keyed ? separator[1] : 'relations');
    else beginSection(schema, sections, issue, separator[1] as AtermFiletype, line);
    return true;
  }
  return false;
}
function appendSectionLine(
  raw: string,
  line: number,
  sections: ISectionSource[],
  issue: ParseIssue,
): void {
  if (raw.trim() && !raw.startsWith('  ')) {
    issue(line, 'Body lines require two leading spaces; delimiters are at column zero.');
  }
  const body = raw.startsWith('  ') ? raw.slice(2) : raw;
  if (!sections.length) {
    if (raw.trim()) issue(line, 'Body requires a declared section key.');
  } else
    sections.at(-1)!.lines.push({ text: body, line: line, column: raw.startsWith('  ') ? 3 : 1 });
}

function beginSection(
  schema: AtermSchema,
  sections: ISectionSource[],
  issue: ParseIssue,
  filetype: AtermFiletype | undefined,
  line: number,
  selectedKey?: string,
): void {
  const field = selectedKey
    ? schema.sections.find((field) => field.name === selectedKey)
    : schema.sections.filter((field) => field.name !== 'relations')[
        sections.filter((section) => section.key !== 'relations').length
      ];
  if (!field) {
    issue(
      line,
      'Unknown or excess section; expected sections: ' +
        schema.sections.map((field) => field.name).join(', ') +
        '.',
    );
    return;
  }
  const { name: key, type: configured } = field;
  if (
    sections.length > 0 &&
    schema.sections.findIndex((f) => f.name === key) <=
      schema.sections.findIndex((f) => f.name === sections.at(-1)!.key)
  )
    issue(line, 'Section headers must follow Schema order without duplicates.');
  if (filetype && !schema.allows(key, filetype))
    issue(line, 'Section ' + key + ' does not allow filetype ' + filetype + '.');
  sections.push({ key, filetype: filetype ?? configured, line, lines: [] });
}
