import type { ICommandInputContext } from '../contracts.js';

/** One input selection shared by command preparation and remote stdin forwarding. */
export class CommandTextInput {
  constructor(private readonly inline?: { index: number; label: string }) {}

  path(args: unknown[], options: Record<string, unknown>): string | undefined {
    if (this.inline && args[this.inline.index] !== undefined) {
      if (options.file !== undefined)
        throw new Error(`Use either an inline ${this.inline.label} or --file.`);
      return undefined;
    }
    const path = options.file ?? '-';
    if (typeof path !== 'string') throw new Error('--file is required');
    return path;
  }

  async read(
    args: unknown[],
    options: Record<string, unknown>,
    input: ICommandInputContext,
  ): Promise<string> {
    const path = this.path(args, options);
    return path === undefined ? String(args[this.inline!.index]) : input.text(path);
  }
}
