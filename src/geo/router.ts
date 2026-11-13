import RBush from 'rbush';
import type { Box, Endpoint, Item, Outline, Point } from '../core/types';
import {
  boxFromPoints,
  boxCorners,
  boundsOf,
  centerOf,
  flattenItems,
  lookupItem,
  type ItemLookup,
} from './box';
import { labelSize, placeLabel } from './label';
import { distance, rotatePoint } from './vec';
import { isOverlay } from '../core/mark';

const CLEAR = 16;
/** Parallel lanes of different connectors stay at least this far apart. */
const LANE = 12;
const SKIP_OBSTACLE = new Set(['connector', 'line', 'path', 'group']);
export type OutlineResolver = (item: Item) => Outline | Outline[] | undefined;

function endpointItem(
  id: string,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): Item | undefined {
  const item = lookupItem(lookup, id);
  if (item?.kind !== 'group') return item;
  // Connectors cannot define their own target's bounds without a routing cycle.
  const content = flattenItems(item.children ?? [])
    .filter((child) => child.kind !== 'connector' && child.kind !== 'group' && !isOverlay(child))
    .map((child) => lookupItem(lookup, child.id) ?? child);
  return content.length ? { ...item, ...boundsOf(content, lookup, outline), rotation: 0 } : item;
}
function endpointCenter(
  endpoint: Endpoint | undefined,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): Point {
  if (!endpoint) return { x: 0, y: 0 };
  if ('item' in endpoint) {
    const item = endpointItem(endpoint.item, lookup, outline);
    return item ? centerOf(item) : { x: 0, y: 0 };
  }
  return endpoint;
}
function outlineIntersection(
  item: Item,
  direction: Point,
  resolver?: OutlineResolver,
): Point | undefined {
  const resolved = resolver?.(item);
  if (!resolved) return undefined;
  const outlines = Array.isArray(resolved) ? resolved : [resolved];
  const origin = { x: item.w / 2, y: item.h / 2 },
    lengthSquared = direction.x ** 2 + direction.y ** 2;
  if (!lengthSquared) return undefined;
  const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
  let furthest = -Infinity;
  for (const shape of outlines) {
    const count = shape.points.length;
    for (let index = 0; index < count - (shape.closed ? 0 : 1); index++) {
      const a = shape.points[index],
        b = shape.points[(index + 1) % count];
      const edge = { x: b.x - a.x, y: b.y - a.y },
        offset = { x: a.x - origin.x, y: a.y - origin.y };
      const determinant = cross(direction, edge);
      if (Math.abs(determinant) < 1e-10) {
        if (Math.abs(cross(offset, direction)) < 1e-10)
          for (const point of [a, b]) {
            const t =
              ((point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y) /
              lengthSquared;
            if (t >= 0) furthest = Math.max(furthest, t);
          }
        continue;
      }
      const t = cross(offset, edge) / determinant,
        u = cross(offset, direction) / determinant;
      if (t >= -1e-10 && u >= -1e-10 && u <= 1 + 1e-10)
        furthest = Math.max(furthest, Math.max(0, t));
    }
  }
  return Number.isFinite(furthest)
    ? {
        x: item.x + origin.x + direction.x * furthest,
        y: item.y + origin.y + direction.y * furthest,
      }
    : undefined;
}
export function resolveEndpoint(
  endpoint: Endpoint | undefined,
  other: Endpoint | Point | undefined,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): Point {
  if (!endpoint) return { x: 0, y: 0 };
  if (!('item' in endpoint)) return { x: endpoint.x, y: endpoint.y };
  const item = endpointItem(endpoint.item, lookup, outline);
  if (!item) return { x: 0, y: 0 };
  const c = centerOf(item);
  let p: Point;
  if (endpoint.anchor) {
    p = { x: item.x + item.w * endpoint.anchor[0], y: item.y + item.h * endpoint.anchor[1] };
  } else if (endpoint.side && endpoint.side !== 'auto') {
    p =
      endpoint.side === 'top'
        ? { x: c.x, y: item.y }
        : endpoint.side === 'bottom'
          ? { x: c.x, y: item.y + item.h }
          : endpoint.side === 'left'
            ? { x: item.x, y: c.y }
            : { x: item.x + item.w, y: c.y };
    p = outlineIntersection(item, { x: p.x - c.x, y: p.y - c.y }, outline) ?? p;
  } else {
    const target = rotatePoint(endpointCenter(other, lookup, outline), c, -(item.rotation ?? 0));
    let dx = target.x - c.x,
      dy = target.y - c.y;
    if (!dx && !dy) dx = 1;
    const rx = Math.max(item.w / 2, 0.001),
      ry = Math.max(item.h / 2, 0.001);
    const t =
      item.kind === 'ellipse'
        ? 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry))
        : item.kind === 'diamond'
          ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
          : Math.min(rx / Math.max(Math.abs(dx), 0.0001), ry / Math.max(Math.abs(dy), 0.0001));
    p = outlineIntersection(item, { x: dx, y: dy }, outline) ?? {
      x: c.x + dx * t,
      y: c.y + dy * t,
    };
  }
  return rotatePoint(p, c, item.rotation ?? 0);
}

