import { describe, expect, it } from 'vitest';
import {
  connectorLabel,
  defaultDoc,
  labelSize,
  routeConnector,
  routePage,
  type Box,
  type Item,
  type Point,
} from '../src/core';
import { exportSVG } from '../src/porter/svg';
import { fanInOut, fixtures, hub, insertBetween, loopBack, tree } from './routing-fixtures';

type Segment = [Point, Point];
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((point, i) => [points[i], point]);
const nodesOf = (items: Item[]) => items.filter((item) => item.kind !== 'connector');
const byId = (items: Item[]) => new Map(items.map((item) => [item.id, item]));
const routes = (items: Item[]) => new Map(routePage(items).map((route) => [route.id, route]));
const horizontal = ([a, b]: Segment) => a.y === b.y;
/** Length shared by the projections of two parallel segments on their common axis. */
function overlap([a, b]: Segment, [c, d]: Segment): number {
  const axis = horizontal([a, b]) ? 'x' : 'y';
  return (
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
    Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
  );
}
/** Distance from an axis-aligned segment to a box, 0 when it touches or enters it. */
function boxDistance([a, b]: Segment, box: Box): number {
  const dx = Math.max(0, box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - box.x - box.w);
  const dy = Math.max(0, box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - box.y - box.h);
  return Math.hypot(dx, dy);
}
/** A segment that passes through the interior of a box; touching an edge does not count. */
function enters([a, b]: Segment, box: Box): boolean {
  return (
    Math.max(a.x, b.x) > box.x &&
    Math.min(a.x, b.x) < box.x + box.w &&
    Math.max(a.y, b.y) > box.y &&
    Math.min(a.y, b.y) < box.y + box.h
  );
}
const boxesOverlap = (p: Box, q: Box) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
/** Proper crossings and shared lengths between two orthogonal routes. */
function crossings(first: Point[], second: Point[]): number {
  let count = 0;
  for (const s of segments(first))
    for (const t of segments(second)) {
      if (horizontal(s) === horizontal(t)) {
        const same = horizontal(s) ? s[0].y === t[0].y : s[0].x === t[0].x;
        if (same && overlap(s, t) > 0.01) count++;
        continue;
      }
      const [v, h] = horizontal(s) ? [t, s] : [s, t];
      if (
        v[0].x > Math.min(h[0].x, h[1].x) &&
        v[0].x < Math.max(h[0].x, h[1].x) &&
        h[0].y > Math.min(v[0].y, v[1].y) &&
        h[0].y < Math.max(v[0].y, v[1].y)
      )
        count++;
    }
  return count;
}
const rounded = (points: Point[]) =>
  points.map(({ x, y }) => ({ x: +x.toFixed(2), y: +y.toFixed(2) }));

