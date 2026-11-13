import { describe, expect, it } from 'vitest';
import type { ViewEvent } from '../src/core/types';
import { Lens } from '../src/stage/lens';

// Headless: no matchMedia or ResizeObserver, so flyTo lands at once.
const lens = () => {
  const value = new Lens({ clientWidth: 1280, clientHeight: 760 } as HTMLElement);
  const events: ViewEvent[] = [];
  value.onChange((event) => events.push(event));
  return { lens: value, events };
};

describe('camera framing', () => {
  it('reports the cause of every change', () => {
    const { lens: camera, events } = lens();
    camera.set({ x: 10 }, 'user');
    camera.set({ x: 20 });
    camera.fit({ x: 0, y: 0, w: 400, h: 200 }, 96, 'agent');
    camera.flyTo({ x: 900, y: 900, w: 100, h: 100 }, 'agent', [0.6, 1]);
    expect(events.map((event) => event.cause)).toEqual(['user', 'api', 'agent', 'agent']);
    expect(events[0]).toEqual({ x: 10, y: 0, zoom: 1, cause: 'user' });
  });

  it('caps a small target at the maximum zoom and centers it', () => {
    const { lens: camera } = lens();
    camera.flyTo({ x: 100, y: 50, w: 300, h: 40 }, 'agent', [0.6, 1]);
    expect(camera.zoom).toBe(1);
    expect(camera.center).toEqual({ x: 250, y: 70 });
  });

  it('frames a mid-size target between the floor and 1', () => {
    const { lens: camera } = lens();
    camera.flyTo({ x: 0, y: 0, w: 1500, h: 300 }, 'agent', [0.6, 1]);
    expect(camera.zoom).toBeGreaterThan(0.6);
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.center.x).toBeCloseTo(750);
  });

  it('shows the top-left part when the target does not fit at the floor', () => {
    const { lens: camera } = lens();
    const box = { x: 200, y: -100, w: 600, h: 4000 };
    camera.flyTo(box, 'agent', [0.6, 1]);
    expect(camera.zoom).toBe(0.6);
    const view = camera.viewport();
    // The width fits and stays centered; the height does not and shows its start.
    expect(view.x + view.w / 2).toBeCloseTo(500);
    expect(view.y).toBeLessThan(box.y);
    expect(view.y).toBeGreaterThan(box.y - 200);
  });

  it('keeps the whole-page fit unchanged', () => {
    const { lens: camera } = lens();
    camera.fit({ x: 0, y: 0, w: 0, h: 0 });
    expect(camera.zoom).toBe(1.5);
    camera.fit({ x: 0, y: 0, w: 3000, h: 3000 });
    expect(camera.center.x).toBeCloseTo(1500);
    expect(camera.center.y).toBeCloseTo(1500);
  });
});