function listedItems(lookup?: ItemLookup): Item[] {
  if (!lookup) return [];
  if (Array.isArray(lookup)) return flattenItems(lookup);
  if (lookup instanceof Map) return [...lookup.values()];
  if (typeof lookup === 'function') return [];
  return Object.values(lookup);
}

function obstacleBox(item: Item): Box | undefined {
  if (item.hidden || SKIP_OBSTACLE.has(item.kind) || isOverlay(item) || item.w <= 0 || item.h <= 0)
    return;
  return boxFromPoints(boxCorners(item, item.rotation));
}

function segmentHits(a: Point, b: Point, box: Box, pad: number): boolean {
  const x = box.x - pad,
    y = box.y - pad,
    r = box.x + box.w + pad,
    btm = box.y + box.h + pad;
  const x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x),
    y0 = Math.min(a.y, b.y),
    y1 = Math.max(a.y, b.y);
  if (x1 < x || x0 > r || y1 < y || y0 > btm) return false;
  if (a.x === b.x) return a.x >= x && a.x <= r && y0 <= btm && y1 >= y;
  if (a.y === b.y) return a.y >= y && a.y <= btm && x0 <= r && x1 >= x;
  return true;
}

function pathLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
}

interface Entry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
interface NodeEntry extends Entry {
  id: string;
  box: Box;
}
/** One segment of a routed connector; `owner` is the connector's index in the pass. */
interface LaneEntry extends Entry {
  a: Point;
  b: Point;
  owner: number;
  first: boolean;
  last: boolean;
}
/** What a route avoids: node boxes, and the lanes of connectors before `limit` in document order. */
interface Field {
  nodes: RBush<NodeEntry>;
  lanes: RBush<LaneEntry>;
  labels: RBush<Entry & { owner: number }>;
  limit: number;
}
const around = (a: Point, b: Point, pad = 0): Entry => ({
  minX: Math.min(a.x, b.x) - pad,
  minY: Math.min(a.y, b.y) - pad,
  maxX: Math.max(a.x, b.x) + pad,
  maxY: Math.max(a.y, b.y) + pad,
});
const boxEntry = (box: Box): Entry =>
  around({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h });
const overlaps = (p: Entry, q: Entry) =>
  p.minX < q.maxX && q.minX < p.maxX && p.minY < q.maxY && q.minY < p.maxY;

function field(items: Item[]): Field {
  const nodes = new RBush<NodeEntry>();
  nodes.load(
    items.flatMap((item) => {
      const box = obstacleBox(item);
      return box ? [{ ...boxEntry(box), id: item.id, box }] : [];
    }),
  );
  return { nodes, lanes: new RBush(), labels: new RBush(), limit: Infinity };
}

function reserve(area: Field, points: Point[], owner: number): void {
  area.lanes.load(
    points.slice(1).map((b, i) => {
      const a = points[i];
      return { ...around(a, b), a, b, owner, first: !i, last: i === points.length - 2 };
    }),
  );
}