describe('automatic elbow routing', () => {
  it('returns from a diamond to an earlier node in four points without a spur (03, 07)', () => {
    // Before: 1003,125 > 1003,141 > 1003,134 > 390,134 > 390,110 stepped back 7 px.
    expect(routes(loopBack()).get('a5')!.points).toEqual([
      { x: 1003, y: 125 },
      { x: 1003, y: 141 },
      { x: 390, y: 141 },
      { x: 390, y: 110 },
    ]);
    expect(routes(insertBetween()).get('xa')!.points).toEqual([
      { x: 384, y: 125 },
      { x: 384, y: 141 },
      { x: 90, y: 141 },
      { x: 90, y: 110 },
    ]);
    // The forward arrows stay straight on the row.
    expect(routes(insertBetween()).get('ax')!.points).toEqual([
      { x: 180, y: 55 },
      { x: 300, y: 55 },
    ]);
  });

  it('never leaves collinear points or a reversal after simplification', () => {
    for (const [name, make] of Object.entries(fixtures))
      for (const { id, points } of routePage(make())) {
        for (const [a, b] of segments(points)) {
          expect(a.x === b.x || a.y === b.y, `${name} ${id} is orthogonal`).toBe(true);
          expect(a.x !== b.x || a.y !== b.y, `${name} ${id} has no empty segment`).toBe(true);
        }
        for (let i = 2; i < points.length; i++) {
          const [a, b, c] = points.slice(i - 2, i + 1);
          expect(
            (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y),
            `${name} ${id} turns at ${b.x},${b.y}`,
          ).toBe(false);
        }
      }
  });

  it('keeps lanes 12 px apart and 16 px from nodes that are not their ends (hub, tree, fan-in)', () => {
    for (const make of [hub, tree, fanInOut]) {
      const items = make(),
        lookup = byId(items),
        routed = routePage(items);
      for (const { id, points } of routed) {
        const connector = lookup.get(id)!;
        const ends = [connector.from, connector.to].map((end) =>
          end && 'item' in end ? end.item : '',
        );
        for (const segment of segments(points))
          for (const node of nodesOf(items))
            if (!ends.includes(node.id))
              expect(
                boxDistance(segment, node),
                `${make.name} ${id} near ${node.id}`,
              ).toBeGreaterThanOrEqual(16);
      }
      for (const first of routed)
        for (const second of routed) {
          if (first.id >= second.id) continue;
          for (const s of segments(first.points))
            for (const t of segments(second.points)) {
              if (horizontal(s) !== horizontal(t) || overlap(s, t) <= 0) continue;
              const gap = horizontal(s) ? Math.abs(s[0].y - t[0].y) : Math.abs(s[0].x - t[0].x);
              expect(gap, `${make.name} ${first.id} beside ${second.id}`).toBeGreaterThanOrEqual(
                12,
              );
            }
        }
      for (const first of routed)
        for (const second of routed)
          if (first.id < second.id)
            expect(crossings(first.points, second.points), `${first.id} x ${second.id}`).toBe(0);
    }
  });

  it('brings a fan-in of four from the left into one side at four points without crossings', () => {
    const items = fanInOut(),
      mix = byId(items).get('mix')!,
      routed = routes(items);
    // Before: the four arrows reached the left, bottom, right, and top of the target.
    const arrivals = ['e1', 'e2', 'e3', 'e4'].map((id) => routed.get(id)!.points);
    for (const points of arrivals) {
      expect(points.at(-1)!.x).toBe(mix.x);
      expect(points.at(-2)!.y).toBe(points.at(-1)!.y);
    }
    const ys = arrivals.map((points) => points.at(-1)!.y);
    expect(new Set(ys).size).toBe(4);
    // Ordered like their sources, so they cannot cross on the way in.
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) expect(crossings(arrivals[i], arrivals[j])).toBe(0);
  });

  it('spreads connectors that share a side in the order of their far ends', () => {
    const routed = routes(hub());
    // Before: two spokes left the hub from one point and shared their first segment.
    const left = ['a1', 'a3', 'a5'].map((id) => routed.get(id)!.points[0]);
    const right = ['a2', 'a4', 'a6'].map((id) => routed.get(id)!.points[0]);
    for (const side of [left, right]) {
      expect(new Set(side.map((point) => point.y)).size).toBe(3);
      expect(side.map((point) => point.y)).toEqual(
        [...side.map((point) => point.y)].sort((a, b) => a - b),
      );
    }
    expect(left.every((point) => point.x < 600)).toBe(true);
    expect(right.every((point) => point.x > 600)).toBe(true);
    // The spoke level with the hub is a straight arrow from the middle of the side.
    expect(routed.get('a3')!.points).toEqual([
      { x: 500, y: 310 },
      { x: 280, y: 310 },
    ]);
  });

  it('enters each child from the side that faces its parent', () => {
    const items = tree(),
      lookup = byId(items),
      routed = routes(items);
    for (const { id, points } of routed.values()) {
      const connector = lookup.get(id)!;
      const parent = lookup.get((connector.from as { item: string }).item)!;
      const child = lookup.get((connector.to as { item: string }).item)!;
      expect(points[0].y, `${id} leaves the bottom`).toBe(parent.y + parent.h);
      expect(points.at(-1)!.y, `${id} enters the top`).toBe(child.y);
    }
  });

  it('keeps explicit sides, anchors, waypoints, straight, and curved routes as written', () => {
    const items = fanInOut();
    items.push(
      {
        id: 'side',
        kind: 'connector',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        route: 'elbow',
        from: { item: 'i2', side: 'right' },
        to: { item: 'mix', side: 'left' },
      },
      {
        id: 'anchor',
        kind: 'connector',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        route: 'elbow',
        from: { item: 'i3', anchor: [1, 0.25] },
        to: { item: 'mix', anchor: [0, 0.9] },
      },
      {
        id: 'way',
        kind: 'connector',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        route: 'elbow',
        from: { item: 'i4' },
        to: { item: 'o2' },
        waypoints: [[400, 560]],
      },
      {
        id: 'line',
        kind: 'connector',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        from: { item: 'o1', side: 'bottom' },
        to: { item: 'o2', side: 'top' },
        text: { value: 'straight' },
      },
      {
        id: 'bend',
        kind: 'connector',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        route: 'curve',
        from: { item: 'i1' },
        to: { item: 'o1' },
      },
    );
    const routed = routes(items);
    expect(routed.get('side')!.points[0]).toEqual({ x: 300, y: 190 });
    expect(routed.get('side')!.points.at(-1)).toEqual({ x: 600, y: 260 });
    expect(routed.get('anchor')!.points[0]).toEqual({ x: 300, y: 305 });
    expect(routed.get('anchor')!.points.at(-1)).toEqual({ x: 600, y: 292 });
    expect(routed.get('way')!.points[1]).toEqual({ x: 400, y: 560 });
    expect(routed.get('way')!.points).toHaveLength(3);
    expect(routed.get('line')!.points).toEqual([
      { x: 1440, y: 140 },
      { x: 1440, y: 380 },
    ]);
    expect(routed.get('line')!.label!.x + routed.get('line')!.label!.w / 2).toBe(1440);
    expect(routed.get('bend')!.points).toHaveLength(25);
  });

  it('routes the same with a map, an array, or a whole page, and in any query order', () => {
    for (const make of Object.values(fixtures)) {
      const items = make(),
        map = byId(items);
      const page = routePage(items);
      for (const { id, points, label } of [...page].reverse()) {
        expect(routeConnector(map.get(id)!, map).points).toEqual(points);
        expect(routeConnector(map.get(id)!, items).points).toEqual(points);
        expect(connectorLabel(map.get(id)!, map)).toEqual(label);
      }
    }
  });

  it('routes a page in time about linear in its connectors', () => {
    const page = (rows: number) => {
      const items: Item[] = [];
      for (let i = 0; i < rows * 13; i++)
        items.push({
          id: `n${i}`,
          kind: 'rect',
          x: (i % 13) * 260,
          y: Math.floor(i / 13) * 200,
          w: 180,
          h: 110,
        });
      for (let i = 0; i < rows * 13; i++)
        for (const next of [i + 1, i + 13])
          if (next < rows * 13 && (next !== i + 1 || next % 13))
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
              ...(i % 5 ? {} : { text: { value: 'next' } }),
            });
      return items;
    };
    const perConnector = (rows: number) => {
      const items = page(rows),
        connectors = items.filter((item) => item.kind === 'connector');
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        expect(routePage(items)).toHaveLength(connectors.length);
        best = Math.min(best, performance.now() - start);
      }
      return best / connectors.length;
    };
    perConnector(4);
    const small = perConnector(10),
      large = perConnector(40);
    console.info(
      `Routing per connector: ${(small * 1000).toFixed(1)}us at ~240, ${(large * 1000).toFixed(1)}us at ~990`,
    );
    // Quadratic routing made each connector about four times slower at four times the page.
    expect(large / small).toBeLessThan(2.5);
  });
});

