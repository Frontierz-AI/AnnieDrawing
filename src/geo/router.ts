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
import { distance, rotatePoint } from './vec';

const CLEAR = 16;
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
    .filter((child) => child.kind !== 'connector' && child.kind !== 'group')
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
  if (item.hidden || SKIP_OBSTACLE.has(item.kind) || item.w <= 0 || item.h <= 0) return;
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

function pathHits(points: Point[], boxes: Box[], pad = 0): number {
  let hits = 0;
  for (let i = 0; i < points.length - 1; i++)
    for (const box of boxes) if (segmentHits(points[i], points[i + 1], box, pad)) hits++;
  return hits;
}

function pathLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
}

/** One orthogonal channel: vertical first (shared Y) or horizontal first (shared X). */
function elbow(start: Point, end: Point, vertical: boolean, channel?: number): Point[] {
  if (vertical) {
    const y = channel ?? (start.y + end.y) / 2;
    return [start, { x: start.x, y }, { x: end.x, y }, end];
  }
  const x = channel ?? (start.x + end.x) / 2;
  return [start, { x, y: start.y }, { x, y: end.y }, end];
}

function simplifyRoute(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const before = result.at(-2);
    if (
      before &&
      last &&
      ((before.x === last.x &&
        last.x === point.x &&
        (last.y - before.y) * (point.y - last.y) >= 0) ||
        (before.y === last.y &&
          last.y === point.y &&
          (last.x - before.x) * (point.x - last.x) >= 0))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

/** Shared endpoints are allowed; crossings and shared lengths consume a lane. */
function pathCrossings(points: Point[], occupied: Point[][]): number {
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    for (const path of occupied)
      for (let j = 1; j < path.length; j++) {
        const c = path[j - 1],
          d = path[j];
        const ex = d.x - c.x,
          ey = d.y - c.y;
        const determinant = dx * ey - dy * ex;
        if (Math.abs(determinant) < 1e-8) {
          if (Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) > 1e-8) continue;
          const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) >
            Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) + 0.01
          )
            count++;
          continue;
        }
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
        if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) continue;
        const atEnd = (i === 1 && t < 1e-8) || (i === points.length - 1 && t > 1 - 1e-8);
        const otherEnd = (j === 1 && u < 1e-8) || (j === path.length - 1 && u > 1 - 1e-8);
        if (!(atEnd && otherEnd)) count++;
      }
  }
  return count;
}

interface Port {
  point: Point;
  exit: Point;
}
function ports(
  endpoint: Endpoint | undefined,
  other: Endpoint | undefined,
  lookup: ItemLookup | undefined,
  outline: OutlineResolver | undefined,
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
  const sides =
    Math.abs(target.x - center.x) / Math.max(1, item.w) >=
    Math.abs(target.y - center.y) / Math.max(1, item.h)
      ? ([
          horizontal,
          vertical,
          vertical === 'top' ? 'bottom' : 'top',
          horizontal === 'left' ? 'right' : 'left',
        ] as const)
      : ([
          vertical,
          horizontal,
          horizontal === 'left' ? 'right' : 'left',
          vertical === 'top' ? 'bottom' : 'top',
        ] as const);
  const endpoints =
    endpoint.anchor || (endpoint.side && endpoint.side !== 'auto')
      ? [endpoint]
      : sides.map((side) => ({ ...endpoint, side }));
  return endpoints.map((end) => {
    const point = resolveEndpoint(end, other, lookup, outline);
    const dx = point.x - center.x,
      dy = point.y - center.y;
    // Orthogonal exits remain outside the target even for rotated shapes.
    const box = boxFromPoints(boxCorners(item, item.rotation));
    const exit =
      Math.abs(dx) / Math.max(1, box.w) >= Math.abs(dy) / Math.max(1, box.h)
        ? { x: dx >= 0 ? box.x + box.w + CLEAR : box.x - CLEAR, y: point.y }
        : { x: point.x, y: dy >= 0 ? box.y + box.h + CLEAR : box.y - CLEAR };
    return { point, exit };
  });
}

