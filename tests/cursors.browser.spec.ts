import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    window.__anniedrawing?.forEach((board) => board.destroy());
    document.body.innerHTML = '<main id="cursor-fixture" style="position:fixed;inset:0"></main>';
    const modulePath = '/src/board.ts';
    const { Board } = await import(modulePath);
    const board = new Board(document.querySelector('#cursor-fixture'), { ui: false });
    (window as any).__cursorBoard = board;
    board.view.zoom = 1;
    board.stage.lens.set({ x: 0, y: 0 });
  });
});

test('native SVG cursors decode and keep precise select and drawing hotspots', async ({ page }) => {
  const initial = await page.locator('.ad-root').evaluate((el) => getComputedStyle(el).cursor);
  expect(initial).toContain('data:image/svg+xml,');
  expect(initial).toMatch(/7 7,\s*default$/);
  const artwork = await page.evaluate(async () => {
    const modulePath = '/src/input/cursors.ts';
    const { selectionCursor, drawingCursor } = await import(modulePath);
    return Promise.all(
      [selectionCursor, drawingCursor].map(async (cursor: string) => {
        const uri = cursor.match(/url\("([^"]+)"\)/)![1];
        const image = new Image();
        image.src = uri;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }),
    );
  });
  expect(artwork).toEqual([
    { width: 36, height: 36 },
    { width: 28, height: 28 },
  ]);
  await page.evaluate(() => (window as any).__cursorBoard.setTool('rect'));
  await expect(page.locator('.ad-root')).toHaveCSS('cursor', /14 14,\s*crosshair$/);
  await page.evaluate(() => (window as any).__cursorBoard.setTool('text'));
  await expect(page.locator('.ad-root')).toHaveCSS('cursor', 'text');
});

test('panning shows grab and grabbing while selection handles keep native resize cursors', async ({
  page,
}) => {
  const stage = page.locator('.ad-root');
  await page.evaluate(() => (window as any).__cursorBoard.setTool('hand'));
  await expect(stage).toHaveCSS('cursor', 'grab');
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await expect(stage).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(340, 280);
  await page.mouse.up();
  await expect(stage).toHaveCSS('cursor', 'grab');
  await page.evaluate(() => {
    const board = (window as any).__cursorBoard;
    board.setTool('select');
    board.add('rect', { x: 200, y: 150 });
  });
  await expect(stage.locator('[data-ad-handle="se"]')).toHaveCSS('cursor', 'nwse-resize');
  await expect(stage.locator('[data-ad-handle="e"]')).toHaveCSS('cursor', 'ew-resize');
  await page.keyboard.down('Space');
  await expect(stage).toHaveCSS('cursor', 'grab');
  await page.keyboard.up('Space');
  await expect(stage).toHaveCSS('cursor', /7 7,\s*default$/);
});
