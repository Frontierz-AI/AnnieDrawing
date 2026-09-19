import { describe, expect, it } from 'vitest';
import type { Item } from '../src/core/types';
import { boundsOf, itemBounds } from '../src/geo/box';
import { resolveEndpoint, routeConnector, type OutlineResolver } from '../src/geo/router';
import { hitTest, SpatialIndex } from '../src/geo/picker';

const triangle: Item = { id: 'i_triangle', kind: 'triangle', x: 100, y: 100, w: 200, h: 100 };
const target: Item = { id: 'i_target', kind: 'rect', x: 500, y: 100, w: 100, h: 100 };
const connector: Item = {
  id: 'i_connector',
  kind: 'connector',
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  from: { item: triangle.id },
  to: { item: target.id },
};
const outline: OutlineResolver = (item) =>
  item.kind === 'triangle'
    ? {
        points: [
          { x: item.w / 2, y: 0 },
          { x: item.w, y: item.h },
          { x: 0, y: item.h },
        ],
        closed: true,
      }
    : undefined;

describe('custom outline connector clipping', () => {
  it('clips automatic and side endpoints against local polygon edges', () => {
    const lookup = new Map([triangle, target, connector].map((item) => [item.id, item]));
    expect(resolveEndpoint({ item: triangle.id }, { item: target.id }, lookup, outline)).toEqual({
      x: 250,
      y: 150,
    });
    expect(
      resolveEndpoint({ item: triangle.id, side: 'left' }, { item: target.id }, lookup, outline),
    ).toEqual({ x: 150, y: 150 });
    expect(
      resolveEndpoint({ item: triangle.id, side: 'top' }, { item: target.id }, lookup, outline),
    ).toEqual({ x: 200, y: 100 });
    expect(routeConnector(connector, lookup, outline).d).toBe('M 250 150 L 500 150');
    expect(itemBounds(connector, lookup, outline)).toEqual({ x: 250, y: 150, w: 250, h: 0 });
    expect(boundsOf([connector], lookup, outline)).toEqual({ x: 250, y: 150, w: 250, h: 0 });
  });
  it('rotates resolved boundary points and preserves explicit anchors', () => {
    const rotated = { ...triangle, rotation: 90 };
    const lookup = new Map([rotated, target].map((item) => [item.id, item]));
    expect(
      resolveEndpoint({ item: triangle.id, side: 'right' }, { item: target.id }, lookup, outline),
    ).toEqual({ x: 200, y: 200 });
    expect(
      resolveEndpoint(
        { item: triangle.id, anchor: [1, 0.5] },
        { item: target.id },
        lookup,
        outline,
      ),
    ).toEqual({ x: 200, y: 250 });
    expect(resolveEndpoint({ item: triangle.id }, { x: 200, y: 500 }, lookup, outline)).toEqual({
      x: 200,
      y: 200,
    });
  });
  it('falls back when no usable outline exists and keeps built-in routing unchanged', () => {
    const lookup = new Map([triangle, target].map((item) => [item.id, item]));
    expect(resolveEndpoint({ item: triangle.id }, { item: target.id }, lookup)).toEqual({
      x: 300,
      y: 150,
    });
    expect(
      resolveEndpoint({ item: triangle.id }, { item: target.id }, lookup, () => ({
        points: [],
        closed: true,
      })),
    ).toEqual({ x: 300, y: 150 });
    expect(resolveEndpoint({ item: target.id }, { item: triangle.id }, lookup, outline)).toEqual({
      x: 500,
      y: 150,
    });
  });
  it('uses the same custom route for broad-phase and exact connector picking', () => {
    const lookup = new Map([triangle, target, connector].map((item) => [item.id, item]));
    expect(hitTest(connector, { x: 255, y: 150 }, 1, lookup, outline)).toBe(true);
    const index = new SpatialIndex([triangle, target, connector], outline);
    expect(index.pick({ x: 255, y: 150 }, { tolerance: 1 })?.id).toBe(connector.id);
    expect(index.search({ x: 250, y: 149, w: 5, h: 2 }).map((item) => item.id)).toContain(
      connector.id,
    );
  });
});