/** Shared endpoints are allowed; crossings and shared lengths consume a lane. */
function crosses(a: Point, b: Point, first: boolean, last: boolean, lane: LaneEntry): boolean {
  const c = lane.a,
    d = lane.b;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const ex = d.x - c.x,
    ey = d.y - c.y;
  const determinant = dx * ey - dy * ex;
  if (Math.abs(determinant) < 1e-8) {
    if (Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) > 1e-8) return false;
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    return (
      Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) >
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) + 0.01
    );
  }
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return false;
  const atEnd = (first && t < 1e-8) || (last && t > 1 - 1e-8);
  return !(atEnd && ((lane.first && u < 1e-8) || (lane.last && u > 1 - 1e-8)));
}

/** Parallel lanes side by side closer than LANE read as one line. */
function crowds(a: Point, b: Point, lane: LaneEntry): boolean {
  const c = lane.a,
    d = lane.b;
  const along = a.y === b.y && c.y === d.y ? 'x' : a.x === b.x && c.x === d.x ? 'y' : undefined;
  if (!along) return false;
  const across = along === 'x' ? 'y' : 'x';
  return (
    Math.abs(a[across] - c[across]) < LANE &&
    Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along])) -
      Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along])) >
      0.01
  );
}

/** Crossings and crowding against earlier lanes. */
function tangle(points: Point[], area: Field): number {
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    for (const lane of area.lanes.search(around(a, b, LANE)))
      if (lane.owner < area.limit)
        count += +crosses(a, b, i === 1, i === points.length - 1, lane) + +crowds(a, b, lane);
  }
  return count;
}

/** Segments through nodes, and segments closer than CLEAR to a node that is not an endpoint. */
function nodeCost(points: Point[], area: Field, from?: string, to?: string): [number, number] {
  let hits = 0,
    crowd = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    for (const node of area.nodes.search(around(a, b, CLEAR))) {
      // Port stubs leave their own node, which may be rotated or rounded.
      if (segmentHits(a, b, node.box, -0.01))
        hits += +!((i === 1 && node.id === from) || (i === points.length - 1 && node.id === to));
      else if (node.id !== from && node.id !== to && segmentHits(a, b, node.box, CLEAR - 0.01))
        crowd++;
    }
  }
  return [hits, crowd];
}

const dedupe = (points: Point[]) =>
  points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);

/** Collinear triples that turn back on themselves. */
function reversals(points: Point[]): number {
  let count = 0;
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2],
      b = points[i - 1],
      c = points[i];
    if (
      (a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) < 0) ||
      (a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) < 0)
    )
      count++;
  }
  return count;
}

/** Merge every collinear run, so no simplified route steps back over itself. */
function simplifyRoute(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of dedupe(points)) {
    const last = result.at(-1),
      before = result.at(-2);
    if (
      before &&
      last &&
      ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))
    )
      result.pop();
    const end = result.at(-1);
    if (end?.x !== point.x || end.y !== point.y) result.push(point);
  }
  return result;
}

interface Port {
  point: Point;
  exit: Point;
}

/** One orthogonal channel between two port exits: vertical first (shared Y) or horizontal first. */
function elbow(start: Port, end: Port, vertical: boolean, channel?: number): Point[] {
  const s = start.exit,
    e = end.exit,
    key = vertical ? 'y' : 'x';
  let c = channel ?? (s[key] + e[key]) / 2;
  // The default channel never lies behind an exit, so the route does not step back to reach it.
  if (channel === undefined)
    for (const port of [start, end]) {
      const out = port.exit[key] - port.point[key];
      if ((c - port.exit[key]) * out < 0) c = port.exit[key];
    }
  return [
    start.point,
    s,
    vertical ? { x: s.x, y: c } : { x: c, y: s.y },
    vertical ? { x: e.x, y: c } : { x: c, y: e.y },
    e,
    end.point,
  ];
}

