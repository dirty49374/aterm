/** _aterm:Graph_Anchor_ candidates are shared by both logical Port roles. */
export function anchorCandidates(node) {
  return [
    ['top', 0, -1],
    ['right', 1, 0],
    ['bottom', 0, 1],
    ['left', -1, 0],
  ].flatMap(([side, nx, ny]) =>
    [0.5, 0.25, 0.75].map((fraction) => ({
      side,
      fraction,
      nx,
      ny,
      x: node.x + node.width * (nx ? (nx + 1) / 2 : fraction),
      y: node.y + node.height * (ny ? (ny + 1) / 2 : fraction),
      key: JSON.stringify([node.id, side, fraction]),
    })),
  );
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const inside = (p, box) =>
  p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const curvePoint = ({ source, c1, c2, target }, t) => {
  const u = 1 - t;
  return {
    x: u ** 3 * source.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * target.x,
    y: u ** 3 * source.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * target.y,
  };
};

/** Sample the rendered cubic by approximate arc length, without native SVG layout reads. */
export function labelCandidates(route) {
  const steps = 128;
  const samples = Array.from({ length: steps + 1 }, (_, i) => curvePoint(route, i / steps));
  const lengths = [0];
  for (let i = 1; i <= steps; i++)
    lengths.push(lengths[i - 1] + distance(samples[i - 1], samples[i]));
  let segment = 1;
  return Array.from({ length: 41 }, (_, i) => {
    const length = lengths[steps] * (0.1 + i * 0.02);
    while (segment < steps && lengths[segment] < length) segment++;
    const span = lengths[segment] - lengths[segment - 1];
    const fraction = span ? (length - lengths[segment - 1]) / span : 0;
    return curvePoint(route, (segment - 1 + fraction) / steps);
  });
}

/** Solid card/header geometry is shared by attachment scoring and label placement. */
export function nodeObstacles(nodes) {
  return [...nodes.values()]
    .map((n) => ({ ...n, height: n.open ? Math.min(82, n.height) : n.height }))
    .sort((a, b) => byText(a.id, b.id));
}

function curve(source, target, sourceNode, targetNode) {
  const span = distance(source, target);
  const reach = Math.max(24, Math.min(96, span * 0.35));
  // An attachment to an ancestor approaches its boundary from inside its Body.
  // Boundary points (including self-edges) use the outward tangent.
  const sourceSign = inside(target, sourceNode) ? -1 : 1;
  const targetSign = inside(source, targetNode) ? -1 : 1;
  const c1 = {
    x: source.x + source.nx * reach * sourceSign,
    y: source.y + source.ny * reach * sourceSign,
  };
  const c2 = {
    x: target.x + target.nx * reach * targetSign,
    y: target.y + target.ny * reach * targetSign,
  };
  const points = Array.from({ length: 17 }, (_, i) =>
    curvePoint({ source, c1, c2, target }, i / 16),
  );
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  const xs = [source.x, c1.x, c2.x, target.x],
    ys = [source.y, c1.y, c2.y, target.y];
  return {
    source,
    target,
    c1,
    c2,
    points,
    lengths,
    length,
    span,
    bounds: {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    },
    path: `M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`,
  };
}

// Clipped segment length counts interior penetration, not a boundary touch.
function interiorLength(a, b, box, length) {
  let start = 0,
    end = 1;
  for (const [axis, size] of [
    ['x', 'width'],
    ['y', 'height'],
  ]) {
    const delta = b[axis] - a[axis];
    const low = box[axis] + 0.01,
      high = box[axis] + box[size] - 0.01;
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] <= low || a[axis] >= high) return 0;
    } else {
      const t1 = (low - a[axis]) / delta,
        t2 = (high - a[axis]) / delta;
      start = Math.max(start, Math.min(t1, t2));
      end = Math.min(end, Math.max(t1, t2));
      if (start >= end) return 0;
    }
  }
  return (end - start) * length;
}

