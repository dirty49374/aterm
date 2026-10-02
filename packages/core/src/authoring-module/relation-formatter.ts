import { byText } from '../order.js';
import { AtermError } from '../error.js';
import type { IParsedFile } from '../syntax-module/index.js';
import { TermDeclarationIndex } from '../query-module/registry.js';

/** Sort adjacent assertions only; never detach supporting prose or change ownership. */
export class RelationFormatter {
  plan(
    parsed: ReadonlyMap<string, IParsedFile>,
    texts: ReadonlyMap<string, string>,
    termPatterns: readonly string[],
    knowledge?: string,
    selectedFiles?: ReadonlySet<string>,
  ) {
    const index = new TermDeclarationIndex([...parsed.values()]);
    if (index.diagnostics.length)
      throw new AtermError('aterm.invalid', index.diagnostics.map((d) => d.message).join('\n'));
    const selected = new Set(
      index
        .select(termPatterns.length ? termPatterns : ['*'], knowledge)
        .filter((termDeclaration) => !selectedFiles || selectedFiles.has(termDeclaration.file))
        .map((d) => d.id),
    );
    const result = new Map<string, string>();
    const terms = new Set<string>();
    for (const [file, text] of texts) {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(/\r?\n/);
      const relations = index.relations
        .filter((r) => r.file === file && selected.has(r.source))
        .sort((a, b) => a.line - b.line);
      for (let i = 0; i < relations.length; ) {
        const group = [relations[i++]!];
        const prefix = lines[group[0]!.line - 1]!.match(/^[ \t]*/)![0];
        if (prefix !== '  ') continue;
        while (
          i < relations.length &&
          relations[i]!.line === group.at(-1)!.line + 1 &&
          lines[relations[i]!.line - 1]!.match(/^[ \t]*/)![0] === prefix
        )
          group.push(relations[i++]!);
        const sorted = [...group].sort(
          (a, b) => byText(a.phrase, b.phrase) || byText(a.target, b.target),
        );
        const values = sorted.map((r) => lines[r.line - 1]!);
        group.forEach((r, n) => {
          lines[r.line - 1] = values[n]!;
          terms.add(r.source);
        });
      }
      const after = lines.join(eol);
      if (after !== text) result.set(file, after);
    }
    return { texts: result, terms: [...terms] };
  }
}