type Side = 'top' | 'right' | 'bottom' | 'left';
const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
/** First side of an automatic end, and its place along that side from 0 to 1 when spread. */
interface Slot {
  side: Side;
  f?: number;
}
/** Automatic attachment of one elbow: the axis it leaves along and the slot of each end. */
interface Ends {
  axis?: 'x' | 'y';
  from?: Slot;
  to?: Slot;
}

/** A point `f` (0 to 1) along a side, on the outline of rectangles, ellipses, and diamonds. */
function sidePoint(item: Item, side: Side, f: number): Point {
  const t = (f - 0.5) * (item.kind === 'ellipse' || item.kind === 'diamond' ? 1.2 : 2);
  const reach =
    item.kind === 'ellipse' ? Math.sqrt(1 - t * t) : item.kind === 'diamond' ? 1 - Math.abs(t) : 1;
  const c = centerOf(item);
  const sign = side === 'left' || side === 'top' ? -1 : 1;
  return side === 'left' || side === 'right'
    ? { x: c.x + (sign * reach * item.w) / 2, y: c.y + (t * item.h) / 2 }
    : { x: c.x + (t * item.w) / 2, y: c.y + (sign * reach * item.h) / 2 };
}

function ports(
  endpoint: Endpoint | undefined,
  other: Endpoint | undefined,
  lookup: ItemLookup | undefined,
  outline: OutlineResolver | undefined,
  axis?: 'x' | 'y',
  slot?: Slot,
): Port[] {
  const item =
    endpoint && 'item' in endpoint ? endpointItem(endpoint.item, lookup, outline) : undefined;
  if (!item || !endpoint || !('item' in endpoint)) {
    const point = resolveEndpoint(endpoint, other, lookup, outline);
    return [{ point, exit: point }];
  }
  const center = centerOf(item);
  const target = rotatePoint(endpointCenter(other, lookup, outline), center, -(item.rotation ?? 0));
  const horizontal = target.x >= center.x ? 'right' : 'left';
  const vertical = target.y >= center.y ? 'bottom' : 'top';
  let sides: Side[] = (
    axis && !item.rotation
      ? axis === 'x'
      : Math.abs(target.x - center.x) / Math.max(1, item.w) >=
        Math.abs(target.y - center.y) / Math.max(1, item.h)
  )
    ? [horizontal, vertical, opposite[vertical], opposite[horizontal]]
    : [vertical, horizontal, opposite[horizontal], opposite[vertical]];
  if (slot) sides = [slot.side, ...sides.filter((side) => side !== slot.side)];
  const endpoints =
    endpoint.anchor || (endpoint.side && endpoint.side !== 'auto')
      ? [endpoint]
      : sides.map((side) => ({ ...endpoint, side }));
  // Orthogonal exits remain outside the target even for rotated shapes.
  const box = boxFromPoints(boxCorners(item, item.rotation));
  return endpoints.map((end, index) => {
    const spread = !index && slot?.f !== undefined;
    const point = spread
      ? sidePoint(item, sides[0], slot.f!)
      : resolveEndpoint(end, other, lookup, outline);
    const dx = point.x - center.x,
      dy = point.y - center.y;
    const across = spread
      ? sides[0] === 'left' || sides[0] === 'right'
      : Math.abs(dx) / Math.max(1, box.w) >= Math.abs(dy) / Math.max(1, box.h);
    const exit = across
      ? { x: dx >= 0 ? box.x + box.w + CLEAR : box.x - CLEAR, y: point.y }
      : { x: point.x, y: dy >= 0 ? box.y + box.h + CLEAR : box.y - CLEAR };
    return { point, exit };
  });
}

/**
 * Choose the axis and first side of every automatic elbow, and spread connectors that share a side.
 * Boxes apart on one axis face along it. Otherwise each node's clear connectors vote, then the
 * wider gap decides. A connector whose facing gap holds another node, or that runs back along an
 * earlier connector, takes the other axis and leaves the right or bottom side of both ends, so a
 * loop returns under or beside the row. Connectors on one side are ordered by the position of
 * their far end, so they leave without crossing.
 */