function obstruction(route, obstacles, best) {
  let hits = 0,
    penetration = 0;
  const b = route.bounds;
  for (const box of obstacles) {
    if (
      b.right <= box.x ||
      b.left >= box.x + box.width ||
      b.bottom <= box.y ||
      b.top >= box.y + box.height
    )
      continue;
    let amount = 0;
    for (let i = 1; i < route.points.length; i++)
      amount += interiorLength(route.points[i - 1], route.points[i], box, route.lengths[i - 1]);
    if (amount > 0) {
      hits++;
      penetration += amount;
      if (best && (hits > best[0] || (hits === best[0] && penetration > best[1] + 1e-7)))
        return [hits, penetration];
    }
  }
  return [hits, penetration];
}

function better(score, best) {
  if (!best) return true;
  for (let i = 0; i < score.length; i++) {
    if (Math.abs(score[i] - best[i]) > 1e-7) return score[i] < best[i];
  }
  return false;
}

const edgeIdentity = (edge) =>
  JSON.stringify([
    edge.from,
    edge.to,
    (edge.edges || []).map((e) => [e.origin, e.type, e.phrase]).sort(),
  ]);

/** _aterm:Graph_Connection_Point_ chooses a candidate pair per visible Edge.
 * Deterministic greedy selection: penetrated cards, penetration length, then
 * curve length + bend excess + shared-anchor congestion. No obstacle routing.
 */
export function connectEdges(nodes, edges) {
  const candidates = new Map([...nodes].map(([id, node]) => [id, anchorCandidates(node)]));
  const obstacles = nodeObstacles(nodes),
    usage = new Map(),
    result = [];
  const ordered = edges
    .map((edge, index) => ({ edge, index, key: edgeIdentity(edge) }))
    .sort((a, b) => byText(a.key, b.key));
  for (const { edge, index } of ordered) {
    let best;
    for (const source of candidates.get(edge.from)) {
      for (const target of candidates.get(edge.to)) {
        if (source.key === target.key) continue;
        const route = curve(source, target, nodes.get(edge.from), nodes.get(edge.to));
        const congestion = (usage.get(source.key) || 0) + (usage.get(target.key) || 0);
        const cost = route.length + 0.75 * (route.length - route.span) + 48 * congestion;
        // Once a clear curve exists, a longer/more crowded clear curve cannot win.
        if (best?.score[0] === 0 && cost > best.score[2] + 1e-7) continue;
        const score = [...obstruction(route, obstacles, best?.score), cost];
        if (better(score, best?.score)) best = { ...route, score };
      }
    }
    result[index] = best;
    for (const point of [best.source, best.target])
      usage.set(point.key, (usage.get(point.key) || 0) + 1);
  }
  return result;
}

/** Place a label along its rendered route, avoiding cards and earlier labels. */
export function placeEdgeLabel(points, width, height, obstacles) {
  let best;
  for (const [index, point] of points.entries()) {
    for (const [dx, dy] of [
      [0, 0],
      [0, -height],
      [0, height],
      [-width / 2 - 8, 0],
      [width / 2 + 8, 0],
    ]) {
      const box = { x: point.x + dx - width / 2, y: point.y + dy - height / 2, width, height };
      const overlap = obstacles.reduce(
        (sum, other) =>
          sum +
          Math.max(
            0,
            Math.min(box.x + width, other.x + other.width + 6) - Math.max(box.x, other.x - 6),
          ) *
            Math.max(
              0,
              Math.min(box.y + height, other.y + other.height + 6) - Math.max(box.y, other.y - 6),
            ),
        0,
      );
      const score =
        overlap * 10000 +
        Math.abs(dx) +
        Math.abs(dy) +
        Math.abs(index - (points.length - 1) / 2) * 4;
      if (!best || score < best.score) best = { ...box, anchor: point, score };
    }
  }
  return best;
}
