/** ELK computes node placement in a Worker; the renderer connects nodes directly. */
export function layoutInput(model, edges) {
  const horizontal = model.mode === 'explore';
  const nodes = new Map(
    [...model.nodes].map(([id, n]) => [
      id,
      {
        id,
        width: n.width,
        height: n.height,
        container: n.expandable,
        layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
        ports: ['in', 'out'].map((side) => ({
          id: id + ':' + side,
          width: 0,
          height: 0,
          layoutOptions: {
            'elk.port.side': horizontal
              ? side === 'in'
                ? 'WEST'
                : 'EAST'
              : side === 'in'
                ? 'NORTH'
                : 'SOUTH',
          },
        })),
      },
    ]),
  );
  const children = [];
  for (const [id, n] of model.nodes) {
    const item = nodes.get(id);
    if (n.parent) {
      const parent = nodes.get(n.parent);
      (parent.children ||= []).push(item);
      parent.layoutOptions = {
        ...parent.layoutOptions,
        'elk.padding': '[top=100,left=36,bottom=36,right=36]',
      };
    } else children.push(item);
  }
  return {
    id: 'root',
    children,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.componentComponent': '64',
      'elk.aspectRatio': '1.4',
      'elk.padding': '[top=32,left=32,bottom=32,right=32]',
    },
    edges: edges.map((e, i) => ({
      id: 'edge:' + i,
      sources: [e.from + ':out'],
      targets: [e.to + ':in'],
    })),
  };
}
export function applyLayout(model, result) {
  const next = new Map();
  const visit = (node, x = 0, y = 0) => {
    if (node.id !== 'root') {
      x += node.x || 0;
      y += node.y || 0;
      next.set(node.id, {
        ...model.nodes.get(node.id),
        x,
        y,
        width: node.width,
        height: node.height,
        laidOut: true,
      });
    }
    for (const child of node.children || []) visit(child, x, y);
  };
  visit(result);
  model.nodes = next;
}

/** Pack disconnected components deliberately: a sparse overview is a map, not one long column. */
async function packComponents(engine, input) {
  if (!input.children.length) return { ...input, width: 0, height: 0 };
  const owners = new Map();
  function visit(node, root) {
    owners.set(node.id, root);
    for (const p of node.ports || []) owners.set(p.id, root);
    for (const c of node.children || []) visit(c, root);
  }
  for (const child of input.children) visit(child, child.id);
  const parent = new Map(input.children.map((n) => [n.id, n.id]));
  const find = (n) => (parent.get(n) === n ? n : find(parent.get(n)));
  for (const edge of input.edges) {
    const a = owners.get(edge.sources[0]),
      b = owners.get(edge.targets[0]);
    if (a && b) parent.set(find(a), find(b));
  }
  const groups = new Map();
  for (const child of input.children) {
    const key = find(child.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }
  const parts = await Promise.all(
    [...groups].map(([key, children]) =>
      engine.layout({
        ...input,
        children,
        edges: input.edges.filter((e) => find(owners.get(e.sources[0])) === key),
      }),
    ),
  );
  parts.sort((a, b) => b.height - a.height || b.width - a.width);
  const area = parts.reduce((sum, p) => sum + (p.width + 48) * (p.height + 48), 0);
  const target = Math.max(...parts.map((p) => p.width), Math.sqrt(area * 1.8));
  const root = { ...input, children: [], edges: [] };
  let x = 0,
    y = 0,
    row = 0;
  for (const part of parts) {
    if (x && x + part.width > target) {
      x = 0;
      y += row + 48;
      row = 0;
    }
    for (const child of part.children)
      root.children.push({ ...child, x: child.x + x, y: child.y + y });
    x += part.width + 48;
    row = Math.max(row, part.height);
  }
  root.width = Math.max(0, ...root.children.map((n) => n.x + n.width)) + 32;
  root.height = Math.max(0, ...root.children.map((n) => n.y + n.height)) + 32;
  return root;
}

/** Lay out each authored scope independently. Cross-scope uses must not reorder its containers. */
export async function layoutComponents(engine, input) {
  const allEdges = input.edges;
  async function level(node) {
    if (!node.children?.length) return node;
    const children = await Promise.all(node.children.map(level));
    const atoms = children.map(({ children: nested, edges: routed, ...rest }) => rest);
    const leafIds = new Set(children.filter((n) => !n.container).map((n) => n.id));
    const ownsPort = (id) => leafIds.has(id.replace(/:(?:in|out)$/, ''));
    const edges = allEdges.filter((e) => ownsPort(e.sources[0]) && ownsPort(e.targets[0]));
    const result = await packComponents(engine, {
      id: 'root',
      children: atoms,
      edges,
      layoutOptions: { ...input.layoutOptions, 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' },
    });
    const header = node.id === 'root' ? 0 : 78;
    return {
      ...node,
      width: Math.max(320, result.width),
      height: result.height + header,
      children: result.children.map((n) => ({
        ...children.find((c) => c.id === n.id),
        ...n,
        y: n.y + header,
      })),
      edges: [],
    };
  }
  return level(input);
}
export const layoutAlgorithms = [
  { id: 'layered', label: 'Layered' },
  { id: 'fcose', label: 'fCoSE' },
  { id: 'cise', label: 'CiSE' },
];

/** A canceled simulation cannot keep consuming CPU or overwrite a newer selection. */
export class ForceLayoutWorker {
  constructor(createWorker = () => new Worker('/force-layout-worker.js')) {
    this.createWorker = createWorker;
  }
  cancel() {
    this.pending?.worker.terminate();
    this.pending?.reject(new Error('Layout canceled'));
    this.pending = null;
  }
  layout(input, algorithm) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      this.pending = { worker, reject };
      const finish = (error, result) => {
        worker.terminate();
        if (this.pending?.worker === worker) this.pending = null;
        if (error) reject(error);
        else resolve(result);
      };
      worker.onmessage = ({ data }) =>
        finish(data.error ? new Error(data.error) : null, data.result);
      worker.onerror = (event) => finish(new Error(event.message || 'Layout Worker failed'));
      worker.postMessage({ input, algorithm });
    });
  }
}

export class LayoutScheduler {
  constructor(engine, forceEngine) {
    this.engine = engine;
    this.forceEngine = forceEngine;
    this.generation = 0;
  }
  cancel() {
    ++this.generation;
    this.forceEngine?.cancel();
  }
  async run(input, algorithm = 'layered') {
    const generation = ++this.generation;
    this.forceEngine?.cancel();
    try {
      if (!layoutAlgorithms.some((layout) => layout.id === algorithm))
        throw new Error(`Unknown layout: ${algorithm}`);
      const result =
        algorithm === 'layered'
          ? await layoutComponents(this.engine, input)
          : await this.forceEngine.layout(input, algorithm);
      return generation === this.generation ? result : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
}