function attach(
  items: Item[],
  lookup: ItemLookup,
  outline?: OutlineResolver,
  nodes?: RBush<NodeEntry>,
): Map<number, Ends> {
  const ends = new Map<number, Ends>(),
    votes = new Map<string, number>(),
    pairs = new Set<string>(),
    gaps = new Map<number, [number, number, Box, Box]>(),
    sides = new Map<string, [Slot, number, number][]>();
  const node = (end?: Endpoint) =>
    end && 'item' in end ? endpointItem(end.item, lookup, outline) : undefined;
  const bounds = (end?: Endpoint): Box | undefined => {
    const target = node(end);
    if (target) return boxFromPoints(boxCorners(target, target.rotation));
    return end && !('item' in end) ? { x: end.x, y: end.y, w: 0, h: 0 } : undefined;
  };
  const key = (end?: Endpoint) => (end && 'item' in end ? end.item : '');
  items.forEach((item, index) => {
    if (
      item.kind !== 'connector' ||
      item.hidden ||
      item.route !== 'elbow' ||
      item.waypoints?.length
    )
      return;
    const a = bounds(item.from),
      b = bounds(item.to);
    if (!a || !b) return;
    const gx = Math.max(b.x - a.x - a.w, a.x - b.x - b.w),
      gy = Math.max(b.y - a.y - a.h, a.y - b.y - b.h);
    gaps.set(index, [gx, gy, a, b]);
    if (gx > 0 !== gy > 0)
      for (const end of [key(item.from), key(item.to)])
        if (end) votes.set(end, (votes.get(end) ?? 0) + (gx > 0 ? 1 : -1));
  });
  for (const [index, [gx, gy, a, b]] of gaps) {
    const item = items[index],
      from = key(item.from),
      to = key(item.to);
    const vote = (votes.get(from) ?? 0) + (votes.get(to) ?? 0);
    let axis: Ends['axis'] =
      gx > 0 !== gy > 0
        ? gx > 0
          ? 'x'
          : 'y'
        : vote
          ? vote > 0
            ? 'x'
            : 'y'
          : gx > 0
            ? gx >= gy
              ? 'x'
              : 'y'
            : undefined;
    // The gap between two boxes that face each other across one axis.
    const gap: Entry | undefined =
      axis === 'x' && gy < 0
        ? {
            minX: Math.min(a.x + a.w, b.x + b.w),
            maxX: Math.max(a.x, b.x),
            minY: Math.max(a.y, b.y),
            maxY: Math.min(a.y + a.h, b.y + b.h),
          }
        : axis === 'y' && gx < 0
          ? {
              minY: Math.min(a.y + a.h, b.y + b.h),
              maxY: Math.max(a.y, b.y),
              minX: Math.max(a.x, b.x),
              maxX: Math.min(a.x + a.w, b.x + b.w),
            }
          : undefined;
    const flip =
      !!axis &&
      ((!!from && !!to && pairs.has(`${to}>${from}`)) ||
        (!!gap &&
          !!nodes?.search(gap).some((n) => n.id !== from && n.id !== to && overlaps(gap, n))));
    if (from && to) pairs.add(`${from}>${to}`);
    if (flip) axis = axis === 'x' ? 'y' : 'x';
    const result: Ends = { axis };
    ends.set(index, result);
    if (!axis) continue;
    for (const [end, own, far] of [
      ['from', a, b],
      ['to', b, a],
    ] as const) {
      const endpoint = item[end],
        target = node(endpoint);
      if (
        !target ||
        target.rotation ||
        !endpoint ||
        !('item' in endpoint) ||
        endpoint.anchor ||
        (endpoint.side && endpoint.side !== 'auto')
      )
        continue;
      const c = centerOf(own),
        o = centerOf(far);
      const slot: Slot = {
        side:
          axis === 'x'
            ? flip || o.x >= c.x
              ? 'right'
              : 'left'
            : flip || o.y >= c.y
              ? 'bottom'
              : 'top',
      };
      result[end] = slot;
      if (outline?.(target)) continue;
      const list = sides.get(`${target.id}|${slot.side}`) ?? [];
      list.push([slot, axis === 'x' ? o.y : o.x, index]);
      sides.set(`${target.id}|${slot.side}`, list);
    }
  }
  for (const list of sides.values()) {
    list.sort((p, q) => p[1] - q[1] || p[2] - q[2]);
    list.forEach(([slot], k) => (slot.f = (k + 1) / (list.length + 1)));
  }
  return ends;
}

