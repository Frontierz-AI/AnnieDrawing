import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  itemBounds,
  normalizeItem,
  resolveEndpoint,
  routeConnector,
  SpatialIndex,
  simplifyPoints,
} from '../src/core';
const shape = (id: string, kind = 'rect', x = 0, y = 0) =>
  normalizeItem({ id, kind, x, y, w: 100, h: 80, style: { fill: 'sky' } });
describe('headless geometry', () => {
  it('derives rotation and group bounds in page coordinates', () => {
    const rotated = itemBounds({ ...shape('a'), rotation: 90 });
    expect(rotated.x).toBeCloseTo(10);
    expect(rotated.y).toBeCloseTo(-10);
    expect(rotated.w).toBeCloseTo(80);
    expect(rotated.h).toBeCloseTo(100);
    expect(boundsOf([shape('a'), shape('b', 'rect', 200, 100)])).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 180,
    });
    expect(
      itemBounds({ ...shape('g', 'group'), children: [shape('a'), shape('b', 'rect', 200, 100)] }),
    ).toEqual({ x: 0, y: 0, w: 300, h: 180 });
  });
  it('clips auto endpoints to ellipses and diamonds and rotates anchors', () => {
    const ellipse = shape('e', 'ellipse'),
      diamond = shape('d', 'diamond');
    expect(resolveEndpoint({ item: 'e' }, { x: 200, y: 40 }, [ellipse])).toEqual({ x: 100, y: 40 });
    const p = resolveEndpoint({ item: 'd' }, { x: 150, y: 140 }, [diamond]);
    expect(p.x).toBeCloseTo(72.222);
    expect(p.y).toBeCloseTo(62.222);
    expect(
      resolveEndpoint({ item: 'a', side: 'right' }, undefined, [{ ...shape('a'), rotation: 90 }]),
    ).toEqual({ x: 50, y: 90 });
  });
  it('routes attached straight, orthogonal and curved connectors', () => {
    const a = shape('a'),
      b = shape('b', 'rect', 300),
      connector = normalizeItem({
        kind: 'connector',
        from: { item: 'a', side: 'right' },
        to: { item: 'b', side: 'left' },
      });
    const straight = routeConnector(connector, [a, b]);
    expect(straight.points).toEqual([
      { x: 100, y: 40 },
      { x: 300, y: 40 },
    ]);
    expect(straight.midpoint).toEqual({ x: 200, y: 40 });
    expect(routeConnector({ ...connector, route: 'elbow' }, [a, b]).points).toHaveLength(4);
    const curve = routeConnector({ ...connector, route: 'curve' }, [a, b]);
    expect(curve.d).toContain('Q');
    expect(curve.midpoint.y).toBeGreaterThan(40);
  });
  it('uses broad-phase indexing and precise shape, hollow, line, and rotation hits', () => {
    const hollow = normalizeItem({ id: 'h', kind: 'rect', x: 200, y: 0, w: 100, h: 100 });
    const index = new SpatialIndex([
      shape('filled'),
      hollow,
      normalizeItem({
        id: 'line',
        kind: 'line',
        x: 0,
        y: 150,
        w: 100,
        h: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
      }),
    ]);
    expect(index.pick({ x: 50, y: 40 })?.id).toBe('filled');
    expect(index.pick({ x: 250, y: 50 })).toBeUndefined();
    expect(index.pick({ x: 200, y: 50 })?.id).toBe('h');
    expect(index.pick({ x: 50, y: 153 })?.id).toBe('line');
    expect(index.search({ x: 0, y: 0, w: 100, h: 100 })).toHaveLength(1);
  });
  it('respects group entry, hidden ancestors and locked items', () => {
    const group = normalizeItem({ id: 'g', kind: 'group', children: [shape('a')] });
    const index = new SpatialIndex([group]);
    expect(index.pick({ x: 50, y: 40 })?.id).toBe('g');
    expect(index.pick({ x: 50, y: 40 }, { enteredGroup: 'g' })?.id).toBe('a');
    index.set([
      { ...group, hidden: true },
      { ...shape('locked', 'rect', 200), locked: true },
    ]);
    expect(index.pick({ x: 50, y: 40 })).toBeUndefined();
    expect(index.pick({ x: 250, y: 40 })).toBeUndefined();
  });
  it('simplifies freehand without changing endpoints', () => {
    expect(
      simplifyPoints(
        [
          [0, 0, 0.5],
          [10, 0.1, 0.5],
          [20, 0, 0.5],
        ],
        0.5,
      ),
    ).toEqual([
      [0, 0, 0.5],
      [20, 0, 0.5],
    ]);
  });
});
it('uses registered local outlines for custom kinds', () => {
  const triangle = shape('triangle', 'triangle'),
    index = new SpatialIndex([triangle]),
    outline = () => ({
      closed: true,
      points: [
        { x: 0, y: 80 },
        { x: 50, y: 0 },
        { x: 100, y: 80 },
      ],
    });
  expect(index.pick({ x: 50, y: 40 }, { outline })?.id).toBe('triangle');
  expect(index.pick({ x: 5, y: 5 }, { outline })).toBeUndefined();
});
it('anchors group connectors to current descendant bounds without a routing cycle', () => {
  const a = shape('a', 'rect', 200),
    b = shape('b', 'rect', 400),
    group = normalizeItem({ id: 'g', kind: 'group', x: 0, y: 0, w: 100, h: 100, children: [a, b] }),
    connection = normalizeItem({
      id: 'c',
      kind: 'connector',
      from: { item: 'g', side: 'right' },
      to: { x: 700, y: 40 },
    });
  group.children!.push(connection);
  const map = new Map([group, a, b, connection].map((item) => [item.id, item]));
  expect(resolveEndpoint(connection.from, connection.to, map)).toEqual({ x: 500, y: 40 });
  map.set('b', { ...b, x: 500 });
  expect(resolveEndpoint(connection.from, connection.to, map)).toEqual({ x: 600, y: 40 });
  expect(routeConnector(connection, map).points[0]).toEqual({ x: 600, y: 40 });
});
it('picks the rendered diagonal of a line that omits explicit points', () => {
  const line = normalizeItem({ id: 'implicit-line', kind: 'line', x: 100, y: 100, w: 100, h: 100 });
  const index = new SpatialIndex([line]);
  expect(index.pick({ x: 150, y: 150 })?.id).toBe('implicit-line');
  expect(index.pick({ x: 100, y: 150 })).toBeUndefined();
});
it('marquee selection uses connector routes and rotated bounds with inherited visibility', () => {
  const connector = normalizeItem({
    id: 'route',
    kind: 'connector',
    from: { x: 300, y: 100 },
    to: { x: 400, y: 200 },
  });
  const rotated = { ...shape('rotated', 'rect', 100, 100), w: 100, h: 20, rotation: 90 };
  const hidden = normalizeItem({
    id: 'hidden',
    kind: 'group',
    hidden: true,
    children: [shape('hidden-child', 'rect', 300, 100)],
  });
  const locked = normalizeItem({
    id: 'locked',
    kind: 'group',
    locked: true,
    children: [shape('locked-child', 'rect', 300, 100)],
  });
  const index = new SpatialIndex([connector, rotated, hidden, locked]);
  expect(index.enclosed({ x: 290, y: 90, w: 120, h: 120 }).map((item) => item.id)).toEqual([
    'route',
  ]);
  expect(index.enclosed({ x: 139, y: 59, w: 22, h: 102 }).map((item) => item.id)).toEqual([
    'rotated',
  ]);
  expect(index.enclosed({ x: 100, y: 100, w: 100, h: 20 })).toEqual([]);
});
it('marquee selection respects group entry without duplicate groups', () => {
  const group = normalizeItem({
    id: 'group',
    kind: 'group',
    children: [shape('first', 'rect', 0, 0), shape('second', 'rect', 120, 0)],
  });
  const index = new SpatialIndex([group]);
  expect(index.enclosed({ x: -10, y: -10, w: 240, h: 100 }).map((item) => item.id)).toEqual([
    'group',
  ]);
  expect(index.enclosed({ x: -10, y: -10, w: 110, h: 100 })).toEqual([]);
  expect(
    index
      .enclosed({ x: -10, y: -10, w: 110, h: 100 }, { enteredGroup: 'group' })
      .map((item) => item.id),
  ).toEqual(['first']);
});
