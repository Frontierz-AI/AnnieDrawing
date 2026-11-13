import { describe, expect, it } from 'vitest';
import { routePage, type Box, type Item, type Point } from '../src/core';
import { run, scenario, SCENARIOS } from './helpers/scenarios';

type Segment = [Point, Point];
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((point, i) => [points[i], point]);
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
const boxesOverlap = (p: Box, q: Box) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
const ends = (connector: Item) =>
  [connector.from, connector.to].map((end) => (end && 'item' in end ? end.item : ''));

/** Every scenario as the Founderz host applies it, then routed in one pass. */
function routed(id: string) {
  const items = run(scenario(id)).doc.query();
  return {
    items,
    lookup: new Map(items.map((item) => [item.id, item])),
    nodes: items.filter((item) => item.kind !== 'connector'),
    routes: routePage(items),
  };
}

describe('layout and routing together, Founderz scenarios', () => {
  for (const { id, name } of SCENARIOS)
    describe(`${id} ${name}`, () => {
      it('routes orthogonally without a reversal', () => {
        for (const route of routed(id).routes) {
          for (const [a, b] of segments(route.points))
            expect(a.x === b.x || a.y === b.y, `${route.id} is orthogonal`).toBe(true);
          for (let i = 2; i < route.points.length; i++) {
            const [a, b, c] = route.points.slice(i - 2, i + 1);
            expect(
              (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y),
              `${route.id} turns at ${b.x},${b.y}`,
            ).toBe(false);
          }
        }
      });

      it('keeps lanes 16 px from other nodes and 12 px from parallel lanes', () => {
        const { lookup, nodes, routes } = routed(id);
        for (const route of routes)
          for (const segment of segments(route.points))
            for (const node of nodes)
              if (!ends(lookup.get(route.id)!).includes(node.id))
                expect(
                  boxDistance(segment, node),
                  `${route.id} near ${node.id}`,
                ).toBeGreaterThanOrEqual(16);
        for (const first of routes)
          for (const second of routes) {
            if (first.id >= second.id) continue;
            for (const s of segments(first.points))
              for (const t of segments(second.points)) {
                if (horizontal(s) !== horizontal(t) || overlap(s, t) <= 0) continue;
                const gap = horizontal(s) ? Math.abs(s[0].y - t[0].y) : Math.abs(s[0].x - t[0].x);
                expect(gap, `${first.id} beside ${second.id}`).toBeGreaterThanOrEqual(12);
              }
          }
      });

      it('puts edge labels clear of nodes, other labels, and other connectors', () => {
        const { nodes, routes } = routed(id);
        const labels = routes.filter((route) => route.label);
        for (const route of labels) {
          const box = route.label!;
          for (const node of nodes)
            expect(boxesOverlap(box, node), `${route.id} label on ${node.id}`).toBe(false);
          for (const other of routes) {
            if (other.id === route.id) continue;
            if (other.label)
              expect(boxesOverlap(box, other.label), `${route.id} label on ${other.id} label`).toBe(
                false,
              );
            for (const segment of segments(other.points))
              expect(boxDistance(segment, box), `${route.id} label on ${other.id}`).toBeGreaterThan(
                0,
              );
          }
        }
      });
    });

  it('03 and 07 return to an earlier node in four points', () => {
    expect(routed('03').routes.find((route) => route.id === 'a5')!.points).toHaveLength(4);
    expect(routed('07').routes.find((route) => route.id === 'xa')!.points).toHaveLength(4);
  });

  it('10 brings the four inputs to one side of the target at four points', () => {
    const { lookup, routes } = routed('10');
    const mix = lookup.get('mix')!;
    const arrivals = ['e1', 'e2', 'e3', 'e4'].map((id) =>
      routes.find((route) => route.id === id)!.points.at(-1)!,
    );
    const side = (point: Point) =>
      point.x === mix.x
        ? 'left'
        : point.x === mix.x + mix.w
          ? 'right'
          : point.y === mix.y
            ? 'top'
            : 'bottom';
    expect(new Set(arrivals.map(side)).size).toBe(1);
    expect(new Set(arrivals.map((point) => `${point.x},${point.y}`)).size).toBe(4);
  });
});