type Cost = [number, number, number];
/**
 * Prefer clear lanes. Only automatic ports may move to another side of a node. A route is ranked
 * by node hits and reversals, then crossings plus lanes or nodes that come too close, then length.
 */
function clearElbow(
  item: Item,
  lookup: ItemLookup | undefined,
  outline: OutlineResolver | undefined,
  area: Field,
  ends: Ends,
): Point[] {
  const fromId = item.from && 'item' in item.from ? item.from.item : undefined;
  const toId = item.to && 'item' in item.to ? item.to.item : undefined;
  const starts = ports(item.from, item.to, lookup, outline, ends.axis, ends.from);
  const finishes = ports(item.to, item.from, lookup, outline, ends.axis, ends.to);
  let best: Point[] = [],
    bestCost: Cost = [Infinity, Infinity, Infinity];
  const better = (cost: Cost, than: Cost) => {
    const i = cost.findIndex((value, k) => value !== than[k]);
    return i >= 0 && cost[i] < than[i];
  };
  const consider = (start: Port, end: Port, vertical: boolean, channel?: number) => {
    const raw = dedupe(elbow(start, end, vertical, channel)),
      points = simplifyRoute(raw);
    const [hits, crowd] = nodeCost(raw, area, fromId, toId);
    const key = vertical ? 'y' : 'x';
    const shift =
      channel === undefined ? 0 : Math.abs(channel - (start.exit[key] + end.exit[key]) / 2) / 4;
    const cost: Cost = [
      hits + reversals(raw),
      crowd + tangle(points, area),
      pathLength(points) + points.length * CLEAR + shift,
    ];
    if (better(cost, bestCost)) [best, bestCost] = [points, cost];
    return { raw, cost };
  };
  for (const start of starts)
    for (const end of finishes) {
      const vertical = start.exit.y !== start.point.y;
      let seeds = [consider(start, end, vertical), consider(start, end, !vertical)];
      // The common case needs no search beyond the facing ports and their default channel.
      if (start === starts[0] && end === finishes[0] && !seeds[0].cost[0] && !seeds[0].cost[1])
        return best;
      // Try channels just outside nodes and beside lanes near the routes so far, twice at most.
      for (let round = 0; round < 2 && seeds.length; round++) {
        const near = new Map<Entry, number>();
        for (const { raw } of seeds)
          for (let i = 1; i < raw.length; i++) {
            for (const node of area.nodes.search(around(raw[i - 1], raw[i], CLEAR)))
              near.set(node, CLEAR);
            for (const lane of area.lanes.search(around(raw[i - 1], raw[i], LANE)))
              if (lane.owner < area.limit) near.set(lane, LANE);
          }
        const tried = [...near]
          .slice(0, 16)
          .flatMap(([box, gap]) => [
            consider(start, end, true, box.minY - gap),
            consider(start, end, true, box.maxY + gap),
            consider(start, end, false, box.minX - gap),
            consider(start, end, false, box.maxX + gap),
          ]);
        const next = tried.reduce<(typeof tried)[number] | undefined>(
          (found, candidate) => (!found || better(candidate.cost, found.cost) ? candidate : found),
          undefined,
        );
        seeds = next && (bestCost[0] || bestCost[1]) ? [next] : [];
      }
    }
  return best;
}