/** Prefer clear lanes. Only automatic ports may move to another side of a node. */
function clearElbow(
  item: Item,
  lookup: ItemLookup | undefined,
  outline: OutlineResolver | undefined,
  items: Item[],
  occupied: Point[][],
): Point[] {
  const boxes = items.map(obstacleBox).filter((box): box is Box => !!box);
  const fromId = item.from && 'item' in item.from ? item.from.item : undefined;
  const toId = item.to && 'item' in item.to ? item.to.item : undefined;
  const portBoxes = (id: string | undefined) =>
    items
      .filter((node) => node.id !== id)
      .map(obstacleBox)
      .filter((box): box is Box => !!box);
  const fromBoxes = portBoxes(fromId),
    toBoxes = portBoxes(toId);
  const starts = ports(item.from, item.to, lookup, outline);
  const ends = ports(item.to, item.from, lookup, outline);
  let best: Point[] = [],
    bestHits = Infinity,
    bestCrossings = Infinity,
    bestLength = Infinity;
  const consider = (start: Port, end: Port, middle: Point[]) => {
    const points = simplifyRoute([start.point, ...middle, end.point]);
    // Port exits are checked against other nodes; their own target may be rotated.
    const hits =
      pathHits(middle, boxes, -0.01) +
      pathHits([start.point, start.exit], fromBoxes, -0.01) +
      pathHits([end.exit, end.point], toBoxes, -0.01);
    if (hits > bestHits) return;
    const crossings = pathCrossings(points, occupied);
    const length = pathLength(points) + points.length * CLEAR;
    if (
      hits < bestHits ||
      crossings < bestCrossings ||
      (crossings === bestCrossings && length < bestLength)
    ) {
      best = points;
      bestHits = hits;
      bestCrossings = crossings;
      bestLength = length;
    }
  };
  for (const start of starts)
    for (const end of ends) {
      const vertical = start.exit.y !== start.point.y;
      const preferred = elbow(start.exit, end.exit, vertical);
      const alternate = elbow(start.exit, end.exit, !vertical);
      consider(start, end, preferred);
      consider(start, end, alternate);
      // The common case needs no search beyond the facing ports.
      if (start === starts[0] && end === ends[0] && bestHits === 0 && bestCrossings === 0)
        return best;
      const obstacles = [
        ...boxes.filter((box) => pathHits(preferred, [box]) || pathHits(alternate, [box])),
        ...occupied
          .filter((path) => pathCrossings(preferred, [path]) || pathCrossings(alternate, [path]))
          .map(boxFromPoints),
      ];
      for (const box of obstacles.slice(0, 12)) {
        consider(start, end, elbow(start.exit, end.exit, true, box.y - CLEAR));
        consider(start, end, elbow(start.exit, end.exit, true, box.y + box.h + CLEAR));
        consider(start, end, elbow(start.exit, end.exit, false, box.x - CLEAR));
        consider(start, end, elbow(start.exit, end.exit, false, box.x + box.w + CLEAR));
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
  items: Item[] = [],
  occupied: Point[][] = [],
): ConnectorGeometry {
  const start = resolveEndpoint(item.from, item.to, lookup, outline),
    end = resolveEndpoint(item.to, item.from, lookup, outline);
  let points = [start, ...(item.waypoints ?? []).map(([x, y]) => ({ x, y })), end],
    d = '';
  if (item.route === 'elbow' && !item.waypoints?.length) {
    points = clearElbow(item, lookup, outline, items, occupied);
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
 */
interface LanePass {
  outline?: OutlineResolver;
  items: Item[];
  signature: unknown[];
  map: ItemLookup;
  occupied: Point[][];
  /** Lanes reserved before `items[index]`, for every index reached so far. */
  before: number[];
  routes: Map<number, ConnectorGeometry>;
}
const lanePasses = new WeakMap<object, LanePass>();

/** Everything routing reads, so a lookup refilled or mutated in place starts a new pass. */
function laneFields(item: Item): unknown[] {
  return [
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
  ];
}
const LANE_FIELDS = laneFields({ id: '', kind: '', x: 0, y: 0, w: 0, h: 0 }).length;

function samePass(pass: LanePass, items: Item[], outline?: OutlineResolver): boolean {
  if (pass.outline !== outline || pass.items.length !== items.length) return false;
  for (let index = 0; index < items.length; index++) {
    const fields = laneFields(items[index]);
    for (let field = 0; field < LANE_FIELDS; field++)
      if (pass.signature[index * LANE_FIELDS + field] !== fields[field]) return false;
  }
  return true;
}

function lanePass(lookup: object, items: Item[], outline?: OutlineResolver): LanePass {
  const cached = lanePasses.get(lookup);
  if (cached && samePass(cached, items, outline)) return cached;
  const pass: LanePass = {
    outline,
    items,
    signature: items.flatMap(laneFields),
    map: new Map(items.map((node) => [node.id, node])),
    occupied: [],
    before: [],
    routes: new Map(),
  };
  lanePasses.set(lookup, pass);
  return pass;
}

/** Route `items[before.length]` up to `stop` (exclusive), reserving visible connector lanes in order. */
function advance(pass: LanePass, stop: number): void {
  for (let index = pass.before.length; index < stop; index++) {
    const previous = pass.items[index];
    pass.before.push(pass.occupied.length);
    if (previous.kind !== 'connector' || previous.hidden) continue;
    const geometry = connectorGeometry(previous, pass.map, pass.outline, pass.items, pass.occupied);
    pass.routes.set(index, geometry);
    pass.occupied.push(geometry.points);
  }
}

export function routeConnector(
  item: Item,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): ConnectorGeometry {
  if (item.route !== 'elbow' || item.waypoints?.length)
    return connectorGeometry(item, lookup, outline);
  if (!lookup || typeof lookup === 'function')
    return connectorGeometry(item, lookup ?? new Map(), outline, [], []);
  // Reserve lanes in document order: every connector before this one routes first.
  const pass = lanePass(lookup, listedItems(lookup), outline);
  const index = pass.items.findIndex((node) => node.id === item.id);
  if (index < 0) {
    advance(pass, pass.items.length);
    return connectorGeometry(item, pass.map, outline, pass.items, pass.occupied);
  }
  advance(pass, index + 1);
  if (pass.items[index] === item && pass.routes.has(index)) return pass.routes.get(index)!;
  const lanes = pass.occupied.slice(0, pass.before[index]);
  return connectorGeometry(item, pass.map, outline, pass.items, lanes);
}
