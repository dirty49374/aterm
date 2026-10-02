import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import type { IScanResult } from '../corpus-module/index.js';
import {
  TermDeclarationReader,
  TermDeclarationProjection,
  type ITermDeclarationQueryInput,
} from '../query-module/index.js';
import { SkillReading } from '../skill-module/index.js';

/** One semantic validation path for live and prospective corpus states. */
export async function checkCorpus(
  config: IAtermConfig,
  scan: IScanResult,
  options: Omit<ITermDeclarationQueryInput, 'operation'> = {},
) {
  const result = new TermDeclarationReader().query(
    scan.trmFiles,
    { ...options, operation: 'check' },
    scan.diagnostics,
  );
  if (!result.diagnostics.length) {
    try {
      new SkillReading(
        scan.trmFiles
          .flatMap((f) => f.parsed?.termDeclarations ?? [])
          .map((termDeclaration) =>
            new TermDeclarationProjection().termDeclaration(termDeclaration),
          ),
        scan.trmFiles.flatMap((f) => f.parsed?.relations ?? []),
      );
    } catch (error) {
      if (!(error instanceof AtermError)) throw error;
      return {
        ...result,
        diagnostics: [{ file: config.home.configPath, line: 1, message: error.message }],
      };
    }
  }
  return result;
}

export function matchSourceVersion(expected?: string, actual?: string) {
  if (expected !== undefined && expected !== actual)
    throw new AtermError('file.conflict', 'File version does not match; read it again.');
}
export function requireValidCorpus(
  diagnostics: readonly { file: string; line: number; message: string }[],
) {
  if (diagnostics.length)
    throw new AtermError(
      'authoring.invalid',
      diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`).join('\n') +
        '\nUse file read/write to repair invalid content.',
    );
}
