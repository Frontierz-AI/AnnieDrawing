import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.apply([
      {
        op: 'add',
        item: {
          id: 'target',
          kind: 'rect',
          x: 230,
          y: 200,
          w: 180,
          h: 120,
          style: { fill: 'teal' },
          text: { value: 'One' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'other',
          kind: 'ellipse',
          x: 480,
          y: 200,
          w: 180,
          h: 120,
          style: { fill: 'rose' },
          text: { value: 'Two' },
        },
      },
    ]);
  });
}

test('context actions affect the clicked element and support keyboard dismissal and editing', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => window.__anniedrawing![0].select(['target', 'other']));
  const target = page.locator('[data-ad-id="target"]');
  await target.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Element actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Edit text',
    'Bring to front',
    'Send to back',
    'Duplicate',
    'Delete',
  ]);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['target']);
  await menu.getByRole('menuitem', { name: 'Bring to front' }).click();
  expect(
    await page.evaluate(() => window.__anniedrawing![0].read().pages[0].items.map(({ id }) => id)),
  ).toEqual(['other', 'target']);
  await target.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Send to back' }).click();
  expect(
    await page.evaluate(() => window.__anniedrawing![0].read().pages[0].items.map(({ id }) => id)),
  ).toEqual(['target', 'other']);
  await page.locator('.ad-root').press('Shift+F10');
  await expect(menu.getByRole('menuitem', { name: 'Edit text' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Edit text' }).fill('Changed only this');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('other')?.text?.value)).toBe(
    'Two',
  );
  await target.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
  const copy = await page.evaluate(() => window.__anniedrawing![0].selection[0]);
  expect(copy).not.toBe('target');
  await page.locator('.ad-root').press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await page.evaluate((id) => window.__anniedrawing![0].get(id), copy)).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate((id) => window.__anniedrawing![0].get(id)?.text?.value, copy)).toBe(
    'Changed only this',
  );
  await page.locator(`[data-ad-id="${copy}"]`).click({ button: 'right' });
  await page.mouse.click(700, 500, { button: 'right' });
  await expect(menu).toHaveCount(0);
});

test('opacity stays open while adjusting and locking can be reversed through the inspector', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => window.__anniedrawing![0].select(['target']));
  const inspector = page.getByRole('complementary', { name: 'Selection style' });
  await expect(inspector.locator('details')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Opacity', exact: true }).click();
  const slider = page.getByRole('slider', { name: /Opacity/ });
  await expect(slider).toBeFocused();
  await slider.press('Home');
  await expect(slider).toBeVisible();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('target')?.style?.opacity)).toBe(
    0,
  );
  await slider.press('End');
  await slider.press('ArrowLeft');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('target')?.style?.opacity)).toBe(
    0.99,
  );
  await slider.press('Escape');
  await expect(inspector.getByRole('button', { name: 'Opacity', exact: true })).toBeFocused();
  await inspector.getByRole('button', { name: 'Opacity', exact: true }).click();
  await expect(slider).toHaveValue('99');
  await slider.press('Escape');
  await inspector.getByRole('button', { name: 'Lock selection', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('target')?.locked)).toBe(true);
  await page.locator('.ad-root').press('Escape');
  const locked = await page.locator('[data-ad-id="target"]').boundingBox();
  await page.mouse.click(locked!.x + locked!.width / 2, locked!.y + locked!.height / 2, {
    button: 'right',
  });
  await expect(page.getByRole('menuitem', { name: 'Edit text' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await inspector.getByRole('button', { name: 'Unlock selection' }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('target')?.locked)).toBe(false);
  for (const kind of ['Fill', 'Line']) {
    await inspector.getByRole('button', { name: kind, exact: true }).click();
    for (const color of ['Slate', 'Peach', 'Sky blue', 'Rose'])
      await expect(
        page.getByRole('button', { name: `${kind}: ${color}`, exact: true }),
      ).toBeVisible();
    await page.getByRole('button', { name: `${kind}: Sky blue`, exact: true }).click();
  }
  expect(await page.evaluate(() => window.__anniedrawing![0].get('target')?.style)).toMatchObject({
    fill: 'sky',
    stroke: 'sky',
  });
});

