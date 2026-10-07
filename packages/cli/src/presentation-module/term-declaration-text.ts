import { ListTable } from './list-table.js';
import { alignedTable } from './table.js';
import {
  AtermError,
  TextMatching,
  type ITermDeclarationResult,
  type ITermDeclarationDiff,
  type IAtermEditResult,
} from '@garage49/aterm-core';
import { TermDeclarationTree } from './term-declaration-tree.js';
type TermDeclaration = ITermDeclarationResult['termDeclarations'][number];
type Edge = ITermDeclarationResult['edges'][number];
type ConceptMap = NonNullable<ITermDeclarationResult['conceptMap']>;

/** Finite terminal presentation; Remarks never appears as a Term Declaration. */
export class TermDeclarationText {
  render(
    result: ITermDeclarationResult | ITermDeclarationDiff | IAtermEditResult,
    withFileline = false,
    detail = false,
    tree = false,
  ): string {
    if ('terms' in result) return this.edits(result);
    if ('diff' in result) return result.diff || 'No Aterm changes.\n';
    // The result names its own operation; nothing about the invocation reaches presentation.
    const warnings =
      result.operation === 'check'
        ? ''
        : (result.warnings ?? []).map((w) => `// Warning: ${w.message}`).join('\n');
    return (
      (warnings ? warnings + '\n' : '') +
      (tree && result.operation === 'list'
        ? new TermDeclarationTree().render(result.termDeclarations, withFileline)
        : this.content(result.operation, result, withFileline, detail))
    );
  }
  /**
   * One section of each Term Declaration, verbatim and nothing else: no Term header, no fence, no
   * annotation, so the text can be consumed as the content itself. Term Declarations lacking the
   * section are omitted; none having it is an error, since the caller asked for what is not there.
   */
  field(result: ITermDeclarationResult, key: string, caseSensitive = false): string {
    const matching = new TextMatching(caseSensitive);
    const found = result.termDeclarations.flatMap((d) => {
      return d.sections
        .filter((s) => matching.equals(s.key, key))
        .map((section) => section.content.replace(/\s+$/, ''));
    });
    if (!found.length)
      throw new AtermError(
        'cli.section',
        `No selected Term declares a section ${key}; sections are ` +
          [...new Set(result.termDeclarations.flatMap((d) => d.sections.map((s) => s.key)))].join(
            ', ',
          ) +
          '.',
      );
    return found.join('\n\n') + '\n';
  }
  private content(
    command: string,
    result: ITermDeclarationResult,
    withFileline: boolean,
    detail: boolean,
  ): string {
    const defs = result.termDeclarations;
    if (command === 'relations')
      return result.relations?.length
        ? result.relations.map((r) => this.conceptRelation(r, false, withFileline)).join('\n') +
            '\n'
        : 'No relations.\n';
    if (result.conceptMap) return this.concepts(result.conceptMap, withFileline);
    if (command === 'check') {
      const issues = [
        ...result.diagnostics,
        ...(result.warnings ?? []).map((w) => ({ ...w, message: 'Warning: ' + w.message })),
      ];
      return issues.length
        ? issues
            .map((d) =>
              withFileline
                ? `${d.file}:${d.line}: ${d.message}`
                : result.files.reduce(
                    (message, file) => message.split(file).join('[source]'),
                    d.message,
                  ),
            )
            .join('\n') + '\n'
        : `Checked ${result.files.length} Aterm files, ${defs.length} Term Declarations. No diagnostics.\n`;
    }
    if (command === 'path')
      return result.paths?.length
        ? result.paths.map((p) => p.join(' > ')).join('\n') + '\n'
        : 'No path.\n';
    if (command === 'grep') {
      const blocks = result.occurrences?.length
        ? result.occurrences
            .map(
              (o) =>
                `${o.termKind} ${o.term}:${o.lines[0]!.line}-${o.lines.at(-1)!.line}${withFileline && o.file ? `  // ${o.file}:${o.line}` : ''}\n${o.lines.map((l) => `${l.line} | ${l.text}`).join('\n')}`,
            )
            .join('\n\n')
        : '';
      const external = (result.externalOccurrences ?? []).map(
        (o) => `ext.${o.source}: ${o.file}:${o.line}:${o.column} ${o.term}\n  ${o.text}`,
      );
      const all = [blocks, ...external].filter(Boolean);
      return all.length ? all.join('\n\n') + '\n' : 'No references.\n';
    }
    if (command === 'list') return alignedTable(ListTable.terms(defs, withFileline)) + '\n';
    if (!defs.length && command !== 'search') return 'No matches.\n';
    if (command === 'search') {
      const corpus = (result.matches ?? []).map(
        (m) =>
          `${m.termDeclaration.id}  ${m.termDeclaration.termKind}  ${this.viewpoint(m.termDeclaration)}${withFileline ? `  ${m.termDeclaration.file}:${m.termDeclaration.line}` : ''}\n  ${m.section}: ${m.text}`,
      );
      const external = (result.externalMatches ?? []).map(
        (match) =>
          `ext.${match.source}: ${match.file}:${match.line}:${match.column}\n  ${match.text}`,
      );
      const blocks = [...corpus, ...external];
      return blocks.length ? blocks.join('\n\n') + '\n' : 'No matches.\n';
    }
    return (
      defs
        .map((d) =>
          [
            `// Knowledge: ${d.knowledge}`,
            `// Viewpoint: ${this.viewpoint(d)}`,
            ...(command === 'view' && detail && d.scope
              ? ['', '// Scope:', ...d.scope.content.split('\n').map((line) => '// ' + line)]
              : []),
            '',
            ...(command === 'view' && detail ? ['// Declaration:'] : []),
            command === 'view' && detail
              ? this.locatedBody(d)
              : this.body(d, result.includeRemarks, withFileline),
            ...(command === 'view' && detail
              ? [
                  '',
                  '// References:',
                  this.edges(
                    result.edges.filter((e) => e.source === d.id),
                    'target',
                    withFileline,
                  ),
                  '',
                  '// Referenced by:',
                  this.edges(
                    result.edges.filter((e) => e.target === d.id),
                    'source',
                    withFileline,
                  ),
                ]
              : []),
          ].join('\n'),
        )
        .join('\n\n') + '\n'
    );
  }
  private concepts(map: ConceptMap, withFileline: boolean): string {
    const selected = new Set(map.selected);
    const terms = map.selected.flatMap((name) =>
      map.terms
        .filter((t) => t.id === name)
        .flatMap((term) =>
          term.termDeclarations.map((termDeclaration) => ({ name: term.id, ...termDeclaration })),
        ),
    );
    const nameWidth = Math.max(0, ...terms.map((t) => t.name.length));
    const termKindWidth = Math.max(0, ...terms.map((t) => (t.viewpoint ?? 'Unclassified').length));
    const rows = terms.map(
      (t) =>
        `${t.name.padEnd(nameWidth)}  ${t.termKind}  ${(t.viewpoint ?? 'Unclassified').padEnd(termKindWidth)}  ${t.definition.replace(/\s+/g, ' ').trim()}${withFileline ? `  // ${t.file}:${t.line}` : ''}`,
    );
    const sections: string[] = ['## Terms\n\n' + rows.join('\n')];
    if (map.paths) {
      map.paths.forEach((path, index) => {
        const heading = `## Path #${index + 1}${selected.size > 2 ? `: ${path[0]} → ${path.at(-1)}` : ''}`;
        const lines = path.slice(1).map((target, i) => {
          const source = path[i]!;
          // BFS and the union preserve stable edge order, including parallel edges.
          const relation = map.relations.find(
            (r) =>
              (r.source === source && r.target === target) ||
              (r.source === target && r.target === source),
          );
          if (!relation) throw new Error(`Missing Relation for path step ${source} → ${target}.`);
          return this.conceptRelation(relation, relation.source !== source, withFileline);
        });
        sections.push([heading, '', ...lines].join('\n'));
      });
      for (const pair of map.disconnected ?? []) sections.push(`No path: ${pair.join(' → ')}`);
    } else {
      sections.push(
        '## Relations\n\n' +
          (map.relations.length
            ? map.relations
                .map((r) =>
                  this.conceptRelation(
                    r,
                    !selected.has(r.source) && selected.has(r.target),
                    withFileline,
                  ),
                )
                .join('\n')
            : 'No relations.'),
      );
    }
    return sections.filter(Boolean).join('\n\n') + '\n';
  }
  private conceptRelation(
    r: ConceptMap['relations'][number],
    reverse: boolean,
    withFileline: boolean,
  ): string {
    const text = reverse
      ? `${r.target} ← ${r.phrase} — ${r.source}`
      : `${r.source} ${r.phrase} ${r.target}`;
    return (
      text +
      (withFileline && r.locations.length
        ? '  // ' + r.locations.map((l) => `${l.file}:${l.line}`).join(', ')
        : '')
    );
  }
  private viewpoint(d: TermDeclaration): string {
    return d.viewpoint ?? 'Unclassified';
  }
  private locatedBody(d: TermDeclaration): string {
    if (!d.sourceLines) return `// ${d.file}:${d.line}-${d.endLine}\nSource lines unavailable.`;
    const width = String(d.endLine - d.line + 1).length;
    return [
      `// ${d.file}:${d.line}-${d.endLine}`,
      ...d.sourceLines.map(
        (line) => `${String(line.line - d.line + 1).padStart(width)} | ${line.text}`,
      ),
    ].join('\n');
  }
  private edits(result: IAtermEditResult): string {
    const lines = [`${result.dryRun ? 'Preview' : 'Updated'}: ${result.terms.join(', ')}`];
    for (const file of result.files) {
      const before = file.before.split(/\r?\n/);
      const after = file.after.split(/\r?\n/);
      let start = 0;
      while (start < before.length && start < after.length && before[start] === after[start])
        start++;
      let oldEnd = before.length,
        newEnd = after.length;
      while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      lines.push(
        `--- ${file.path}`,
        `+++ ${file.path}`,
        `@@ -${start + 1},${oldEnd - start} +${start + 1},${newEnd - start} @@`,
        ...before.slice(start, oldEnd).map((l) => '-' + l),
        ...after.slice(start, newEnd).map((l) => '+' + l),
      );
    }
    if (!result.files.length) lines.push('No changes.');
    for (const impact of result.derivedImpacts)
      lines.push(`Review derived guidance: ${impact.term} (source: ${impact.sources.join(', ')})`);
    lines.push(...result.warnings.map((w) => 'Warning: ' + w));
    return lines.join('\n') + '\n';
  }
  private body(d: TermDeclaration, remarks: boolean, withFileline: boolean): string {
    if (d.sourceLines)
      return [
        ...(withFileline ? [`// ${d.file}:${d.line}`] : []),
        ...d.sourceLines
          .filter(
            (l) =>
              remarks ||
              d.remarksLine === undefined ||
              l.line < d.remarksLine ||
              l.line === d.endLine,
          )
          .map((l) => l.text),
      ].join('\n');
    const indent = (text: string) => text.split('\n').map((l) => (l ? '  ' + l : ''));
    if (d.fence === '}') {
      // Keyed declarations reproduce every Schema-keyed section; the first (definition) has no
      // header, and a lone single-line definition is written as a one-line Term Declaration. The
      // projection has already dropped `remarks` when it was not requested.
      const [first, ...rest] = d.sections;
      const fileline = withFileline ? [`// ${d.file}:${d.line}`] : [];
      if (first && !rest.length && !first.content.includes('\n'))
        return [
          ...fileline,
          `${d.termKind} ${d.name}${d.group ? ` in ${d.group}` : ''} = { ${first.content} }`,
        ].join('\n');
      return [
        ...fileline,
        `${d.termKind} ${d.name}${d.group ? ` in ${d.group}` : ''} = {`,
        ...(first ? indent(first.content) : []),
        ...rest.flatMap((s) => ['.' + s.key, ...indent(s.content)]),
        '}',
      ].join('\n');
    }
    return [
      ...(withFileline ? [`// ${d.file}:${d.line}`] : []),
      `${d.termKind} ${d.name}${d.group ? ` in ${d.group}` : ''} = ${d.fence + d.language}`,
      ...indent(d.definition),
      ...d.sections
        .slice(1)
        .filter((s) => remarks || s.key !== 'remarks')
        .flatMap((s) => [
          s.key === 'relations' ? '.relations' : '---' + s.filetype,
          ...indent(s.content),
        ]),
      d.fence,
    ].join('\n');
  }
  private edges(
    edges: readonly Edge[],
    direction: 'source' | 'target',
    withFileline: boolean,
  ): string {
    const names = new Map<string, Set<string>>();
    for (const edge of [
      ...edges.filter((e) => e.origin === 'relation'),
      ...edges.filter((e) => e.origin === 'explicit'),
    ]) {
      const locations = names.get(edge[direction]) ?? new Set<string>();
      for (const location of edge.locations) locations.add(`${location.file}:${location.line}`);
      names.set(edge[direction], locations);
    }
    return names.size
      ? '  ' +
          [...names]
            .map(
              ([name, locations]) =>
                name + (withFileline && locations.size ? ` (${[...locations].join(', ')})` : ''),
            )
            .join(', ')
      : '  None.';
  }
}
