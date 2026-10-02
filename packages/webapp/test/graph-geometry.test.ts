import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import * as graphGeometry from '../public/graph-geometry.js';
const { anchorCandidates, connectEdges, labelCandidates, nodeObstacles, placeEdgeLabel } =
  graphGeometry;

const node = (id: string, x: number, y: number, width = 160, height = 100, open = false) => ({
  id,
  x,
  y,
  width,
  height,
  open,
});
const nodesOf = (...values: any[]) => new Map(values.map((n) => [n.id, n]));
const edge = (from: string, to: string, phrase = 'uses') => ({
  from,
  to,
  edges: [{ origin: 'relation', type: 'association', phrase }],
});

// Inspect the actual SVG cubic at much finer resolution than the scoring approximation.
function svgPoints(path: string) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = path
    .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
    .map(Number);
  return Array.from({ length: 401 }, (_, i) => {
    const t = i / 400,
      u = 1 - t;
    return {
      x: u ** 3 * x0! + 3 * u ** 2 * t * x1! + 3 * u * t ** 2 * x2! + t ** 3 * x3!,
      y: u ** 3 * y0! + 3 * u ** 2 * t * y1! + 3 * u * t ** 2 * y2! + t ** 3 * y3!,
    };
  });
}
const penetrates = (p: any, n: any) =>
  p.x > n.x + 0.05 && p.x < n.x + n.width - 0.05 && p.y > n.y + 0.05 && p.y < n.y + n.height - 0.05;

test('Anchor candidates cover all four sides of the full compound bounds', () => {
  const n = node('compound', 10, 20, 400, 600, true);
  const anchors = anchorCandidates(n);
  expect(anchors).toHaveLength(12);
  expect(new Set(anchors.map((a: any) => a.key)).size).toBe(12);
  expect(anchors.filter((a: any) => a.side === 'bottom').map((a: any) => a.y)).toEqual([
    620, 620, 620,
  ]);
});

test.each([
  [0, 300, 'bottom', 'top'],
  [0, -300, 'top', 'bottom'],
  [400, 0, 'right', 'left'],
  [-400, 0, 'left', 'right'],
])(
  'connections face a neighbor at (%s, %s) without penetrating their cards',
  (x, y, sourceSide, targetSide) => {
    const a = node('a', 0, 0),
      b = node('b', Number(x), Number(y));
    const [route] = connectEdges(nodesOf(a, b), [edge('a', 'b')]);
    expect(route.source.side).toBe(sourceSide);
    expect(route.target.side).toBe(targetSide);
    expect(svgPoints(route.path).some((p) => penetrates(p, a) || penetrates(p, b))).toBe(false);
  },
);

test('a blocking card changes the attachment pair when a clear direct curve exists', () => {
  const a = node('a', 0, 0),
    b = node('b', 0, 400),
    blocker = node('blocker', 40, 180, 80, 100);
  const [clear] = connectEdges(nodesOf(a, b), [edge('a', 'b')]);
  expect(svgPoints(clear.path).some((p) => penetrates(p, blocker))).toBe(true);
  const [avoiding] = connectEdges(nodesOf(a, b, blocker), [edge('a', 'b')]);
  expect(svgPoints(avoiding.path).some((p) => penetrates(p, blocker))).toBe(false);
  expect(svgPoints(avoiding.path).some((p) => penetrates(p, a) || penetrates(p, b))).toBe(false);
});

test('parallel and reciprocal edges spread attachments deterministically', () => {
  const nodes = nodesOf(node('a', 0, 0), node('b', 400, 0));
  const edges = [edge('a', 'b', 'uses'), edge('a', 'b', 'reads'), edge('b', 'a', 'updates')];
  const routes = connectEdges(nodes, edges);
  expect(new Set(routes.map((r: any) => r.path)).size).toBe(3);
  expect(
    new Set(routes.map((r: any) => (r.source.x === 160 ? r.source.key : r.target.key))).size,
  ).toBeGreaterThan(1);
  const reversed = connectEdges(new Map([...nodes].reverse()), [...edges].reverse());
  expect(reversed.map((r: any) => r.path).reverse()).toEqual(routes.map((r: any) => r.path));
});

test('self edges remain visible outside their own card', () => {
  const a = node('a', 0, 0);
  const [route] = connectEdges(nodesOf(a), [edge('a', 'a')]);
  expect(route.source.key).not.toBe(route.target.key);
  expect(svgPoints(route.path).some((p) => penetrates(p, a))).toBe(false);
  expect(route.length).toBeGreaterThan(20);
});