describe('connector labels', () => {
  it('measures a label box headlessly with room for its wrapped lines', () => {
    expect(labelSize({ value: 'always' })).toEqual({ w: 92, h: 29 });
    // Short labels with wide capitals keep half an em of room, so they do not wrap mid-word.
    expect(labelSize({ value: 'No' }).w).toBeGreaterThanOrEqual(2 * 18 * 0.8 + 16);
    const long = labelSize({ value: 'when something is missing' });
    expect(long.w).toBeLessThanOrEqual(240);
    expect(long.h).toBe(51);
  });

  it('keeps fan-out labels off nodes, other labels, and other connectors (10)', () => {
    const items = fanInOut(),
      routed = routePage(items);
    const labels = routed.filter((route) => route.label);
    expect(labels.map((route) => route.id)).toEqual(['e5', 'e6']);
    for (const { id, label } of labels) {
      for (const node of nodesOf(items))
        expect(boxesOverlap(label!, node), `${id} label on ${node.id}`).toBe(false);
      for (const other of routed) {
        if (other.id === id) continue;
        if (other.label)
          expect(boxesOverlap(label!, other.label), `${id} on ${other.id}`).toBe(false);
        for (const segment of segments(other.points))
          expect(enters(segment, label!), `${id} label over ${other.id}`).toBe(false);
      }
      // The label sits on its own route.
      const center = { x: label!.x + label!.w / 2, y: label!.y + label!.h / 2 };
      expect(
        segments(routed.find((route) => route.id === id)!.points).some(
          ([a, b]) =>
            Math.min(a.x, b.x) <= center.x &&
            center.x <= Math.max(a.x, b.x) &&
            Math.min(a.y, b.y) <= center.y &&
            center.y <= Math.max(a.y, b.y),
        ),
      ).toBe(true);
    }
  });

  it('exports labels at the positions the board uses', () => {
    const items = fanInOut(),
      doc = defaultDoc();
    doc.pages[0].items = items;
    // A second page must not change routes or labels on the first.
    doc.pages.push({
      id: 'other',
      name: 'Other',
      items: [{ id: 'far', kind: 'rect', x: 900, y: 380, w: 200, h: 200 }],
    });
    const svg = exportSVG(doc, items);
    for (const { id, label } of routePage(items).filter((route) => route.label)) {
      const group = svg.slice(svg.indexOf(`data-ad-id="${id}"`));
      const rect = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
        group.slice(group.indexOf('</title>')),
      )!;
      expect(rect.slice(1).map(Number)).toEqual([label!.x, label!.y, label!.w, label!.h]);
      const text = /<text x="([\d.-]+)"/.exec(group)!;
      expect(Number(text[1])).toBeCloseTo(label!.x + label!.w / 2, 6);
    }
    expect(rounded(routePage(items)[5].points)).toEqual(
      rounded(
        routeConnector(
          items.find((item) => item.id === 'e6')!,
          byId(items),
        ).points,
      ),
    );
  });

  it('places labels in document order so a later label avoids an earlier one', () => {
    const items = fanInOut();
    const e6 = items.find((item) => item.id === 'e6')!;
    const alone = connectorLabel(e6, byId(items.filter((item) => item.id !== 'e5')))!;
    const together = connectorLabel(e6, byId(items))!;
    const e5 = connectorLabel(
      items.find((item) => item.id === 'e5')!,
      byId(items),
    )!;
    expect(boxesOverlap(together, e5)).toBe(false);
    expect(alone).toBeDefined();
    expect(connectorLabel({ ...e6, text: undefined }, byId(items))).toBeUndefined();
  });
});
