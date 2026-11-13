import { expect, test } from '@playwright/test';
import { createDoc } from '../src/core';
import type { Op } from '../src/core/types';
import { FELLOW, FOUNDERZ, scenario } from './helpers/scenarios';

// Scenarios without `text` items: the browser measures standalone text, so those batches differ.
for (const id of ['04', '08', '10']) {
  test(`agent layout ${id} renders where the headless document puts it`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?blank');
    await page.waitForFunction(() => !!window.__anniedrawing?.length);
    const batches = scenario(id).batches;
    const live = await page.evaluate(async (batches: Op[][]) => {
      window.__anniedrawing![0].destroy();
      const host = document.getElementById('app')!;
      host.replaceChildren();
      const { createFellowBoard } = await import('/src/fellow.ts' as string);
      const board = createFellowBoard(host, {
        fellowName: 'Nora',
        ui: { menu: false, export: ['png', 'svg'], pages: false },
      });
      await board.ready;
      const ok = batches.every(
        (ops) => board.apply(ops, { origin: 'agent:fellow', expectedRevision: board.revision }).ok,
      );
      await new Promise((resolve) => board.stage.whenPresentationIdle(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const lens = board.stage.lens,
        camera = lens.state,
        root = board.stage.root.getBoundingClientRect();
      const items = board.items
        .filter((item: { kind: string }) => item.kind !== 'connector')
        .map((item: { id: string; x: number; y: number; w: number; h: number }) => {
          const rect = board.stage.world
            .querySelector(`[data-ad-id="${item.id}"]`)!
            .getBoundingClientRect();
          return {
            ...item,
            dom: {
              x: (rect.x - root.x - camera.x) / camera.zoom,
              y: (rect.y - root.y - camera.y) / camera.zoom,
              w: rect.width / camera.zoom,
              h: rect.height / camera.zoom,
            },
          };
        });
      board.destroy();
      return { ok, viewport: { w: lens.width, h: lens.height }, items };
    }, batches);
    expect(live.ok).toBe(true);
    expect(live.viewport).toEqual({ w: 1280, h: 760 });
    const doc = createDoc(undefined, FOUNDERZ);
    for (const ops of batches)
      expect(doc.apply(ops, { ...FELLOW, viewport: live.viewport }).ok).toBe(true);
    expect(live.items).toHaveLength(doc.query().filter((item) => item.kind !== 'connector').length);
    for (const item of live.items) {
      const stored = doc.get(item.id)!;
      expect({ x: item.x, y: item.y, w: item.w, h: item.h }, item.id).toEqual({
        x: stored.x,
        y: stored.y,
        w: stored.w,
        h: stored.h,
      });
      for (const key of ['x', 'y', 'w', 'h'] as const)
        expect(Math.abs(item.dom[key] - stored[key]), `${item.id} ${key}`).toBeLessThan(1);
    }
  });
}