test('compound Body is traversable but Header is protected, including parent-child edges', () => {
  const parent = node('parent', 0, 0, 700, 500, true);
  const a = node('a', 60, 180),
    b = node('b', 440, 180);
  const nodes = nodesOf(parent, a, b);
  const obstacles = nodeObstacles(nodes);
  for (const route of connectEdges(nodes, [
    edge('a', 'b'),
    edge('a', 'parent'),
    edge('parent', 'b'),
  ])) {
    expect(svgPoints(route.path).some((p) => obstacles.some((o: any) => penetrates(p, o)))).toBe(
      false,
    );
  }
});

test('geometry changes reselect attachments without changing Edge provenance', () => {
  const a = node('a', 0, 0),
    b = node('b', 0, 300);
  const edges = [edge('a', 'b')],
    original = structuredClone(edges);
  const before = connectEdges(nodesOf(a, b), edges)[0];
  const after = connectEdges(nodesOf(a, { ...b, x: -400, y: 0 }), edges)[0];
  expect(before.source.side).toBe('bottom');
  expect(after.source.side).toBe('left');
  expect(edges).toEqual(original);
});

test('overlapping nodes still produce finite deterministic geometry', () => {
  const nodes = nodesOf(node('a', 0, 0), node('b', 30, 20));
  const edges = [edge('a', 'b')];
  const first = connectEdges(nodes, edges)[0];
  expect(first.path).not.toMatch(/NaN|Infinity/);
  expect(first.path).toBe(connectEdges(nodes, edges)[0].path);
  expect(connectEdges(new Map(), [])).toEqual([]);
});

test.each([
  ['straight', nodesOf(node('a', 0, 0), node('b', 500, 0)), edge('a', 'b')],
  ['curved', nodesOf(node('a', 0, 0), node('b', -420, 360)), edge('a', 'b')],
  ['self', nodesOf(node('a', 20, 80)), edge('a', 'a')],
])(
  'label candidates follow the actual %s cubic without browser path measurements',
  (_name, nodes, link) => {
    const [route] = connectEdges(nodes, [link]);
    const samples = labelCandidates(route);
    // Independent fine-resolution path reference, including approximate arc distances.
    const fine = svgPoints(route.path);
    const lengths = [0];
    for (let i = 1; i < fine.length; i++)
      lengths.push(
        lengths[i - 1]! + Math.hypot(fine[i]!.x - fine[i - 1]!.x, fine[i]!.y - fine[i - 1]!.y),
      );
    expect(samples).toHaveLength(41);
    for (let i = 0; i < samples.length; i++) {
      const length = lengths.at(-1)! * (0.1 + i * 0.02);
      const j = lengths.findIndex((n) => n >= length);
      const fraction = (length - lengths[j - 1]!) / (lengths[j]! - lengths[j - 1]!);
      const expected = {
        x: fine[j - 1]!.x + (fine[j]!.x - fine[j - 1]!.x) * fraction,
        y: fine[j - 1]!.y + (fine[j]!.y - fine[j - 1]!.y) * fraction,
      };
      expect(Math.hypot(samples[i].x - expected.x, samples[i].y - expected.y)).toBeLessThan(0.05);
    }
  },
);

test('a zero-length cubic yields finite label candidates', () => {
  const point = { x: 30, y: 60 };
  expect(labelCandidates({ source: point, target: point, c1: point, c2: point })).toEqual(
    Array.from({ length: 41 }, () => point),
  );
});

test('edge labels follow straight and bent routes and separate overlapping branches', () => {
  const straight = [
    { x: 20, y: 60 },
    { x: 20, y: 100 },
    { x: 20, y: 140 },
  ];
  const first = placeEdgeLabel(straight, 60, 20, []);
  expect(first.anchor).toEqual({ x: 20, y: 100 });
  const bent = [
    { x: 20, y: 60 },
    { x: 100, y: 60 },
    { x: 180, y: 60 },
  ];
  const second = placeEdgeLabel(bent, 60, 20, [first]);
  expect(second.anchor.y).toBe(60);
  const branch = placeEdgeLabel(bent, 60, 20, [first, second]);
  const overlaps = (a: any, b: any) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps(branch, first)).toBe(false);
  expect(overlaps(branch, second)).toBe(false);
});

test('edge labels avoid card headers even when the route midpoint crosses a card', () => {
  const card = { x: 70, y: 40, width: 60, height: 60 };
  const points = [
    { x: 20, y: 60 },
    { x: 100, y: 60 },
    { x: 180, y: 60 },
  ];
  const label = placeEdgeLabel(points, 60, 20, [card]);
  expect(
    label.x + label.width <= card.x ||
      label.x >= card.x + card.width ||
      label.y + label.height <= card.y ||
      label.y >= card.y + card.height,
  ).toBe(true);
});
