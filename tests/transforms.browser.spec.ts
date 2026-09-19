import { expect, test, type Page } from '@playwright/test';
import type { Item, NewItem } from '../src/core/types';

async function fixture(page: Page, items: NewItem[], selection: string[]) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(
    async ({ items, selection }) => {
      for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
      document.body.innerHTML =
        '<main id="transform-fixture" style="position:fixed;inset:0"></main>';
      const modulePath = '/src/board.ts';
      const { createBoard } = await import(modulePath);
      const board = createBoard(document.querySelector('#transform-fixture'), { ui: false });
      board.apply(items.map((item) => ({ op: 'add', item })));
      board.setGrid(false);
      board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
      board.select(selection);
    },
    { items, selection },
  );
  await expect(page.locator('[data-ad-handle="se"]')).toBeVisible();
}
const get = (page: Page, id: string) =>
  page.evaluate((id) => window.__anniedrawing![0].get(id)!, id);
async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
  modifiers: ('Alt' | 'Shift')[] = [],
) {
  const box = await page.locator(`[data-ad-handle="${handle}"]`).boundingBox();
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
  for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier);
}
function center(item: Item) {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

const box: NewItem = {
  id: 'i_box',
  kind: 'rect',
  x: 400,
  y: 240,
  w: 200,
  h: 100,
  style: { fill: 'teal' },
};

test('resizing a rotated shape follows its local axis and preserves the opposite corner', async ({
  page,
}) => {
  await fixture(page, [{ ...box, rotation: 90 }], ['i_box']);
  await dragHandle(page, 'se', 0, 100);
  const after = await get(page, 'i_box');
  expect(after.w).toBeCloseTo(300, 0);
  expect(after.h).toBeCloseTo(100, 0);
  expect(after.x).toBeCloseTo(350, 0);
  expect(after.y).toBeCloseTo(290, 0);
  expect(after.rotation).toBe(90);
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await get(page, 'i_box')).toMatchObject({ x: 400, y: 240, w: 200, h: 100, rotation: 90 });
});

test('Alt resizes around the centre and Shift keeps the original aspect ratio', async ({
  page,
}) => {
  await fixture(page, [box], ['i_box']);
  await dragHandle(page, 'se', 50, 5, ['Alt', 'Shift']);
  const after = await get(page, 'i_box');
  expect(after.w).toBeCloseTo(300, 0);
  expect(after.h).toBeCloseTo(150, 0);
  expect(center(after).x).toBeCloseTo(500, 0);
  expect(center(after).y).toBeCloseTo(290, 0);
  expect(after.w / after.h).toBeCloseTo(2);
});

test('multiple items rotate around their shared centre', async ({ page }) => {
  await fixture(
    page,
    [
      { ...box, id: 'i_a', x: 300, y: 300, w: 100, h: 100 },
      { ...box, id: 'i_b', x: 600, y: 300, w: 100, h: 100 },
    ],
    ['i_a', 'i_b'],
  );
  // Shared centre is (500, 350); rotate the top handle clockwise by 90 degrees.
  await dragHandle(page, 'rotate', 76, 76);
  const a = await get(page, 'i_a'),
    b = await get(page, 'i_b');
  expect(a.rotation).toBeCloseTo(90, 0);
  expect(b.rotation).toBeCloseTo(90, 0);
  expect(center(a).x).toBeCloseTo(500, 0);
  expect(center(a).y).toBeCloseTo(200, 0);
  expect(center(b).x).toBeCloseTo(500, 0);
  expect(center(b).y).toBeCloseTo(500, 0);
});

test('selected groups resize and rotate their children as one object', async ({ page }) => {
  await fixture(
    page,
    [
      {
        id: 'i_group',
        kind: 'group',
        x: 300,
        y: 300,
        w: 400,
        h: 100,
        children: [
          { ...box, id: 'i_a', x: 300, y: 300, w: 100, h: 100 },
          { ...box, id: 'i_b', x: 600, y: 300, w: 100, h: 100 },
        ],
      },
    ],
    ['i_group'],
  );
  await dragHandle(page, 'se', 200, 50, ['Shift']);
  const a = await get(page, 'i_a'),
    b = await get(page, 'i_b');
  expect(a.w).toBeCloseTo(150, 0);
  expect(b.x).toBeCloseTo(750, 0);
  expect(b.h).toBeCloseTo(150, 0);
  await page.evaluate(() => window.__anniedrawing![0].undo());
  await expect(page.locator('[data-ad-id="i_b"]')).toHaveCSS('width', '100px');
  await dragHandle(page, 'rotate', 76, 76);
  const rotatedA = await get(page, 'i_a'),
    rotatedB = await get(page, 'i_b');
  expect(center(rotatedA).x).toBeCloseTo(500, 0);
  expect(center(rotatedA).y).toBeCloseTo(200, 0);
  expect(center(rotatedB).x).toBeCloseTo(500, 0);
  expect(center(rotatedB).y).toBeCloseTo(500, 0);
});
