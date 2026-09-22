import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { createDoc, defaultDoc, routeConnector, type Item, type Op } from '../src/core';
it('loads 5,000 headless items and commits a 100-item move within practical bounds', () => {
  const input = defaultDoc();
  input.pages[0].items = Array.from({ length: 5000 }, (_, i): Item => ({
    id: `item_${i}`,
    kind: 'rect',
    x: (i % 100) * 140,
    y: Math.floor(i / 100) * 100,
    w: 100,
    h: 80,
  }));
  const start = performance.now(),
    doc = createDoc(input),
    loaded = performance.now();
  const result = doc.apply(
    Array.from({ length: 100 }, (_, i) => ({
      op: 'set' as const,
      id: `item_${i}`,
      patch: { x: i * 140 + 10 },
    })),
    { origin: 'user' },
  );
  const committed = performance.now();
  expect(result.ok).toBe(true);
  expect(doc.query()).toHaveLength(5000);
  expect(doc.get('item_99')!.x).toBe(13870);
  expect(loaded - start).toBeLessThan(500);
  expect(committed - loaded).toBeLessThan(500);
  console.info(
    `Headless 5,000-item load: ${(loaded - start).toFixed(1)}ms; 100-item commit: ${(committed - loaded).toFixed(1)}ms`,
  );
});
it('routes a page of automatic elbows in one ordered pass', () => {
  const items: Item[] = Array.from({ length: 160 }, (_, i) => ({
    id: `n${i}`,
    kind: 'rect',
    x: (i % 13) * 260,
    y: Math.floor(i / 13) * 200,
    w: 180,
    h: 110,
  }));
  for (let i = 0; i < 160; i++)
    for (const next of [i + 1, i + 13])
      if (next < 160 && (next !== i + 1 || next % 13))
        items.push({
          id: `e${i}_${next}`,
          kind: 'connector',
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          route: 'elbow',
          from: { item: `n${i}` },
          to: { item: `n${next}` },
        });
  const lookup = new Map(items.map((item) => [item.id, item]));
  const connectors = items.filter((item) => item.kind === 'connector');
  const start = performance.now();
  // A render asks for each route twice: once for bounds and once to paint.
  for (let pass = 0; pass < 2; pass++)
    for (const item of connectors)
      expect(routeConnector(item, lookup).points.length).toBeGreaterThan(1);
  const routed = performance.now() - start;
  expect(connectors.length).toBeGreaterThan(280);
  // The replayed pass took seconds here; one ordered pass takes tens of milliseconds.
  expect(routed).toBeLessThan(1000);
  console.info(`${connectors.length} elbows routed twice: ${routed.toFixed(1)}ms`);
});
it('keeps history small and edits quick next to large images', () => {
  // The heap check needs an explicit collection; Node allows turning it on at runtime.
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  const doc = createDoc();
  const ops: Op[] = [{ op: 'add', item: { id: 'box', kind: 'rect', x: 0, y: 0, w: 100, h: 80 } }];
  for (let photo = 0; photo < 4; photo++)
    ops.push(
      {
        op: 'media.set',
        id: `m${photo}`,
        media: {
          mime: 'image/png',
          w: 4000,
          h: 3000,
          src: `data:image/png;base64,${Buffer.alloc(6_000_000, photo + 1).toString('base64')}`,
        },
      },
      {
        op: 'add',
        item: { id: `p${photo}`, kind: 'image', media: `m${photo}`, x: 0, y: 200, w: 400, h: 300 },
      },
    );
  expect(doc.apply(ops).ok).toBe(true);
  gc();
  const heap = process.memoryUsage().heapUsed,
    start = performance.now();
  for (let i = 1; i <= 40; i++) doc.apply([{ op: 'set', id: 'box', patch: { x: i } }]);
  const edits = performance.now() - start;
  gc();
  const grown = (process.memoryUsage().heapUsed - heap) / 1e6;
  // Whole-document history held about 32 MB per edit here, and each edit rescanned every image.
  expect(grown).toBeLessThan(40);
  expect(edits).toBeLessThan(400);
  for (let i = 0; i < 40; i++) doc.undo();
  expect(doc.get('box')!.x).toBe(0);
  expect(doc.get('p3')).toBeDefined();
  console.info(
    `40 edits beside 32 MB of images: +${grown.toFixed(1)} MB heap, ${edits.toFixed(1)}ms`,
  );
});
