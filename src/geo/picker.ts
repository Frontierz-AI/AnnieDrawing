import RBush from 'rbush';
import type { Box, Item, Point } from '../core/types';
import { contains, containsPoint, flattenItems, itemBounds, type ItemLookup } from './box';
import { pointInPolygon, rotatePoint, segmentDistance } from './vec';
import { routeConnector, type OutlineResolver } from './router';
interface Entry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  item: Item;
  order: number;
  parents: Item[];
}
export interface PickOutline {
  points: Point[];
  closed: boolean;
}
export interface PickOptions {
  tolerance?: number;
  enteredGroup?: string;
  includeLocked?: boolean;
  outline?: (item: Item) => PickOutline | PickOutline[] | undefined;
}
export function hitTest(
  item: Item,
  point: Point,
  tolerance = 4,
  lookup?: ItemLookup,
  outline?: PickOutline | PickOutline[] | OutlineResolver,
): boolean {
  const resolveOutline = typeof outline === 'function' ? outline : undefined;
  if (item.kind === 'group') return containsPoint(itemBounds(item, lookup, resolveOutline), point);
  if (item.kind === 'connector') {
    const points = routeConnector(item, lookup, resolveOutline).points;
    return points
      .slice(1)
      .some(
        (p, i) =>
          segmentDistance(point, points[i], p) <= tolerance + (item.style?.strokeWidth ?? 2) / 2,
      );
  }
  const p = rotatePoint(
      point,
      { x: item.x + item.w / 2, y: item.y + item.h / 2 },
      -(item.rotation ?? 0),
    ),
    x = p.x - item.x,
    y = p.y - item.y,
    stroke = tolerance + (item.style?.strokeWidth ?? 2) / 2;
  const linePoints =
    item.points ??
    (item.kind === 'line'
      ? [
          [0, 0],
          [item.w, item.h],
        ]
      : undefined);
  if ((item.kind === 'line' || item.kind === 'path') && linePoints) {
    const pts = linePoints.map(([px, py]) => ({ x: item.x + px, y: item.y + py }));
    return (
      (item.closed && pointInPolygon(p, pts)) ||
      pts.slice(1).some((pt, i) => segmentDistance(p, pts[i], pt) <= stroke)
    );
  }
  const filled =
    !!item.text?.value ||
    (item.style?.fill !== undefined && item.style.fill !== 'none') ||
    ['note', 'text', 'image', 'html', 'group'].includes(item.kind);
  const resolvedOutline = typeof outline === 'function' ? outline(item) : outline;
  if (resolvedOutline) {
    const outlines = Array.isArray(resolvedOutline) ? resolvedOutline : [resolvedOutline],
      local = { x, y };
    return outlines.some((shape) => {
      if (!shape.points.length) return false;
      if (shape.closed && filled && pointInPolygon(local, shape.points)) return true;
      const points = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
      return points.length === 1
        ? segmentDistance(local, points[0], points[0]) <= stroke
        : points
            .slice(1)
            .some((point, index) => segmentDistance(local, points[index], point) <= stroke);
    });
  }
  if (item.kind === 'ellipse') {
    const rx = item.w / 2,
      ry = item.h / 2;
    if (!rx || !ry) return false;
    const d = Math.hypot((x - rx) / rx, (y - ry) / ry),
      edge = stroke / Math.min(rx, ry);
    return filled ? d <= 1 + edge : Math.abs(d - 1) <= edge;
  }
  if (item.kind === 'diamond') {
    const vertices = [
        { x: item.w / 2, y: 0 },
        { x: item.w, y: item.h / 2 },
        { x: item.w / 2, y: item.h },
        { x: 0, y: item.h / 2 },
      ],
      local = { x, y };
    return (
      (filled && pointInPolygon(local, vertices)) ||
      vertices.some((a, i) => segmentDistance(local, a, vertices[(i + 1) % 4]) <= stroke)
    );
  }
  const outer = x >= -stroke && x <= item.w + stroke && y >= -stroke && y <= item.h + stroke;
  return (
    outer && (filled || x <= stroke || x >= item.w - stroke || y <= stroke || y >= item.h - stroke)
  );
}
export class SpatialIndex {
  private tree = new RBush<Entry>();
  private lookup = new Map<string, Item>();
  private entries = new Map<string, Entry>();
  constructor(
    items: Item[] = [],
    private outline?: OutlineResolver,
  ) {
    this.set(items);
  }
  set(items: Item[], outline: OutlineResolver | undefined = this.outline): void {
    this.outline = outline;
    this.tree.clear();
    this.lookup = new Map(flattenItems(items).map((i) => [i.id, i]));
    const entries: Entry[] = [];
    let order = 0;
    const walk = (list: Item[], parents: Item[]) => {
      for (const item of list) {
        const b = itemBounds(item, this.lookup, this.outline);
        entries.push({
          minX: b.x,
          minY: b.y,
          maxX: b.x + b.w,
          maxY: b.y + b.h,
          item,
          order: order++,
          parents,
        });
        if (item.children) walk(item.children, [...parents, item]);
      }
    };
    walk(items, []);
    this.entries = new Map(entries.map((entry) => [entry.item.id, entry]));
    this.tree.load(entries);
  }
  search(box: Box): Item[] {
    return this.tree
      .search({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h })
      .filter((e) => !e.item.hidden && !e.parents.some((p) => p.hidden))
      .sort((a, b) => a.order - b.order)
      .map((e) => e.item);
  }
  enclosed(box: Box, options: { enteredGroup?: string } = {}): Item[] {
    const selected = new Map<string, Entry>();
    const candidates = this.tree.search({
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.w,
      maxY: box.y + box.h,
    });
    const visibleBounds = (entry: Entry): Box | undefined => {
      if (
        entry.item.hidden ||
        entry.item.locked ||
        entry.parents.some((parent) => parent.hidden || parent.locked)
      )
        return;
      return {
        x: entry.minX,
        y: entry.minY,
        w: entry.maxX - entry.minX,
        h: entry.maxY - entry.minY,
      };
    };
    for (const candidate of candidates) {
      const visible = visibleBounds(candidate);
      if (!visible || !contains(box, visible)) continue;
      const groups = candidate.parents.filter((parent) => parent.kind === 'group');
      const entered = groups.findIndex((parent) => parent.id === options.enteredGroup);
      const outer = groups[entered + 1];
      const entry = outer ? this.entries.get(outer.id)! : candidate;
      if (entry.item.id === options.enteredGroup) continue;
      const bounds = entry === candidate ? visible : visibleBounds(entry);
      if (bounds && contains(box, bounds)) selected.set(entry.item.id, entry);
    }
    return [...selected.values()].sort((a, b) => a.order - b.order).map((entry) => entry.item);
  }
  pick(point: Point, options: PickOptions = {}): Item | undefined {
    const tolerance = options.tolerance ?? 6;
    const found = this.tree
      .search({
        minX: point.x - tolerance,
        minY: point.y - tolerance,
        maxX: point.x + tolerance,
        maxY: point.y + tolerance,
      })
      .sort((a, b) => b.order - a.order);
    for (const e of found) {
      if (
        e.item.hidden ||
        (!options.includeLocked && e.item.locked) ||
        e.parents.some((p) => p.hidden || (!options.includeLocked && p.locked))
      )
        continue;
      if (!hitTest(e.item, point, tolerance, this.lookup, options.outline ?? this.outline))
        continue;
      const groups = e.parents.filter((p) => p.kind === 'group');
      const entered = groups.findIndex((p) => p.id === options.enteredGroup);
      const outer = groups[entered + 1];
      return outer ?? e.item;
    }
    return undefined;
  }
}
export function pick(point: Point, items: Item[], options: PickOptions = {}): Item | undefined {
  return new SpatialIndex(items, options.outline).pick(point, options);
}
