import { expect, test } from 'vitest';
// @ts-expect-error Browser layout adapter is native JavaScript.
import { forceLayout } from '../src/force-layout.js';
// @ts-expect-error Browser layout module is native JavaScript.
import { ForceLayoutWorker, LayoutScheduler } from '../public/graph-layout.js';

const leaf = (id: string) => ({ id, width: 320, height: 124 });
const scope = (id: string, children: any[]) => ({ ...leaf(id), children });
const edge = (source: string, target: string) => ({
  sources: [source + ':out'],
  targets: [target + ':in'],
});
const input = {
  id: 'root',
  children: [
    scope('knowledge', [
      scope('machine', [
        scope('inventory', [leaf('slot'), leaf('product'), leaf('restock')]),
        scope('payment', [leaf('coin'), leaf('credit'), leaf('refund')]),
        leaf('purchase'),
      ]),
    ]),
    leaf('empty-knowledge'),
  ],
  edges: [
    edge('slot', 'product'),
    edge('restock', 'slot'),
    edge('refund', 'coin'),
    edge('refund', 'credit'),
    edge('purchase', 'credit'),
    edge('purchase', 'slot'),
    edge('restock', 'credit'),
  ],
};

for (const algorithm of ['fcose', 'cise']) {
  test(`${algorithm} retains every node and nested frame with space for headers`, async () => {
    const result = await forceLayout(structuredClone(input), algorithm);
    const seen: string[] = [];
    const visit = (node: any) => {
      for (const child of node.children || []) {
        seen.push(child.id);
        for (const key of ['x', 'y', 'width', 'height'])
          expect(Number.isFinite(child[key])).toBe(true);
        expect(child.width).toBeGreaterThanOrEqual(320);
        expect(child.height).toBeGreaterThanOrEqual(124);
        expect(child.x).toBeGreaterThanOrEqual(0);
        expect(child.y).toBeGreaterThanOrEqual(node.id === 'root' ? 0 : 82);
        expect(child.x + child.width).toBeLessThanOrEqual(node.width + 0.01);
        expect(child.y + child.height).toBeLessThanOrEqual(node.height + 0.01);
        visit(child);
      }
    };
    visit(result);
    expect(seen.sort()).toEqual(
      [
        'knowledge',
        'machine',
        'inventory',
        'payment',
        'slot',
        'product',
        'restock',
        'coin',
        'credit',
        'refund',
        'purchase',
        'empty-knowledge',
      ].sort(),
    );
  });
  test(`${algorithm} handles empty graphs and single nodes including self references`, async () => {
    expect(
      (await forceLayout({ id: 'root', children: [], edges: [] }, algorithm)).children,
    ).toEqual([]);
    const result = await forceLayout(
      { id: 'root', children: [leaf('one')], edges: [edge('one', 'one')] },
      algorithm,
    );
    expect(result.children).toHaveLength(1);
    expect(Number.isFinite(result.children[0].x)).toBe(true);
  });
}

test('switching force algorithms terminates the old Worker and accepts only the new result', async () => {
  const workers: any[] = [];
  const force = new ForceLayoutWorker(() => {
    const worker: any = {
      terminated: false,
      terminate() {
        this.terminated = true;
      },
      postMessage(message: any) {
        this.message = message;
      },
    };
    workers.push(worker);
    return worker;
  });
  const scheduler = new LayoutScheduler({}, force);
  const first = scheduler.run(input, 'fcose');
  const second = scheduler.run(input, 'cise');
  expect(workers[0].terminated).toBe(true);
  expect(workers[1].message.algorithm).toBe('cise');
  workers[1].onmessage({ data: { result: { id: 'latest' } } });
  expect(await first).toBe(null);
  expect(await second).toEqual({ id: 'latest' });
  expect(workers[1].terminated).toBe(true);
});
