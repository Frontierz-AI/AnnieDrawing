import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    await b.ready;
    b.clear();
    b.setGrid(false);
    b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
}
async function handle(page: Page, name: string, dx: number, dy: number) {
  const box = await page.locator(`[data-ad-handle="${name}"]`).boundingBox();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test('two-dimensional line and imported freehand points resize and undo', async ({ page }) => {
  await ready(page);
  for (const kind of ['line', 'path']) {
    await page.evaluate((kind) => {
      const b = window.__anniedrawing![0];
      b.clear();
      b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
      b.apply([
        {
          op: 'add',
          item: {
            id: 'i_stroke',
            kind,
            x: 400,
            y: 250,
            w: 160,
            h: 100,
            points: [
              [0, 0],
              [80, 80],
              [160, 100],
            ],
          },
        },
      ]);
      b.select(['i_stroke']);
    }, kind);
    await expect(page.locator('[data-ad-handle="se"]')).toHaveAttribute('x', '556');
    await expect(page.locator('[data-ad-handle="se"]')).toHaveAttribute('y', '346');
    await handle(page, 'se', 80, 50);
    expect(await page.evaluate(() => window.__anniedrawing![0].get('i_stroke'))).toMatchObject({
      w: 240,
      h: 150,
      points: [
        [0, 0],
        [120, 120],
        [240, 150],
      ],
    });
    await page.evaluate(() => window.__anniedrawing![0].undo());
    expect(await page.evaluate(() => window.__anniedrawing![0].get('i_stroke')?.points)).toEqual([
      [0, 0],
      [80, 80],
      [160, 100],
    ]);
  }
});

test('resize follows the pointer near neighbors and a visible grid, with one undo entry', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      { op: 'add', item: { id: 'i_resize', kind: 'rect', x: 400, y: 250, w: 100, h: 100 } },
      { op: 'add', item: { id: 'i_neighbor', kind: 'rect', x: 650, y: 400, w: 100, h: 100 } },
    ]);
    b.select(['i_resize']);
  });
  await expect(page.locator('[data-ad-handle="e"]')).toHaveAttribute('x', '496');
  await handle(page, 'e', 147, 0);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_resize')?.w)).toBeCloseTo(
    247,
    8,
  );
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.undo();
    b.setGrid(true);
  });
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_resize')?.w)).toBe(100);
  await expect(page.locator('[data-ad-handle="e"]')).toHaveAttribute('x', '496');
  await handle(page, 'e', 30, 0);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_resize')?.w)).toBe(130);
});

test('touch double tap edits a shape and long press opens its actions', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: {
          id: 'i_touch',
          kind: 'rect',
          x: 400,
          y: 250,
          w: 200,
          h: 100,
          style: { fill: 'teal' },
        },
      },
    ]);
    for (let tap = 0; tap < 2; tap++)
      for (const type of ['pointerdown', 'pointerup'])
        b.stage.root.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 71,
            pointerType: 'touch',
            clientX: 480,
            clientY: 300,
            bubbles: true,
            cancelable: true,
          }),
        );
  });
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('A touch of joy');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_touch')?.text?.value)).toBe(
    'A touch of joy',
  );
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.select([]);
    b.stage.root.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 72,
        pointerType: 'touch',
        clientX: 480,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole('menu', { name: 'Element actions' })).toBeVisible();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['i_touch']);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const root = window.__anniedrawing![0].stage.root;
    root.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 72,
        pointerType: 'touch',
        clientX: 480,
        clientY: 300,
        bubbles: true,
      }),
    );
  });
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_touch')?.x)).toBe(400);
});

test('marquee uses visible connector geometry and ignores hidden descendants', async ({ page }) => {
  await ready(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([
      {
        op: 'add',
        item: {
          id: 'i_arrow',
          kind: 'connector',
          from: { x: 400, y: 250 },
          to: { x: 600, y: 350 },
          route: 'straight',
        },
      },
      {
        op: 'add',
        item: {
          id: 'i_hidden',
          kind: 'group',
          hidden: true,
          children: [{ id: 'i_hidden_child', kind: 'rect', x: 430, y: 280, w: 50, h: 30 }],
        },
      },
    ]),
  );
  await page.mouse.move(375, 225);
  await page.mouse.down();
  await page.mouse.move(625, 375, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['i_arrow']);
});
