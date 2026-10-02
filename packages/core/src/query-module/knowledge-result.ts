import type { IKnowledgeText } from '../syntax-module/index.js';
import { AtermError } from '../error.js';
import { byText } from '../order.js';
import type { ITrmFile } from '../corpus-module/index.js';
import type { ITermDeclarationView } from './projection.js';
import { GlobPattern } from './pattern.js';

export interface IKnowledgeView {
  readonly id: string;
  readonly file: string;
  readonly viewpoints: readonly string[];
  readonly description?: IKnowledgeText;
  readonly scope?: IKnowledgeText;
  readonly termCount: number;
  readonly termDeclarationCount: number;
  readonly termDeclarations: readonly Pick<
    ITermDeclarationView,
    'id' | 'name' | 'termKind' | 'group' | 'line'
  >[];
}
export interface IKnowledgeResult {
  readonly operation: 'knowledge-list' | 'knowledge-view';
  readonly selected: boolean;
  readonly knowledges: readonly IKnowledgeView[];
}

/** Knowledge discovery uses the validated corpus, including Knowledges without Term Declarations. */
export class KnowledgeReading {
  read(
    trmFiles: readonly ITrmFile[],
    termDeclarations: readonly ITermDeclarationView[],
    operation: IKnowledgeResult['operation'],
    ids: readonly string[] = [],
    caseSensitive = false,
  ): IKnowledgeResult {
    if (operation === 'knowledge-view' && !ids.length)
      throw new AtermError('knowledge.selection', 'Knowledge view requires at least one ID.');
    const all = trmFiles.filter((trmFile) => trmFile.parsed?.knowledge);
    const patterns = ids.map((id) => new GlobPattern(id, caseSensitive));
    for (const pattern of patterns)
      if (!pattern.isGlob && !all.some((d) => pattern.matches(d.parsed!.knowledge!)))
        throw new AtermError(
          'knowledge.unknown',
          `Unknown Knowledge ${pattern.text}; use aterm knowledge list.`,
        );
    return {
      operation,
      selected: operation === 'knowledge-view',
      knowledges: all
        .filter((d) => !patterns.length || patterns.some((p) => p.matches(d.parsed!.knowledge!)))
        .map((trmFile) => {
          const id = trmFile.parsed!.knowledge!;
          const members = termDeclarations.filter(
            (termDeclaration) => termDeclaration.knowledge === id,
          );
          return {
            id,
            file: trmFile.absolutePath,
            viewpoints: trmFile.viewpoints ?? [],
            ...(trmFile.parsed!.description ? { description: trmFile.parsed!.description } : {}),
            ...(trmFile.parsed!.scope ? { scope: trmFile.parsed!.scope } : {}),
            termCount: new Set(members.map((termDeclaration) => termDeclaration.id)).size,
            termDeclarationCount: members.length,
            termDeclarations: members.map(({ id, name, termKind, group, line }) => ({
              id,
              name,
              termKind,
              group,
              line,
            })),
          };
        })
        .sort((a, b) => byText(a.id, b.id)),
    };
  }
}
