import { ViewpointText } from './viewpoint-text.js';
import { skillText } from './skill-text.js';
import { DiscoveryText } from './discovery-text.js';
import { ListTable } from './list-table.js';
import { alignedTable } from './table.js';
import type { AtermResult, IViewpointResult } from '@agent-workshop/aterm-core';
import { TermDeclarationMarkdown } from './term-declaration-markdown.js';
import { TermDeclarationText } from './term-declaration-text.js';
import type { IResultContext } from './output.js';
import { codeBlock, markdownEnd, table } from './markdown.js';

/** Generated readings share Markdown framing; original files retain their authored form. */
export class ResultMarkdown {
  render(value: AtermResult, context: IResultContext = {}): string {
    if ('operation' in value && value.operation === 'jq')
      return markdownEnd(codeBlock(JSON.stringify(value.values, null, 2), 'json'));
    if ('operation' in value && value.operation === 'graphql')
      return markdownEnd(codeBlock(JSON.stringify(value.response, null, 2), 'json'));
    if ('skills' in value) return markdownEnd(skillText(value, true));
    if ('candidates' in value)
      return markdownEnd(new DiscoveryText().render(value, context.detail, true));
    if ('cachedChunks' in value)
      return markdownEnd(codeBlock(new DiscoveryText().render(value), 'text'));
    if ('viewpoints' in value && value.selected && value.viewpoints.length)
      return new ViewpointText().render(value);
    let content: string;
    if ('ambiguity' in value && value.ambiguity) {
      const { candidates, hint } = value.ambiguity;
      content = [
        '## Ambiguous Term',
        table(
          ['Term', 'Term Kinds'],
          candidates.map((c) => [c.id, c.termDeclarations.map((e) => e.termKind).join(', ')]),
        ),
        hint,
      ].join('\n\n');
    } else if ('selected' in value && 'knowledges' in value)
      content = value.selected
        ? value.knowledges
            .map((k) =>
              [
                `## ${k.id}`,
                ...(k.description ? [k.description.content] : []),
                `${k.termCount} Terms · ${k.termDeclarationCount} Term Declarations`,
                `Source: ${k.file}`,
                `Viewpoints: ${k.viewpoints.join(', ')}`,
                ...(k.scope ? ['### Scope', k.scope.content] : []),
                '### Declarations',
                table(
                  ['Term', 'Term Kind', 'Group'],
                  k.termDeclarations.map((e) => [e.id, e.termKind, e.group ?? '']),
                ),
              ].join('\n\n'),
            )
            .join('\n\n') || 'No Knowledges.'
        : alignedTable(ListTable.knowledges(value), true);
    else if ('viewpoints' in value)
      content = value.selected ? 'No viewpoints.' : alignedTable(ListTable.viewpoints(value), true);
    else if ('diff' in value)
      content = value.diff ? codeBlock(value.diff, 'diff') : 'No Aterm changes.';
    else if ('terms' in value) content = codeBlock(new TermDeclarationText().render(value), 'diff');
    else content = new TermDeclarationMarkdown(value).render(context);
    return markdownEnd(content);
  }

  record(value: unknown): string {
    const rows = Object.entries((value ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
    ]);
    return markdownEnd(table(['Field', 'Value'], rows));
  }

  private viewpoints(result: IViewpointResult): string {
    if (!result.viewpoints.length) return 'No viewpoints.';
    return result.viewpoints
      .map((viewpoint) => {
        const blocks = [`## ${viewpoint.name}`, viewpoint.description];
        for (const termKind of viewpoint.termKinds) {
          blocks.push(`### ${termKind.name}`, termKind.description);
          if (result.selected)
            for (const section of termKind.sections) {
              blocks.push(`#### ${section.name}`);
              if (section.description) blocks.push(section.description);
              for (const question of section.questions ?? [])
                blocks.push(`- ${question.ask}${question.frame ? ` ${question.frame}` : ''}`);
              if (section.example !== undefined) blocks.push(codeBlock(section.example, 'trm'));
            }
        }
        if (result.selected && viewpoint.guidance !== undefined) blocks.push(viewpoint.guidance);
        return blocks.join('\n\n');
      })
      .join('\n\n');
  }
}
