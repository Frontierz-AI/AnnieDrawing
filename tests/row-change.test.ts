import { describe, expect, it } from 'vitest';
import { createDoc, routePage, type Box, type Item, type Op, type Point } from '../src/core';

/** Wrapped flows with explicit geometry, so these tests do not depend on the layout. */
const node = (id: string, x: number, y: number, w: number, h: number) =>
  ({ id, kind: 'rect', x, y, w, h, text: { value: `${id}\nSecond line` } }) as Item;
const arrow = (id: string, from: string, to: string, extra: Partial<Item> = {}) =>
  ({
    id,
    kind: 'connector',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    route: 'elbow',
    heads: { end: 'arrow' },
    from: { item: from },
    to: { item: to },
    ...extra,
  }) as Item;
/** Arrows `a12`, `a23`, ... between `step1..stepN`. */
const chain = (count: number) =>
  Array.from({ length: count - 1 }, (_, i) =>
    arrow(`a${i + 1}${i + 2}`, `step${i + 1}`, `step${i + 2}`),
  );

/** The 0.8.1 request batch as laid out at 920x455: three nodes, then two. */
const twoRows = () => [
  node('step1', 0, 0, 344, 110),
  node('step2', 464, 0, 315, 110),
  node('step3', 899, 0, 344, 110),
  node('step4', 0, 230, 344, 110),
  node('step5', 464, 230, 344, 110),
  ...chain(5),
];
const threeRows = () => [
  node('step1', 0, 0, 320, 110),
  node('step2', 440, 0, 300, 110),
  node('step3', 860, 0, 340, 110),
  node('step4', 0, 230, 330, 110),
  node('step5', 450, 230, 310, 110),
  node('step6', 880, 230, 320, 110),
  node('step7', 0, 460, 300, 110),
  node('step8', 420, 460, 340, 110),
  ...chain(8),
];
/** A top-down flow wrapped into columns: three nodes, then two. */
const columns = () => [
  node('step1', 0, 0, 240, 90),
  node('step2', 0, 210, 240, 90),
  node('step3', 0, 420, 240, 90),
  node('step4', 360, 0, 260, 90),
  node('step5', 360, 210, 260, 90),
  ...chain(5),
];

type Segment = [Point, Point];
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((point, i) => [points[i], point]);
const horizontal = ([a, b]: Segment) => a.y === b.y;
const span = (p: number, q: number) => [Math.min(p, q), Math.max(p, q)];
/** Distance from an axis-aligned segment to a box, 0 when it touches or enters it. */
function boxDistance([a, b]: Segment, box: Box): number {
  const dx = Math.max(0, box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - box.x - box.w);
  const dy = Math.max(0, box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - box.y - box.h);
  return Math.hypot(dx, dy);
}
/** A segment that runs through the inside of a box, not only along or up to its border. */
function enters([a, b]: Segment, box: Box): boolean {
  const [x0, x1] = span(a.x, b.x),
    [y0, y1] = span(a.y, b.y);
  return x1 > box.x && x0 < box.x + box.w && y1 > box.y && y0 < box.y + box.h;
}
/** Two perpendicular segments that meet, or two collinear ones that share a length. */
function meet(s: Segment, t: Segment): boolean {
  if (horizontal(s) === horizontal(t)) {
    const axis = horizontal(s) ? 'x' : 'y',
      across = horizontal(s) ? 'y' : 'x';
    const [p0, p1] = span(s[0][axis], s[1][axis]),
      [q0, q1] = span(t[0][axis], t[1][axis]);
    return s[0][across] === t[0][across] && Math.min(p1, q1) > Math.max(p0, q0);
  }
  const [h, v] = horizontal(s) ? [s, t] : [t, s];
  const [x0, x1] = span(h[0].x, h[1].x),
    [y0, y1] = span(v[0].y, v[1].y);
  return v[0].x >= x0 && v[0].x <= x1 && h[0].y >= y0 && h[0].y <= y1;
}
type Route = ReturnType<typeof routePage>[number];
const sideOf = (point: Point, box: Box) =>
  point.x === box.x
    ? 'left'
    : point.x === box.x + box.w
      ? 'right'
      : point.y === box.y
        ? 'top'
        : point.y === box.y + box.h
          ? 'bottom'
          : 'inside';

