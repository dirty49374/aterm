import { ListTable } from './list-table.js';
import { alignedTable } from './table.js';
import {
  AtermError,
  SectionExpansion,
  TextMatching,
  byText,
  groupTree,
  type IAtermSection,
  type ITermDeclarationResult,
  type ITermDeclarationView,
  type IGroupTreeNode,
} from '@garage49/aterm-core';
import type { IResultContext } from './output.js';
import { codeBlock, table } from './markdown.js';

/** A reading of the supplied result; no filesystem access and no source rewriting. */
export class TermDeclarationMarkdown {
  private readonly expansion: SectionExpansion;
  constructor(private readonly result: ITermDeclarationResult) {
    this.expansion = new SectionExpansion(
      [...(result.sectionContext ?? []), ...result.termDeclarations],
      result.includeRemarks,
    );
  }

  render(options: IResultContext = {}): string {
    const { operation } = this.result;
    const warnings = (this.result.warnings ?? []).map(
      (w) => `- Warning: ${this.diagnostic(w, options)}`,
    );
    const content = this.content(options);
    if (options.section !== undefined && (operation === 'show' || operation === 'view'))
      return content;
    return [...(operation === 'check' ? [] : warnings), content].filter(Boolean).join('\n\n');
  }

  private content(options: IResultContext): string {
    const result = this.result;
    const { termDeclarations, operation } = result;
    if (operation === 'show' || operation === 'view') {
      if (options.section !== undefined) {
        const matching = new TextMatching(options.caseSensitive);
        const sections = termDeclarations.flatMap((termDeclaration) =>
          termDeclaration.sections
            .filter((s) => matching.equals(s.key, options.section!))
            .map((s) => this.section(termDeclaration, s)),
        );
        if (!sections.length)
          throw new AtermError(
            'cli.section',
            `No selected Term declares a section ${options.section}; sections are ${[...new Set(termDeclarations.flatMap((e) => e.sections.map((s) => s.key)))].join(', ')}.`,
          );
        return sections.join('\n\n\n');
      }
      const qualified = new Set(termDeclarations.map((e) => e.knowledge)).size > 1;
      return (
        termDeclarations
          .map((termDeclaration) => {
            const blocks = [
              `## ${termDeclaration.termKind} ${qualified ? termDeclaration.id : termDeclaration.name}`,
            ];
            if (options.withFileline)
              blocks.push(`Source: ${termDeclaration.file}:${termDeclaration.line}`);
            for (const section of termDeclaration.sections) {
              if (!result.includeRemarks && section.key === 'remarks') continue;
              if (section.key !== 'definition') blocks.push(`### ${section.key}`);
              blocks.push(this.section(termDeclaration, section));
            }
            if (options.detail && operation === 'view') {
              blocks.push(
                '### source',
                `${termDeclaration.file}:${termDeclaration.line}-${termDeclaration.endLine}`,
                codeBlock(
                  (termDeclaration.sourceLines ?? [])
                    .map((l) => `${l.line - termDeclaration.line + 1} | ${l.text}`)
                    .join('\n'),
                  'trm',
                ),
              );
              for (const [title, direction] of [
                ['references', 'target'],
                ['referenced by', 'source'],
              ] as const) {
                const edges = result.edges.filter(
                  (e) => (direction === 'target' ? e.source : e.target) === termDeclaration.id,
                );
                const targets = new Map<string, Set<string>>();
                for (const edge of edges) {
                  const locations = targets.get(edge[direction]) ?? new Set<string>();
                  for (const location of edge.locations)
                    locations.add(`${location.file}:${location.line}`);
                  targets.set(edge[direction], locations);
                }
                blocks.push(
                  `### ${title}`,
                  [...targets]
                    .map(
                      ([id, locations]) =>
                        `- ${id}${options.withFileline && locations.size ? ` — ${[...locations].join(', ')}` : ''}`,
                    )
                    .join('\n') || 'None.',
                );
              }
            }
            return blocks.filter(Boolean).join('\n\n');
          })
          .join('\n\n\n') || 'No matches.'
      );
    }
    if (operation === 'list') {
      if (options.tree)
        return termDeclarations.length ? this.tree(options.withFileline) : 'No matches.';
      return alignedTable(ListTable.terms(termDeclarations, options.withFileline), true);
    }
    if (operation === 'search') {
      const matches = (result.matches ?? []).map(
        (m) =>
          `## ${m.termDeclaration.termKind} ${m.termDeclaration.id}\n\n${m.section}${options.withFileline ? ` — ${m.termDeclaration.file}:${m.termDeclaration.line}` : ''}\n\n${codeBlock(m.text)}`,
      );
      const external = (result.externalMatches ?? []).map(
        (m) => `## ext.${m.source}: ${m.file}:${m.line}:${m.column}\n\n${codeBlock(m.text)}`,
      );
      return [...matches, ...external].join('\n\n') || 'No matches.';
    }
    if (operation === 'grep') {
      const occurrences = (result.occurrences ?? []).map(
        (o) =>
          `## ${o.termKind} ${o.term}${options.withFileline ? ` — ${o.file}:${o.line}` : ''}\n\n${codeBlock(o.lines.map((l) => `${l.line} | ${l.text}`).join('\n'), 'trm')}`,
      );
      const external = (result.externalOccurrences ?? []).map(
        (o) => `## ext.${o.source}: ${o.file}:${o.line}:${o.column}\n\n${codeBlock(o.text)}`,
      );
      return [...occurrences, ...external].join('\n\n') || 'No references.';
    }
    if (operation === 'check') {
      const issues = [
        ...result.diagnostics.map((d) => '- ' + this.diagnostic(d, options)),
        ...(result.warnings ?? []).map((d) => '- Warning: ' + this.diagnostic(d, options)),
      ];
      return [
        `Checked ${result.files.length} Aterm files, ${termDeclarations.length} Term Declarations.`,
        issues.join('\n') || 'No diagnostics.',
      ].join('\n\n');
    }
    if (operation === 'path')
      return result.paths?.map((path) => '- ' + path.join(' → ')).join('\n') || 'No path.';
    const map = result.conceptMap;
    const relations = map?.relations ?? result.relations ?? [];
    const blocks: string[] = [];
    if (map) {
      blocks.push('## Terms');
      const selected = new Set(map.selected);
      blocks.push(
        table(
          ['Term', 'Term Kind', 'Definition', ...(options.withFileline ? ['Source'] : [])],
          map.terms
            .filter((t) => selected.has(t.id))
            .flatMap((t) =>
              t.termDeclarations.map((e) => [
                t.id,
                e.termKind,
                e.definition,
                ...(options.withFileline ? [`${e.file}:${e.line}`] : []),
              ]),
            ),
        ),
      );
      if (map.paths)
        blocks.push(
          '## Paths',
          map.paths.map((path, i) => `- Path ${i + 1}: ${path.join(' → ')}`).join('\n'),
        );
      blocks.push(...(map.disconnected ?? []).map((pair) => `No path: ${pair.join(' → ')}`));
    }
    if (map) blocks.push('## Relations');
    blocks.push(
      relations.length
        ? table(
            ['Source', 'Phrase', 'Target', ...(options.withFileline ? ['Location'] : [])],
            relations.map((r) => [
              r.source,
              r.phrase,
              r.target,
              ...(options.withFileline
                ? [r.locations.map((l) => `${l.file}:${l.line}`).join(', ')]
                : []),
            ]),
          )
        : 'No relations.',
    );
    return blocks.filter(Boolean).join('\n\n');
  }

