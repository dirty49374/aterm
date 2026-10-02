import { termTokens } from '../syntax-module/identity.js';
import type { IExternalFile } from './files.js';
import { byText } from '../order.js';
import { TextMatching } from '../matching.js';

export interface IExternalReference extends IExternalMatch {
  readonly term: string;
}

const termToken = termTokens('external');

export interface IExternalMatch {
  readonly source: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

/** Literal external text: no inferred code identifiers or language-specific syntax. */
export class ExternalText {
  search(
    files: readonly IExternalFile[],
    phrase: string,
    caseSensitive = false,
  ): readonly IExternalMatch[] {
    const matcher = new TextMatching(caseSensitive).literal(phrase);
    return files
      .flatMap((file) =>
        file.text.split(/\r\n|\n|\r/).flatMap((text, at) => {
          const found = matcher.exec(text);
          return found
            ? file.externalSources.map((source) => ({
                source,
                file: file.path,
                line: at + 1,
                column: found.index + 1,
                text,
              }))
            : [];
        }),
      )
      .sort(byLocation);
  }

  references(
    files: readonly IExternalFile[],
    names: ReadonlySet<string>,
    caseSensitive = true,
  ): readonly IExternalReference[] {
    const matching = new TextMatching(caseSensitive);
    const selected = new Set([...names].map((name) => matching.normalize(name)));
    const tokens = new RegExp(termToken.source, caseSensitive ? 'gu' : 'giu');
    return files
      .flatMap((file) =>
        file.text.split(/\r\n|\n|\r/).flatMap((text, at) =>
          [...text.matchAll(tokens)]
            .filter((match) => selected.has(matching.normalize(match[0])))
            .flatMap((match) =>
              file.externalSources.map((source) => ({
                source,
                term: match[0],
                file: file.path,
                line: at + 1,
                column: match.index + 1,
                text,
              })),
            ),
        ),
      )
      .sort(byLocation);
  }

  /** One pass over original tokens prevents cascading a rename into another rename. */
  rename(text: string, mapping: ReadonlyMap<string, string>): string {
    return text.replace(termToken, (name) => mapping.get(name) ?? name);
  }
}

function byLocation(a: IExternalMatch, b: IExternalMatch): number {
  return (
    byText(a.source, b.source) || byText(a.file, b.file) || a.line - b.line || a.column - b.column
  );
}
