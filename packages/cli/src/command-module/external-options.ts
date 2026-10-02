/** Named file globs override configured external sources for one request. */
export class ExternalOptions {
  static readonly options = [
    [
      '--external <name=glob...>',
      'Select named external file globs (quote globs); replaces configured externalSources',
    ],
  ] as const;
  static read(options: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(options.external)) return {};
    const entries = options.external.map((input: string) => {
      const equals = input.indexOf('=');
      if (equals < 1 || equals === input.length - 1)
        throw new Error(`Expected --external name=glob, received: ${input}`);
      return [input.slice(0, equals), input.slice(equals + 1)] as const;
    });
    if (new Set(entries.map(([name]) => name)).size !== entries.length)
      throw new Error('Each --external source name must be unique.');
    return { externalSources: Object.fromEntries(entries) };
  }
}
