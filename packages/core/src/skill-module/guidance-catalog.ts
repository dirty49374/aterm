import { AtermScanner, type IScanResult } from '../corpus-module/index.js';
import { mergeScans } from '../corpus-module/scanner.js';
import type { IAtermConfig } from '../home-module/index.js';
import { TermDeclarationReader, type ITermDeclarationView } from '../query-module/index.js';
import { AtermError } from '../error.js';
import { shippedConfig } from '../home-module/package.js';

export interface IGuidanceSource {
  readonly origin: 'package' | 'home';
  readonly config: IAtermConfig;
  readonly scan: IScanResult;
  readonly termDeclarations: readonly ITermDeclarationView[];
}

export interface IGuidanceCatalog {
  readonly scan: IScanResult;
  readonly sources: readonly IGuidanceSource[];
  readonly termDeclarations: readonly ITermDeclarationView[];
}

/** Package and Home guidance share one catalog without adding package files to Home sources. */
export class GuidanceCatalog {
  constructor(private readonly shipped: () => Promise<IAtermConfig> = shippedConfig) {}

  async read(
    home: IAtermConfig,
    homeScan: () => IScanResult | Promise<IScanResult>,
    packageOnly = false,
  ): Promise<IGuidanceCatalog> {
    const config = await this.shipped();
    const packaged = await new AtermScanner().scan(config);
    const packagePaths = new Set(packaged.trmFiles.map((file) => file.absolutePath));
    const selected = packageOnly ? undefined : await homeScan();
    // A Home snapshot owns overlapping files, even if the package file has since changed on disk.
    const snapshots = new Map(selected?.trmFiles.map((trmFile) => [trmFile.absolutePath, trmFile]));
    const sources: Omit<IGuidanceSource, 'termDeclarations'>[] = [];
    for (const [origin, sourceConfig, scan] of [
      [
        'package',
        config,
        {
          ...packaged,
          trmFiles: packaged.trmFiles.map((d) => snapshots.get(d.absolutePath) ?? d),
        },
      ],
      ...(selected
        ? [
            [
              'home',
              home,
              {
                ...selected,
                trmFiles: selected.trmFiles.filter(
                  (trmFile) => !packagePaths.has(trmFile.absolutePath),
                ),
              },
            ] as const,
          ]
        : []),
    ] as const) {
      sources.push({
        origin,
        config: sourceConfig,
        scan,
      });
    }
    const knowledges = new Map<string, string>();
    for (const source of sources) {
      for (const trmFile of source.scan.trmFiles) {
        const id = trmFile.parsed?.knowledge;
        if (!id) continue;
        const previous = knowledges.get(id);
        if (previous && previous !== trmFile.absolutePath)
          throw new AtermError(
            'guidance.ambiguous',
            `Knowledge ${id} has conflicting guidance sources: ${previous} and ${trmFile.absolutePath}. Use a distinct Home Knowledge ID.`,
          );
        knowledges.set(id, trmFile.absolutePath);
      }
    }
    const combined = mergeScans(...sources.map((source) => source.scan));
    const termDeclarations = new TermDeclarationReader().query(
      combined.trmFiles,
      { operation: 'list' },
      combined.diagnostics,
    ).termDeclarations;
    return {
      scan: combined,
      termDeclarations,
      sources: sources.map((source) => {
        const paths = new Set(source.scan.trmFiles.map((trmFile) => trmFile.absolutePath));
        return {
          ...source,
          termDeclarations: termDeclarations.filter((termDeclaration) =>
            paths.has(termDeclaration.file),
          ),
        };
      }),
    };
  }
}
