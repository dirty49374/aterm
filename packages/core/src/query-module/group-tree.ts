import { byText } from '../order.js';
import type { ITermDeclaration } from '../syntax-module/model.js';
import { termKindIdentity } from '../syntax-module/term-kind.js';

export interface IGroupTreeNode<T> {
  readonly knowledge: string;
  /** Empty for the Knowledge root; otherwise the complete authored Group path. */
  readonly group: string;
  readonly termDeclarations: T[];
  readonly children: IGroupTreeNode<T>[];
}

/** Derive the authored hierarchy from the admitted Term Declarations, without changing their identities. */
export function groupTree<
  T extends Pick<ITermDeclaration, 'id' | 'knowledge' | 'termKind' | 'group' | 'viewpoint'>,
>(termDeclarations: readonly T[]): IGroupTreeNode<T>[] {
  const roots = new Map<string, IGroupTreeNode<T>>();
  for (const termDeclaration of termDeclarations) {
    let node: IGroupTreeNode<T> = roots.get(termDeclaration.knowledge) ?? {
      knowledge: termDeclaration.knowledge,
      group: '',
      termDeclarations: [],
      children: [],
    };
    roots.set(termDeclaration.knowledge, node);
    let path = '';
    for (const segment of termDeclaration.group?.split('.') ?? []) {
      path = path ? path + '.' + segment : segment;
      let child: IGroupTreeNode<T> | undefined = node.children.find(
        (group) => group.group === path,
      );
      if (!child) {
        child = {
          knowledge: termDeclaration.knowledge,
          group: path,
          termDeclarations: [],
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    node.termDeclarations.push(termDeclaration);
  }
  const sort = (node: IGroupTreeNode<T>): IGroupTreeNode<T> => {
    node.termDeclarations.sort(
      (a, b) =>
        byText(a.id, b.id) ||
        byText(
          termKindIdentity(a.termKind, a.viewpoint),
          termKindIdentity(b.termKind, b.viewpoint),
        ),
    );
    node.children.sort((a, b) => byText(a.group, b.group)).forEach(sort);
    return node;
  };
  return [...roots.values()].sort((a, b) => byText(a.knowledge, b.knowledge)).map(sort);
}
