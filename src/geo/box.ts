import type { Box, Item, Point } from '../core/types';
import { rotatePoint } from './vec';
import { routeConnector, type OutlineResolver } from './router';
export type ItemLookup =
  ((id: string) => Item | undefined) | Map<string, Item> | Record<string, Item> | Item[];
export function lookupItem(lookup: ItemLookup | undefined, id: string): Item | undefined {
  return typeof lookup === 'function'
    ? lookup(id)
    : lookup instanceof Map
      ? lookup.get(id)
      : Array.isArray(lookup)
        ? flattenItems(lookup).find((i) => i.id === id)
        : lookup?.[id];
}
export function flattenItems(items: Item[]): Item[] {
  const out: Item[] = [];
  function walk(list: Item[]) {
    for (const item of list) {
      out.push(item);
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return out;
}
export const centerOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export function boxCorners(box: Box, rotation = 0, origin = centerOf(box)): Point[] {
  const points = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  return rotation ? points.map((point) => rotatePoint(point, origin, rotation)) : points;
}
export function boxFromPoints(points: Point[]): Box {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x = Infinity,
    y = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x, y, w: maxX - x, h: maxY - y };
}
export function itemBounds(item: Item, lookup?: ItemLookup, outline?: OutlineResolver): Box {
  if (item.kind === 'connector') return routeConnector(item, lookup, outline).bounds;
  if (item.kind === 'group' && item.children?.length)
    return boundsOf(
      item.children.map((child) => lookupItem(lookup, child.id) ?? child),
      lookup,
      outline,
    );
  let box: Box = { x: item.x, y: item.y, w: item.w, h: item.h };
  if ((item.kind === 'path' || item.kind === 'line') && item.points?.length)
    box = boxFromPoints(item.points.map((p) => ({ x: item.x + p[0], y: item.y + p[1] })));
  if (!item.rotation) return box;
  return boxFromPoints(boxCorners(box, item.rotation, centerOf(item)));
}
export function boundsOf(items: Item[], lookup?: ItemLookup, outline?: OutlineResolver): Box {
  const map = lookup ?? new Map(flattenItems(items).map((i) => [i.id, i]));
  return boxFromPoints(
    items.flatMap((item) => {
      const b = itemBounds(item, map, outline);
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ];
    }),
  );
}
export const intersects = (a: Box, b: Box) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
/** Boxes share area. Touching edges, and float noise below TOUCH, do not count. */
const TOUCH = 1e-6;
export const overlaps = (a: Box, b: Box) =>
  a.x + TOUCH < b.x + b.w &&
  b.x + TOUCH < a.x + a.w &&
  a.y + TOUCH < b.y + b.h &&
  b.y + TOUCH < a.y + a.h;
export const contains = (a: Box, b: Box) =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
export const containsPoint = (b: Box, p: Point) =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