export interface ConnectorGeometry {
  points: Point[];
  d: string;
  midpoint: Point;
  bounds: Box;
}
function connectorGeometry(
  item: Item,
  lookup: ItemLookup | undefined,
  outline: OutlineResolver | undefined,
  area?: Field,
  ends?: Ends,
): ConnectorGeometry {
  const start = resolveEndpoint(item.from, item.to, lookup, outline),
    end = resolveEndpoint(item.to, item.from, lookup, outline);
  let points = [start, ...(item.waypoints ?? []).map(([x, y]) => ({ x, y })), end],
    d = '';
  if (item.route === 'elbow' && !item.waypoints?.length) {
    points = clearElbow(
      item,
      lookup,
      outline,
      area ?? field([]),
      ends ?? (lookup ? attach([item], lookup, outline).get(0) : undefined) ?? {},
    );
  }
  if (item.route === 'curve' && !item.waypoints?.length) {
    const dx = end.x - start.x,
      dy = end.y - start.y,
      control = { x: (start.x + end.x) / 2 - dy * 0.22, y: (start.y + end.y) / 2 + dx * 0.22 };
    d = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    points = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24,
        u = 1 - t;
      return {
        x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
      };
    });
  } else d = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2,
    midpoint = start;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      midpoint = {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
      break;
    }
    remaining -= lengths[i];
  }
  return { points, d, midpoint, bounds: boxFromPoints(points) };
}

/**
 * One ordered lane pass over a lookup. Routing a page asks for every connector, and each one
 * reserves the lanes of those before it, so the pass is resumed instead of replayed per connector.
 * Nodes and lanes sit in R-trees, so each route only reads what lies near it.
 */
interface LanePass {
  outline?: OutlineResolver;
  items: Item[];
  signature: unknown[];
  map: ItemLookup;
  /** First position of each id. */
  index: Map<string, number>;
  area: Field;
  ends: Map<number, Ends>;
  /** Items routed and labelled so far, in order. */
  routed: number;
  labelled: number;
  routes: Map<number, ConnectorGeometry>;
  labels: Map<number, Box>;
}
const lanePasses = new WeakMap<object, LanePass>();

/** Everything routing reads, so a lookup refilled or mutated in place starts a new pass. */
const laneFields = (item: Item): unknown[] => [
  item,
  item.id,
  item.kind,
  item.x,
  item.y,
  item.w,
  item.h,
  item.rotation,
  item.hidden,
  item.route,
  item.from,
  item.to,
  item.waypoints,
  item.text,
];

/** Every route and label call checks the whole lookup, so the check reads fields directly. */
function samePass(pass: LanePass, items: Item[], outline?: OutlineResolver): boolean {
  if (pass.outline !== outline || pass.items.length !== items.length) return false;
  const s = pass.signature;
  for (let i = 0, f = 0; i < items.length; i++, f += 14) {
    const item = items[i];
    if (
      s[f] !== item ||
      s[f + 1] !== item.id ||
      s[f + 2] !== item.kind ||
      s[f + 3] !== item.x ||
      s[f + 4] !== item.y ||
      s[f + 5] !== item.w ||
      s[f + 6] !== item.h ||
      s[f + 7] !== item.rotation ||
      s[f + 8] !== item.hidden ||
      s[f + 9] !== item.route ||
      s[f + 10] !== item.from ||
      s[f + 11] !== item.to ||
      s[f + 12] !== item.waypoints ||
      s[f + 13] !== item.text
    )
      return false;
  }
  return true;
}

function lanePass(lookup: object, items: Item[], outline?: OutlineResolver): LanePass {
  const cached = lanePasses.get(lookup);
  if (cached && samePass(cached, items, outline)) return cached;
  const map = new Map(items.map((node) => [node.id, node])),
    area = field(items);
  const pass: LanePass = {
    outline,
    items,
    signature: items.flatMap(laneFields),
    map,
    index: new Map([...items.entries()].reverse().map(([i, node]) => [node.id, i])),
    area,
    ends: attach(items, map, outline, area.nodes),
    routed: 0,
    labelled: 0,
    routes: new Map(),
    labels: new Map(),
  };
  lanePasses.set(lookup, pass);
  return pass;
}

