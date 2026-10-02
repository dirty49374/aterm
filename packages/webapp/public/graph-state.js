import { builtInRelations } from './library-model.js';

/** One category vocabulary for both projections and their neighbor operations. */
export const edgeCategories = [
  { id: 'reference', label: 'Reference' },
  ...Object.entries(builtInRelations)
    .filter(([, semantics]) => semantics.structural)
    .map(([label, { type }]) => ({ id: type, label })),
  { id: 'other', label: 'Other relations' },
];
const allCategories = edgeCategories.map(({ id }) => id);
export const defaultEdgeFilters = () => ({ categories: [...allCategories] });

/** Selection and feedback are independent of the projection's membership policy. */
export class GraphInteraction {
  selectedTerms() {
    return [
      ...new Set(
        [...this.selection]
          .filter((id) => this.nodes.has(id))
          .flatMap((id) =>
            this.memberTermDeclarations(id).map((termDeclaration) => termDeclaration.id),
          ),
      ),
    ].sort();
  }
  select(id, additive = false) {
    if (id && !this.nodes.has(id)) return;
    if (!additive) this.selection.clear();
    if (id) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
  }
  selectBox(start, end, baseline = []) {
    const left = Math.min(start.x, end.x),
      right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y),
      bottom = Math.max(start.y, end.y);
    this.selection = new Set([...baseline].filter((id) => this.nodes.has(id)));
    for (const [id, node] of this.nodes)
      if (
        node.x < right &&
        node.x + node.width > left &&
        node.y < bottom &&
        node.y + node.height > top
      )
        this.selection.add(id);
  }
  edgeFeedback(edge, activeNodes = [], direct = false) {
    const incident = (ids) => ids.has(edge.from) || ids.has(edge.to);
    const active = new Set(activeNodes);
    const preview = activeNodes.some((id) =>
      edge.concealedBy?.includes(this.nodes.get(id)?.hiddenBy),
    );
    return {
      selected: incident(this.selection),
      highlighted: direct || incident(active) || preview,
      concealed: !!edge.concealedBy?.length && !preview && !direct,
    };
  }
}

export function matchesEdge(edge, filters = {}) {
  const category =
    edge.origin === 'reference'
      ? 'reference'
      : allCategories.includes(edge.type)
        ? edge.type
        : 'other';
  return (filters.categories ?? allCategories).includes(category);
}

/** Both projections retain every eligible connection in one directed endpoint pair. */
export function addProjectedEdge(grouped, edge, from, to, options = {}) {
  const key = JSON.stringify([from, to]);
  if (!grouped.has(key))
    grouped.set(key, {
      from,
      to,
      phrase: edge.phrase,
      bundle: false,
      concealedBy: [],
      ...options,
      edges: [],
    });
  const projected = grouped.get(key);
  projected.edges.push(edge);
  if (projected.edges.length > 1) projected.bundle = true;
}

/** Record eligible assertions at every visible occurrence before projection drops any. */
export function recordConnections(connections, edge, sources, targets) {
  for (const [direction, ids] of [
    ['outgoing', sources],
    ['incoming', targets],
  ])
    for (const id of ids) {
      if (!connections.has(id)) connections.set(id, { incoming: new Set(), outgoing: new Set() });
      connections.get(id)[direction].add(edge);
    }
}

/** Count assertions absent from the persistent display, independently of transient Hover. */
export function unshownConnections(connections, projected) {
  for (const edge of projected) {
    if (edge.concealedBy?.length) continue;
    for (const assertion of edge.edges) {
      connections.get(edge.from)?.outgoing.delete(assertion);
      connections.get(edge.to)?.incoming.delete(assertion);
    }
  }
  return new Map(
    [...connections].map(([id, { incoming, outgoing }]) => [
      id,
      {
        incoming: incoming.size,
        outgoing: outgoing.size,
        total: new Set([...incoming, ...outgoing]).size,
      },
    ]),
  );
}
