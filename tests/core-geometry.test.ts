import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  createDoc,
  itemBounds,
  normalizeItem,
  resolveEndpoint,
  routeConnector,
  SpatialIndex,
  simplifyPoints,
  simplifyStroke,
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
    const orthogonal = routeConnector({ ...connector, route: 'elbow' }, [a, b]);
    expect(orthogonal.points[0]).toEqual(straight.points[0]);
    expect(orthogonal.points.at(-1)).toEqual(straight.points.at(-1));
    expect(orthogonal.midpoint).toEqual(straight.midpoint);
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
    expect(
      simplifyStroke(
        [
          [0, 0, 0.2],
          [10, 0, 0.9],
          [20, 0, 0.2],
        ],
        0.5,
      ),
    ).toEqual([
      [0, 0, 0.2],
      [10, 0, 0.9],
      [20, 0, 0.2],
    ]);
  });
});
it('routes an elbow around a box sitting between the ends', () => {
  const a = shape('a'),
    mid = shape('mid', 'rect', 200),
    c = shape('c', 'rect', 400),
    link = normalizeItem({
      kind: 'connector',
      route: 'elbow',
      from: { item: 'a', side: 'right' },
      to: { item: 'c', side: 'left' },
    });
  const points = routeConnector(link, [a, mid, c]).points;
  expect(points.some((point) => point.y < mid.y || point.y > mid.y + mid.h)).toBe(true);
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i],
      q = points[i + 1];
    const x0 = Math.min(p.x, q.x),
      x1 = Math.max(p.x, q.x),
      y0 = Math.min(p.y, q.y),
      y1 = Math.max(p.y, q.y);
    expect(x1 < mid.x || x0 > mid.x + mid.w || y1 < mid.y || y0 > mid.y + mid.h).toBe(true);
  }
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

it('routes a startup feedback loop without crossing nodes or earlier arrows', () => {
  const nodes = [
    shape('idea'),
    shape('product', 'rect', 300),
    shape('market', 'rect', 600),
    shape('feedback', 'rect', 300, 240),
    shape('iterate', 'rect', 300, 480),
  ];
  const links = [
    ['idea', 'product'],
    ['product', 'market'],
    ['market', 'feedback'],
    ['feedback', 'iterate'],
    ['iterate', 'product'],
  ].map(([from, to], i) => normalizeItem({ id: `edge-${i}`, kind: 'arrow', from, to }));
  const scene = [...nodes, ...links];
  const paths = links.map((link) => routeConnector(link, scene).points);
  for (const points of paths)
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const node of nodes) {
        const throughInterior =
          a.x === b.x
            ? a.x > node.x &&
              a.x < node.x + node.w &&
              Math.max(a.y, b.y) > node.y &&
              Math.min(a.y, b.y) < node.y + node.h
            : a.y > node.y &&
              a.y < node.y + node.h &&
              Math.max(a.x, b.x) > node.x &&
              Math.min(a.x, b.x) < node.x + node.w;
        expect(throughInterior).toBe(false);
      }
    }
  for (let first = 0; first < paths.length; first++)
    for (let second = first + 1; second < paths.length; second++)
      for (let i = 1; i < paths[first].length; i++)
        for (let j = 1; j < paths[second].length; j++) {
          const a = paths[first][i - 1],
            b = paths[first][i],
            c = paths[second][j - 1],
            d = paths[second][j];
          if ((a.x === b.x) === (c.x === d.x)) continue;
          const [v1, v2, h1, h2] = a.x === b.x ? [a, b, c, d] : [c, d, a, b];
          expect(
            v1.x > Math.min(h1.x, h2.x) &&
              v1.x < Math.max(h1.x, h2.x) &&
              h1.y > Math.min(v1.y, v2.y) &&
              h1.y < Math.max(v1.y, v2.y),
          ).toBe(false);
        }
  // Query order and a caller's mutable lookup do not change lane allocation.
  const map = new Map(scene.map((item) => [item.id, item]));
  expect(routeConnector(links.at(-1)!, map).points).toEqual(paths.at(-1));
  map.set('feedback', { ...nodes[3], x: 0 });
  expect(routeConnector(links.at(-1)!, map).points).toEqual(
    routeConnector(links.at(-1)!, [...map.values()]).points,
  );
});

it('preserves explicit connector waypoints and attachment sides', () => {
  const a = shape('a'),
    b = shape('b', 'rect', 300, 200);
  const connector = normalizeItem({
    kind: 'connector',
    route: 'elbow',
    from: { item: 'a', side: 'left' },
    to: { item: 'b', side: 'bottom' },
    waypoints: [
      [-80, 300],
      [350, 300],
    ],
  });
  expect(routeConnector(connector, [a, b]).points).toEqual([
    { x: 0, y: 40 },
    { x: -80, y: 300 },
    { x: 350, y: 300 },
    { x: 350, y: 280 },
  ]);
  delete connector.waypoints;
  const automatic = routeConnector(connector, [a, b]).points;
  expect(automatic[0]).toEqual({ x: 0, y: 40 });
  expect(automatic.at(-1)).toEqual({ x: 350, y: 280 });
});

it('detaches at rendered ports on the same page when both targets are removed', () => {
  const doc = createDoc();
  doc.apply([
    {
      op: 'add',
      item: { id: 'group', kind: 'group', children: [shape('a'), shape('b', 'rect', 300, 200)] },
    },
    { op: 'add', item: { id: 'forward', kind: 'arrow', from: 'a', to: 'b' } },
    { op: 'add', item: { id: 'back', kind: 'arrow', from: 'b', to: 'a' } },
  ]);
  doc.apply([
    {
      op: 'page.add',
      page: {
        id: 'other',
        name: 'Other page',
        items: [{ ...shape('unrelated', 'rect', -200, -200), w: 1000, h: 1000 }],
      },
    },
  ]);
  const before = doc.toJSON();
  const paths = ['forward', 'back'].map(
    (id) => routeConnector(doc.get(id)!, before.pages[0].items).points,
  );
  expect(doc.apply([{ op: 'remove', id: 'group' }]).ok).toBe(true);
  for (const [index, id] of ['forward', 'back'].entries()) {
    expect(doc.get(id)!.from).toEqual(paths[index][0]);
    expect(doc.get(id)!.to).toEqual(paths[index].at(-1));
  }
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
});
