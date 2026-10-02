import type { ITermDeclarationResult, IKnowledgeResult, IViewpointResult } from '@agent-workshop/aterm-core';
import type { ITable } from './table.js';

/** Lists share their columns and rows across terminal and Markdown output. */
export class ListTable {
  static terms(
    termDeclarations: ITermDeclarationResult['termDeclarations'],
    withFileline = false,
  ): ITable {
    return {
      headers: ['Term', 'Term Kind', 'Viewpoint', ...(withFileline ? ['Source'] : [])],
      rows: termDeclarations.map((termDeclaration) => [
        termDeclaration.id,
        termDeclaration.termKind,
        termDeclaration.viewpoint ?? 'Unclassified',
        ...(withFileline ? [`${termDeclaration.file}:${termDeclaration.line}`] : []),
      ]),
    };
  }
  static knowledges(result: IKnowledgeResult): ITable {
    return {
      headers: ['Knowledge', 'Terms', 'Viewpoints', 'Description'],
      rows: result.knowledges.map((knowledge) => [
        knowledge.id,
        String(knowledge.termCount),
        knowledge.viewpoints.join(', '),
        knowledge.description?.content ?? '',
      ]),
    };
  }
  static viewpoints(result: IViewpointResult): ITable {
    return {
      headers: ['Viewpoint', 'Description'],
      rows: result.viewpoints.map((viewpoint) => [viewpoint.name, viewpoint.description]),
    };
  }
}
