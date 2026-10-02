import type { AtermQuery } from '@aterm/core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class CheckCommand implements ICommandDefinition {
  readonly name = 'corpus check';
  readonly legacyName = 'check';
  readonly options = [
    ['--root <pattern...>', 'Also require reachability from these root Terms'],
    ['--no-remark', 'Exclude Remarks edges in reachability; still validate all sections'],
    ['--with-fileline', 'Include file and line annotations'],
  ] as const;
  readonly help = {
    summary: 'Check Aterm syntax, names, references and optional reachability',
    behavior:
      'Checks every admitted .trm; errors return exit 1 in text, JSON and YAML. Warnings alone return exit 0 and do not block reads. --root takes exact names or globs; all Term Declarations must be reachable from their union. --no-remark excludes Remarks edges from reachability, not validation. Without --root, everything is reachable by definition. Checks cannot prove semantic completeness.',
    example: 'aterm corpus check --root _Introduction_',
  };
  readonly action = 'query' as const;
  async prepare(
    _args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    return {
      operation: 'check',
      ...(Array.isArray(options.root) ? { roots: options.root } : {}),
      ...(options.remark === false ? { remarks: false } : {}),
    };
  }
}
