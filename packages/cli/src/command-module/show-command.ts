import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class ShowCommand implements ICommandDefinition {
  readonly name = 'term show';
  readonly legacyName = 'show';
  readonly argument = '<pattern...>';
  readonly options = [
    ['--no-remark', 'Exclude Remarks text and references'],
    ['--with-fileline', 'Include file and line annotations'],
    ['--section <key>', 'Print only this section of each Term Declaration, as text or Markdown'],
  ] as const;
  readonly help = {
    summary: 'Print copyable Aterm Term Declaration blocks',
    behavior:
      'Requires exact names or quoted globs. Includes Definition, Contract and informative Remarks; --no-remark excludes Remarks. Whole-Term required references do not expand in show. Unknown exact names and invalid corpora fail instead of returning partial results. --section prints one section of each selected Term as plain text, in canonical Term order, with no header or annotation, so the output can be read as the content itself; a Term without that section is omitted, and no Term having it fails. JSON/YAML are unaffected by --section. --output markdown uses Term Declaration and section headings without context annotations, expands standalone _Term_.section† references in place and ends with two empty lines.',
    example: 'aterm term show _aterm_skills:Aterm_Basics_Skill_ --section description',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'show',
      ...(Array.isArray(args[0]) && args[0].length ? { termPatterns: args[0] } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