for (const width of [1440, 390, 320]) {
  test(`page chips overflow, rename, switch and delete the chosen page at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await ready(page);
    await page.evaluate(() => {
      const board = window.__anniedrawing![0];
      board.apply(
        Array.from({ length: 12 }, (_, index) => ({
          op: 'page.add' as const,
          page: { id: `p_${index}`, name: `A lovely page ${index + 1}`, items: [] },
        })),
      );
      board.setPage('p_11');
    });
    const active = page.getByRole('tab', { name: 'A lovely page 12', exact: true });
    await expect(active).toBeVisible();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    const overflow = page.getByRole('button', { name: 'All pages', exact: true });
    await expect(overflow).toBeVisible();
    await page.screenshot({ path: info.outputPath('page-chips.png') });
    const rail = await page.locator('.ad-pages').boundingBox();
    expect(rail!.x).toBeGreaterThanOrEqual(0);
    expect(rail!.x + rail!.width).toBeLessThanOrEqual(width);
    const children = await page.locator('.ad-pages button:visible').all();
    for (const child of children) {
      const box = await child.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
    }
    await overflow.click();
    const all = page.getByRole('group', { name: 'All pages', exact: true });
    await expect(all.getByRole('button', { name: 'A lovely page 2', exact: true })).toBeVisible();
    await all
      .getByRole('button', { name: 'A lovely page 2', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename page' }).click();
    await page.getByLabel('Page name', { exact: true }).fill('Sketches');
    await page.getByRole('button', { name: 'Save name' }).click();
    expect(await page.evaluate(() => window.__anniedrawing![0].pageId)).toBe('p_11');
    await overflow.click();
    await all.getByRole('button', { name: 'Sketches', exact: true }).click();
    const renamed = page.getByRole('tab', { name: 'Sketches', exact: true });
    await expect(renamed).toHaveAttribute('aria-selected', 'true');
    await renamed.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Delete page' }).click();
    expect(
      await page.evaluate(() =>
        window.__anniedrawing![0].read().pages.some(({ id }) => id === 'p_1'),
      ),
    ).toBe(false);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      await page.evaluate(
        () => window.__anniedrawing![0].read().pages.find(({ id }) => id === 'p_1')?.name,
      ),
    ).toBe('Sketches');
    await page.getByRole('tab', { selected: true }).press('End');
    await expect(page.getByRole('tab', { name: 'A lovely page 12', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { selected: true }).press('Home');
    expect(await page.evaluate(() => window.__anniedrawing![0].pageId)).toBe(
      await page.evaluate(() => window.__anniedrawing![0].read().pages[0].id),
    );
  });
}

test('a hollow shape opens its text action from the middle and page tabs support touch holds', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([
      { op: 'set', id: 'target', patch: { style: { fill: 'none' }, text: { value: '' } } },
    ]);
  });
  await page.locator('[data-ad-id="target"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Edit text' })).toBeVisible();
  await page.keyboard.press('Escape');
  const tab = page.getByRole('tab', { selected: true });
  await tab.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 5,
    clientX: 550,
    clientY: 700,
  });
  await expect(page.getByRole('menu', { name: 'Page actions' })).toBeVisible();
  await tab.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 5 });
  await tab.dispatchEvent('click');
  await expect(page.getByRole('menuitem', { name: 'Delete page' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Rename page' }).click();
  await page.getByLabel('Page name', { exact: true }).fill('A little sketch');
  await page.getByLabel('Page name', { exact: true }).press('Enter');
  await expect(page.getByRole('tab', { name: 'A little sketch', exact: true })).toBeFocused();
});
