import type { Box, Endpoint, Item, Outline, Point } from '../core/types';
import {
  boxFromPoints,
  boundsOf,
  centerOf,
  flattenItems,
  lookupItem,
  type ItemLookup,
} from './box';
import { distance, rotatePoint } from './vec';
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
export interface ConnectorGeometry {
  points: Point[];
  d: string;
  midpoint: Point;
  bounds: Box;
}
export function routeConnector(
  item: Item,
  lookup?: ItemLookup,
  outline?: OutlineResolver,
): ConnectorGeometry {
  const start = resolveEndpoint(item.from, item.to, lookup, outline),
    end = resolveEndpoint(item.to, item.from, lookup, outline);
  let points = [start, ...(item.waypoints ?? []).map(([x, y]) => ({ x, y })), end],
    d = '';
  if (item.route === 'elbow' && !item.waypoints?.length) {
    const from = item.from,
      side = from && 'item' in from ? from.side : undefined;
    const vertical =
      side === 'top' ||
      side === 'bottom' ||
      ((!side || side === 'auto') && Math.abs(end.y - start.y) > Math.abs(end.x - start.x));
    points = vertical
      ? [
          start,
          { x: start.x, y: (start.y + end.y) / 2 },
          { x: end.x, y: (start.y + end.y) / 2 },
          end,
        ]
      : [
          start,
          { x: (start.x + end.x) / 2, y: start.y },
          { x: (start.x + end.x) / 2, y: end.y },
          end,
        ];
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