  private diagnostic(
    value: { file: string; line: number; message: string },
    options: IResultContext,
  ): string {
    return options.withFileline
      ? `${value.file}:${value.line}: ${value.message}`
      : this.result.files.reduce((text, file) => text.split(file).join('[source]'), value.message);
  }

  private section(termDeclaration: ITermDeclarationView, section: IAtermSection): string {
    const content = this.expansion.render(termDeclaration, section);
    return section.key === 'relations'
      ? content
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => '- ' + line)
          .join('\n')
      : content;
  }

  private tree(withFileline = false): string {
    const files = new Map(this.result.termDeclarations.map((e) => [e.knowledge, e.file]));
    const lines: string[] = [];
    const count = (node: IGroupTreeNode<ITermDeclarationView>): number =>
      node.termDeclarations.length + node.children.reduce((sum, child) => sum + count(child), 0);
    const visit = (node: IGroupTreeNode<ITermDeclarationView>, depth: number) => {
      const indent = '  '.repeat(depth);
      lines.push(
        `${indent}- ${node.group ? `${node.group.split('.').at(-1)} (${count(node)})` : `${files.get(node.knowledge)} — @knowledge ${node.knowledge} (${count(node)} ${count(node) === 1 ? 'Term Declaration' : 'Term Declarations'})`}`,
      );
      for (const child of node.children) visit(child, depth + 1);
      for (const termDeclaration of node.termDeclarations)
        lines.push(
          `${indent}  - ${termDeclaration.termKind} ${termDeclaration.name}${withFileline ? ` — ${termDeclaration.file}:${termDeclaration.line}` : ''}`,
        );
    };
    for (const root of groupTree(this.result.termDeclarations).sort((a, b) =>
      byText(files.get(a.knowledge)!, files.get(b.knowledge)!),
    ))
      visit(root, 0);
    return lines.join('\n');
  }
}
