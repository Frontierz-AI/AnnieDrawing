import { expect, it } from 'vitest';
import { createDoc, defaultDoc, type Item } from '../src/core';
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
