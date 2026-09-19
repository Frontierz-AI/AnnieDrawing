import type { Point } from '../core/types';
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    x = p.x - center.x,
    y = p.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy,
    t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function simplifyPoints<T extends [number, number, number?]>(
  points: T[],
  epsilon = 0.5,
): T[] {
  if (points.length < 3) return points.slice();
  const keep = new Set([0, points.length - 1]),
    stack: [[number, number]] | [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let max = epsilon,
      index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(
        { x: points[i][0], y: points[i][1] },
        { x: points[start][0], y: points[start][1] },
        { x: points[end][0], y: points[end][1] },
      );
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([start, index], [index, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
