import { afterEach, expect, test, vi } from 'vitest';
// Exercise the controller served by the standard pre-test build.
// @ts-expect-error Native browser module.
import { GraphExplorer } from '../../core/webapp/graph.js';

afterEach(() => vi.unstubAllGlobals());

function viewport() {
  const graph = new GraphExplorer({});
  const attributes = new Map();
  const world = { setAttribute: (key: string, value: string) => attributes.set(key, value) };
  const label = { textContent: '' };
  const canvas = {
    getBoundingClientRect: () => ({ x: 100, y: 50, width: 800, height: 600 }),
    classList: { toggle: vi.fn() },
  };
  graph.root = {
    querySelector: (selector: string) => {
      if (selector === '.graph-canvas') return canvas;
      if (selector === '.graph-world') return world;
      if (selector === '.graph-zoom span') return label;
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  return { graph, canvas, attributes, label };
}

test.each(['structure', 'explore'])(
  '%s wheel zoom retains the world point under the cursor',
  (mode) => {
    vi.stubGlobal('window', new EventTarget());
    const { graph, canvas, attributes, label } = viewport();
    graph.mode = mode;
    graph.highlightEvents = new AbortController();
    graph.camera = { x: 40, y: -20, k: 0.8 };
    graph.bindPointer(canvas);
    const preventDefault = vi.fn();
    const before = {
      x: (250 - graph.camera.x) / graph.camera.k,
      y: (180 - graph.camera.y) / graph.camera.k,
    };
    graph.root.querySelector('.graph-canvas').onwheel({
      clientX: 350,
      clientY: 230,
      deltaY: -200,
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(graph.camera.k).toBeGreaterThan(0.8);
    expect((250 - graph.camera.x) / graph.camera.k).toBeCloseTo(before.x);
    expect((180 - graph.camera.y) / graph.camera.k).toBeCloseTo(before.y);
    expect(attributes.get('transform')).toContain(`scale(${graph.camera.k})`);
    expect(label.textContent).not.toBe('');
    graph.highlightEvents.abort();
  },
);

test('zoom commands share the centered camera transform and clamp its scale', async () => {
  const { graph } = viewport();
  await graph.command('zoom-in');
  expect(graph.camera.k).toBeGreaterThan(1);
  expect((400 - graph.camera.x) / graph.camera.k).toBeCloseTo(400);
  expect((300 - graph.camera.y) / graph.camera.k).toBeCloseTo(300);
  await graph.command('zoom-out');
  expect(graph.camera.k).toBeCloseTo(1);
  expect(graph.camera.x).toBeCloseTo(0);
  expect(graph.camera.y).toBeCloseTo(0);
  graph.zoom(1e6);
  expect(graph.camera.k).toBe(2.5);
  graph.zoom(1e-6);
  expect(graph.camera.k).toBe(0.05);
});
