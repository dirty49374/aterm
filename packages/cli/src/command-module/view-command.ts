import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class ViewCommand implements ICommandDefinition {
  readonly name = 'term view';
  readonly legacyName = 'view';
  readonly argument = '<pattern...>';
  readonly options = [
    ['--no-remark', 'Exclude Remarks text and references'],
    ['--detail', 'Show source lines and references; text output also includes Scope'],
    ['--with-fileline', 'Include file and line annotations'],
    ['--section <key>', 'Print only this section of each Term Declaration, as text or Markdown'],
  ] as const;
  readonly help = {
    summary: 'Read Term Declarations with outgoing and incoming references',
    behavior:
      'Prints copyable Aterm blocks by default. --detail adds Scope in text output, physical file start/end lines, line-numbered source, both reference directions. --with-fileline adds source annotations; reference locations require both flags. Automatically includes required references (_Name_†), transitively, once per name even in cycles. Includes Definition, Contract and Remarks by default; --no-remark excludes Remarks text and reference traversal. Ordinary references do not expand. Use term show for selected blocks without required-reference expansion. Structured output retains all metadata regardless of --detail. --section prints one section of each Term, selected or pulled in, as plain text and nothing else; Terms without that section are omitted. --output markdown uses Term Declaration and section headings without context annotations, expands standalone _Term_.section† references in place and ends with two empty lines.',
    example: 'aterm term view "_Project_*" --no-remark',
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'view',
      ...(Array.isArray(args[0]) && args[0].length ? { termPatterns: args[0] } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    } as AtermQuery;
  }
}
