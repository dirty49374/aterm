import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import cise from 'cytoscape-cise';

cytoscape.use(fcose);
cytoscape.use(cise);

const endpoint = (id) => id.replace(/:(?:in|out)$/, '');
const style = [
  { selector: 'node', style: { width: 'data(width)', height: 'data(height)', 'border-width': 0 } },
  // fCoSE supports symmetric compound padding. Reserve the card header within it.
  { selector: ':parent', style: { padding: 96, 'min-width': 320, 'min-height': 124 } },
];

function createGraph(nodes, edges) {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    style,
    elements: [
      ...nodes.map((data) => ({ group: 'nodes', data })),
      ...edges.map((e, i) => ({
        group: 'edges',
        data: { id: `layout-edge:${i}`, source: e.source, target: e.target },
      })),
    ],
  });
}

async function run(cy, options) {
  if (!cy.nodes().length) return;
  await new Promise((resolve, reject) => {
    try {
      cy.layout({
        ...options,
        animate: false,
        fit: false,
        packComponents: false,
        stop: resolve,
      }).run();
    } catch (error) {
      reject(error);
    }
  });
}

async function compound(input) {
  const nodes = [];
  const visit = (node, parent) => {
    nodes.push({ id: node.id, parent, width: node.width, height: node.height });
    for (const child of node.children || []) visit(child, node.id);
  };
  input.children.forEach((node) => visit(node));
  if (!nodes.length) return { ...input, width: 0, height: 0 };
  const cy = createGraph(
    nodes,
    input.edges.map((e) => ({ source: endpoint(e.sources[0]), target: endpoint(e.targets[0]) })),
  );
  try {
    await run(cy, {
      name: 'fcose',
      quality: 'default',
      randomize: true,
      idealEdgeLength: 180,
      nodeRepulsion: 12000,
      numIter: 2000,
      tilingPaddingHorizontal: 64,
      tilingPaddingVertical: 64,
    });
    const boxes = new Map(
      cy.nodes().map((node) => {
        const p = node.position(),
          width = node.outerWidth(),
          height = node.outerHeight();
        return [node.id(), { x: p.x - width / 2, y: p.y - height / 2, width, height }];
      }),
    );
    const left = Math.min(...input.children.map((n) => boxes.get(n.id).x)) - 32;
    const top = Math.min(...input.children.map((n) => boxes.get(n.id).y)) - 32;
    const restore = (node, parent = { x: left, y: top }) => {
      const box = boxes.get(node.id);
      return {
        ...node,
        ...box,
        x: box.x - parent.x,
        y: box.y - parent.y,
        children: node.children?.map((child) => restore(child, box)),
      };
    };
    return {
      ...input,
      children: input.children.map((n) => restore(n)),
      edges: [],
      width:
        Math.max(...input.children.map((n) => boxes.get(n.id).x + boxes.get(n.id).width)) -
        left +
        32,
      height:
        Math.max(...input.children.map((n) => boxes.get(n.id).y + boxes.get(n.id).height)) -
        top +
        32,
    };
  } finally {
    cy.destroy();
  }
}

/** CiSE accepts flat clusters: apply one circle per scope, from the leaves upward. */
async function circular(input) {
  const allEdges = input.edges.map((e) => ({
    source: endpoint(e.sources[0]),
    target: endpoint(e.targets[0]),
  }));
  async function level(node) {
    if (!node.children?.length) return node;
    const children = [];
    for (const child of node.children) children.push(await level(child));
    const owners = new Map();
    const visit = (child, owner) => {
      owners.set(child.id, owner);
      for (const nested of child.children || []) visit(nested, owner);
    };
    children.forEach((child) => visit(child, child.id));
    const edges = allEdges
      .map((e) => ({ source: owners.get(e.source), target: owners.get(e.target) }))
      .filter((e) => e.source && e.target && e.source !== e.target);
    const cy = createGraph(
      children.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges,
    );
    try {
      await run(cy, {
        name: 'cise',
        randomize: true,
        clusters: children.length > 1 ? [children.map((n) => n.id)] : [],
        nodeSeparation: 64,
        nodeRepulsion: () => 12000,
      });
      const boxes = children.map((n) => {
        const p = cy.getElementById(n.id).position();
        return { ...n, x: p.x - n.width / 2, y: p.y - n.height / 2 };
      });
      const left = Math.min(...boxes.map((n) => n.x)) - 36;
      const top = Math.min(...boxes.map((n) => n.y)) - (node.id === 'root' ? 36 : 110);
      return {
        ...node,
        edges: [],
        children: boxes.map((n) => ({ ...n, x: n.x - left, y: n.y - top })),
        width: Math.max(320, Math.max(...boxes.map((n) => n.x + n.width)) - left + 36),
        height: Math.max(...boxes.map((n) => n.y + n.height)) - top + 36,
      };
    } finally {
      cy.destroy();
    }
  }
  return level(input);
}

export async function forceLayout(input, algorithm) {
  if (algorithm === 'fcose') return compound(input);
  if (algorithm === 'cise') return circular(input);
  throw new Error(`Unknown layout: ${algorithm}`);
}
