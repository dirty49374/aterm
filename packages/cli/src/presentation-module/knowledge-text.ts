import type { IKnowledgeResult } from '@agent-workshop/aterm-core';
import { ListTable } from './list-table.js';
import { alignedTable } from './table.js';

export class KnowledgeText {
  render(result: IKnowledgeResult): string {
    if (!result.selected) return alignedTable(ListTable.knowledges(result)) + '\n';
    if (!result.knowledges.length) return 'No Knowledges.\n';
    return (
      result.knowledges
        .map((knowledge) =>
          [
            `## ${knowledge.id}`,
            ...(knowledge.description ? [knowledge.description.content] : []),
            `${knowledge.termCount} Terms · ${knowledge.termDeclarationCount} Term Declarations\nSource: ${knowledge.file}\nViewpoints: ${knowledge.viewpoints.join(', ')}`,
            ...(knowledge.scope ? ['### Scope', knowledge.scope.content] : []),
            '### Declarations',
            alignedTable({
              headers: ['Term', 'Term Kind', 'Group'],
              rows: knowledge.termDeclarations.map((termDeclaration) => [
                termDeclaration.id,
                termDeclaration.termKind,
                termDeclaration.group ?? '',
              ]),
            }),
          ].join('\n\n'),
        )
        .join('\n\n') + '\n'
    );
  }
}