/** Route `items[routed]` up to `stop` (exclusive), reserving visible connector lanes in order. */
function advance(pass: LanePass, stop: number): void {
  for (; pass.routed < stop; pass.routed++) {
    const index = pass.routed,
      previous = pass.items[index];
    if (previous.kind !== 'connector' || previous.hidden) continue;
    pass.area.limit = index;
    const geometry = connectorGeometry(
      previous,
      pass.map,
      pass.outline,
      pass.area,
      pass.ends.get(index),
    );
    pass.routes.set(index, geometry);
    reserve(pass.area, geometry.points, index);
  }
}

/** Index of `item` in the pass, or -1, after routing every connector before it. */
function locate(item: Item, lookup: ItemLookup, outline?: OutlineResolver) {
  const pass = lanePass(lookup, listedItems(lookup), outline);
  const index = pass.index.get(item.id) ?? -1;
  advance(pass, index < 0 ? pass.items.length : index + 1);
  pass.area.limit = index < 0 ? Infinity : index;
  return { pass, index };
}

export function routeConnector(
  item: Item,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): ConnectorGeometry {
  if (item.route !== 'elbow' || item.waypoints?.length)
    return connectorGeometry(item, lookup, outline);
  if (!lookup || typeof lookup === 'function')
    return connectorGeometry(item, lookup ?? new Map(), outline);
  // Reserve lanes in document order: every connector before this one routes first.
  const { pass, index } = locate(item, lookup, outline);
  if (pass.items[index] === item && pass.routes.has(index)) return pass.routes.get(index)!;
  return connectorGeometry(item, pass.map, outline, pass.area, pass.ends.get(index));
}

/**
 * Page-space box of a connector's label, or undefined without text. It sits on the longest
 * segment of the route where it covers no node, no earlier label, and no other connector.
 * Labels are placed in document order; the stage and SVG export both read this box.
 */
export function connectorLabel(
  item: Item,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): Box | undefined {
  if (!item.text?.value) return undefined;
  const size = labelSize(item.text);
  if (!lookup || typeof lookup === 'function')
    return placeLabel(routeConnector(item, lookup, outline).points, size, () => 0);
  const { pass, index } = locate(item, lookup, outline);
  label(pass, index < 0 ? pass.items.length : index + 1);
  if (pass.items[index] === item && pass.labels.has(index)) return pass.labels.get(index);
  return placeLabel(routeConnector(item, lookup, outline).points, size, blocked(pass, index));
}

/** Labels cover no node, no other connector, and no label placed before them. */
const blocked = (pass: LanePass, own: number) => (box: Box) => {
  const { nodes, lanes, labels } = pass.area,
    entry = boxEntry(box);
  let count = 0;
  for (const node of nodes.search(entry)) count += +overlaps(entry, node);
  for (const lane of lanes.search(entry))
    count += +(lane.owner !== own && segmentHits(lane.a, lane.b, box, -0.01));
  for (const placed of labels.search(entry))
    count += +(placed.owner < (own < 0 ? Infinity : own) && overlaps(entry, placed));
  return count;
};

/** Route the whole pass, then place labels in document order up to `stop` (exclusive). */
function label(pass: LanePass, stop: number): void {
  advance(pass, pass.items.length);
  for (; pass.labelled < stop; pass.labelled++) {
    const at = pass.labelled,
      route = pass.routes.get(at),
      text = pass.items[at].text;
    if (!route || !text?.value) continue;
    const box = placeLabel(route.points, labelSize(text), blocked(pass, at));
    pass.labels.set(at, box);
    pass.area.labels.insert({ ...boxEntry(box), owner: at });
  }
}

/**
 * Every visible connector of a page with its routed points and label box, in document order.
 * One pass serves the whole page, so the cost grows linearly with the number of connectors.
 */
export function routePage(
  items: Item[],
  outline?: OutlineResolver,
): { id: string; points: Point[]; label?: Box }[] {
  const lookup = new Map(flattenItems(items).map((item) => [item.id, item]));
  const pass = lanePass(lookup, [...lookup.values()], outline);
  label(pass, pass.items.length);
  return [...pass.routes].map(([index, route]) => ({
    id: pass.items[index].id,
    points: route.points,
    label: pass.labels.get(index),
  }));
}