function routed(items: Item[]) {
  const routes = routePage(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const route = (id: string) => routes.find((r) => r.id === id)!;
  const box = (id: string) => byId.get(id)!;
  const ends = (id: string) =>
    [box(id).from, box(id).to].map((end) => (end && 'item' in end ? end.item : ''));
  /** Orthogonal, no reversal, no crossing, clear of other nodes and lanes, no shortcut through its own nodes. */
  const clean = (id: string) => {
    const own = route(id),
      [from, to] = ends(id);
    for (const [a, b] of segments(own.points))
      expect(a.x === b.x || a.y === b.y, `${id} is orthogonal`).toBe(true);
    for (let i = 2; i < own.points.length; i++) {
      const [a, b, c] = own.points.slice(i - 2, i + 1);
      expect(
        (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y),
        `${id} turns at ${b.x},${b.y}`,
      ).toBe(false);
    }
    for (const item of items) {
      if (item.kind === 'connector') continue;
      for (const segment of segments(own.points))
        if (item.id === from || item.id === to)
          expect(enters(segment, item), `${id} through ${item.id}`).toBe(false);
        else expect(boxDistance(segment, item), `${id} near ${item.id}`).toBeGreaterThanOrEqual(16);
    }
    for (const other of routes) {
      if (other.id === id) continue;
      for (const s of segments(own.points))
        for (const t of segments(other.points)) {
          expect(meet(s, t), `${id} crosses ${other.id}`).toBe(false);
          if (horizontal(s) !== horizontal(t)) continue;
          const axis = horizontal(s) ? 'x' : 'y',
            across = horizontal(s) ? 'y' : 'x';
          const [p0, p1] = span(s[0][axis], s[1][axis]),
            [q0, q1] = span(t[0][axis], t[1][axis]);
          if (Math.min(p1, q1) > Math.max(p0, q0))
            expect(
              Math.abs(s[0][across] - t[0][across]),
              `${id} beside ${other.id}`,
            ).toBeGreaterThanOrEqual(12);
        }
    }
  };
  /** A connector between two nodes of one row is a two-point line at both vertical centers. */
  const straightRow = (id: string) => {
    const [from, to] = ends(id).map(box);
    expect(route(id).points, id).toEqual([
      { x: from.x + from.w, y: from.y + from.h / 2 },
      { x: to.x, y: to.y + to.h / 2 },
    ]);
  };
  const straightColumn = (id: string) => {
    const [from, to] = ends(id).map(box);
    expect(route(id).points, id).toEqual([
      { x: from.x + from.w / 2, y: from.y + from.h },
      { x: to.x + to.w / 2, y: to.y },
    ]);
  };
  /** The sides a connector leaves and enters. */
  const sides = (id: string) => {
    const [from, to] = ends(id).map(box),
      points = route(id).points;
    return [sideOf(points[0], from), sideOf(points.at(-1)!, to)];
  };
  return { routes, route, box, clean, straightRow, straightColumn, sides };
}

/** Every inner point of a route lies strictly between two coordinates on one axis. */
const inner = (points: Point[], axis: 'x' | 'y', low: number, high: number) =>
  points.slice(1, -1).every((point) => point[axis] > low && point[axis] < high);

describe('row-change connector of a wrapped flow', () => {
  it('keeps the neighbors of the row change straight at their vertical centers', () => {
    const { straightRow, route } = routed(twoRows());
    for (const id of ['a12', 'a23', 'a45']) {
      straightRow(id);
      expect(route(id).points).toHaveLength(2);
    }
  });

  it('leaves the bottom of the last node of a row and enters the top of the next row', () => {
    const { sides, clean, route, box } = routed(twoRows());
    expect(sides('a34')).toEqual(['bottom', 'top']);
    for (const id of ['a12', 'a23', 'a34', 'a45']) clean(id);
    // Through the gap between the rows.
    expect(inner(route('a34').points, 'y', box('step3').y + box('step3').h, box('step4').y)).toBe(
      true,
    );
  });

  it('does the same for each row change of a flow that wraps into three rows', () => {
    const { sides, clean, straightRow, route, box } = routed(threeRows());
    for (const id of ['a12', 'a23', 'a45', 'a56', 'a78']) straightRow(id);
    for (const [id, last, first] of [
      ['a34', 'step3', 'step4'],
      ['a67', 'step6', 'step7'],
    ]) {
      expect(sides(id), id).toEqual(['bottom', 'top']);
      expect(inner(route(id).points, 'y', box(last).y + box(last).h, box(first).y), id).toBe(true);
    }
    for (const { id } of routed(threeRows()).routes) clean(id);
  });

  it('changes columns of a wrapped top-down flow from the right side to the left side', () => {
    const { sides, clean, straightColumn, route, box } = routed(columns());
    for (const id of ['a12', 'a23', 'a45']) straightColumn(id);
    expect(sides('a34')).toEqual(['right', 'left']);
    expect(inner(route('a34').points, 'x', box('step3').x + box('step3').w, box('step4').x)).toBe(
      true,
    );
    for (const id of ['a12', 'a23', 'a34', 'a45']) clean(id);
  });

  it('enters the far side when the top of the next row is taken, still leaving neighbors straight', () => {
    // `a14` runs straight down from step1 into the top of step4. Any route into step4's left
    // side would cross it or circle the second row, so the row change comes up from below.
    for (const items of [
      [...twoRows(), arrow('a14', 'step1', 'step4')],
      [arrow('a14', 'step1', 'step4'), ...twoRows()],
    ]) {
      const { sides, clean, straightRow, straightColumn } = routed(items);
      for (const id of ['a12', 'a23', 'a45']) straightRow(id);
      straightColumn('a14');
      expect(sides('a34')).toEqual(['bottom', 'bottom']);
      for (const id of ['a12', 'a23', 'a34', 'a45', 'a14']) clean(id);
    }
  });

  it('enters the far side of the next column when its left side is taken', () => {
    const { sides, clean, straightColumn, straightRow } = routed([
      ...columns(),
      arrow('a14', 'step1', 'step4'),
    ]);
    for (const id of ['a12', 'a23', 'a45']) straightColumn(id);
    straightRow('a14');
    expect(sides('a34')).toEqual(['right', 'right']);
    for (const id of ['a12', 'a23', 'a34', 'a45', 'a14']) clean(id);
  });

  it('does not depend on the order of the connectors', () => {
    const items = twoRows();
    const forward = routed(items).routes;
    const backward = routed([
      ...items.filter((i) => i.kind !== 'connector'),
      ...items.filter((i) => i.kind === 'connector').reverse(),
    ]).routes;
    for (const route of forward)
      expect(backward.find((other) => other.id === route.id)!.points, route.id).toEqual(
        route.points,
      );
  });

  it('keeps explicit sides and waypoints as written', () => {
    const items = twoRows().map((item) =>
      item.id === 'a34'
        ? arrow('a34', 'step3', 'step4', {
            from: { item: 'step3', side: 'left' },
            to: { item: 'step4', side: 'right' },
          })
        : item,
    );
    const { sides } = routed(items);
    expect(sides('a34')).toEqual(['left', 'right']);
    const waypoints = twoRows().map((item) =>
      item.id === 'a34'
        ? arrow('a34', 'step3', 'step4', {
            waypoints: [
              [1300, 55],
              [1300, 400],
              [-50, 400],
              [-50, 285],
            ],
          })
        : item,
    );
    expect(routed(waypoints).route('a34').points.slice(1, -1)).toEqual([
      { x: 1300, y: 55 },
      { x: 1300, y: 400 },
      { x: -50, y: 400 },
      { x: -50, y: 285 },
    ]);
  });

  it('keeps the neighbors straight in the agent batch at the Founderz viewport', () => {
    const labels = [
      '1. Define el objetivo\n¿Qué debe conseguir la reunión?',
      '2. Elige a los asistentes\n¿Quién tiene que decidir?',
      '3. Prepara la agenda\nTemas y tiempo de cada punto',
      '4. Comparte el material\nDocumentos para leer antes',
      '5. Cierra con acuerdos\nResponsables y fechas',
    ];
    const ops: Op[] = [
      ...labels.map((value, i): Op => ({
        op: 'add',
        item: { id: `step${i + 1}`, kind: 'rect', text: { value } },
      })),
      ...[1, 2, 3, 4].map((i): Op => ({
        op: 'add',
        item: { id: `a${i}${i + 1}`, kind: 'arrow', from: `step${i}`, to: `step${i + 1}` },
      })),
    ];
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(ops, { origin: 'agent:fellow', viewport: { w: 920, h: 455 } });
    expect(result.ok).toBe(true);
    const { straightRow, sides, clean } = routed(doc.query());
    for (const id of ['a12', 'a23', 'a45']) straightRow(id);
    expect(sides('a34')).not.toContain('left');
    expect(sides('a34')).not.toContain('right');
    for (const id of ['a12', 'a23', 'a34', 'a45']) clean(id);
  });
});
