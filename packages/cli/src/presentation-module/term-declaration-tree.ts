import { byText, groupTree, type ITermDeclarationView, type IGroupTreeNode } from '@aterm/core';

interface ITreeRow {
  readonly label: string;
  readonly count: number;
  readonly children: readonly ITreeRow[];
}

/** File / authored Group / Term Declaration presentation of an already selected result. */
export class TermDeclarationTree {
  render(termDeclarations: readonly ITermDeclarationView[], withFileline = false): string {
    if (!termDeclarations.length) return 'No matches.\n';
    const files = new Map(
      termDeclarations.map((termDeclaration) => [termDeclaration.knowledge, termDeclaration.file]),
    );
    const row = (node: IGroupTreeNode<ITermDeclarationView>): ITreeRow => {
      const children = [
        ...node.children.map(row),
        ...node.termDeclarations.map((termDeclaration) => ({
          label: `${termDeclaration.termKind} ${termDeclaration.name} [${termDeclaration.viewpoint ?? 'Unclassified'}]${withFileline ? `  // ${termDeclaration.file}:${termDeclaration.line}` : ''}`,
          count: 1,
          children: [],
        })),
      ];
      const count = children.reduce((total, child) => total + child.count, 0);
      return {
        label: node.group
          ? `${node.group.split('.').at(-1)} (${count})`
          : `${files.get(node.knowledge)} — @knowledge ${node.knowledge} (${count} ${count === 1 ? 'Term Declaration' : 'Term Declarations'})`,
        count,
        children,
      };
    };
    const lines: string[] = [];
    const append = (children: readonly ITreeRow[], prefix: string): void => {
      children.forEach((child, index) => {
        const last = index === children.length - 1;
        lines.push(prefix + (last ? '└── ' : '├── ') + child.label);
        append(child.children, prefix + (last ? '    ' : '│   '));
      });
    };
    for (const root of groupTree(termDeclarations).sort((a, b) =>
      byText(files.get(a.knowledge)!, files.get(b.knowledge)!),
    )) {
      const file = row(root);
      if (lines.length) lines.push('');
      lines.push(file.label);
      append(file.children, '');
    }
    return lines.join('\n') + '\n';
  }
}
