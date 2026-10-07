import { ExternalOptions } from './external-options.js';
import type { AtermQuery } from '@garage49/aterm-core';
import type { ICommandDefinition, ICommandInputContext } from '../contracts.js';

export class MoveCommand implements ICommandDefinition {
  readonly name = 'term move';
  readonly argument = '<terms...>';
  readonly options = [
    ['--to <knowledge>', 'Existing destination Knowledge ID'],
    ...ExternalOptions.options,
    ['--dry-run', 'Validate and preview without saving'],
  ] as const;
  readonly help = {
    summary: 'Move Terms and their references into another Knowledge',
    behavior:
      'Select exact Terms or quoted globs; --knowledge disambiguates the source. --to names an existing Knowledge. Move each Term with its single Term Declaration, preserving its Term Kind, Group and sections. Destination Term Kinds must have identical definitions. Name collisions refuse; Terms never merge. Local references are qualified when crossing the new boundary; incoming and external qualified references follow the moved identity. Configured externalSources apply unless explicitly replaced. --dry-run previews all changes through the common guarded authoring save. Multi-file writes are not crash-atomic.',
    example: "aterm term move '_old:Example_' --to new --dry-run",
  };
  readonly action = 'query' as const;
  async prepare(
    args: unknown[],
    options: Record<string, unknown>,
    _input: ICommandInputContext,
  ): Promise<AtermQuery> {
    if (!options.to) throw new Error('term move requires --to <knowledge>.');
    return {
      ...ExternalOptions.read(options),
      operation: 'move',
      termPatterns: args[0] as string[],
      to: options.to as string,
      ...(options.dryRun ? { dryRun: true } : {}),
    };
  }
}
