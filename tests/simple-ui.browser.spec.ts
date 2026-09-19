import { expect, test, type Page } from '@playwright/test';

async function blank(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
}

async function selectItem(page: Page, id: string) {
  await page.evaluate((id) => window.__anniedrawing![0].select([id]), id);
}

test('board menu stays focused and image upload remains available in the sidebar', async ({
  page,
}) => {
  await blank(page);
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  const menu = page.getByRole('dialog');
  await expect(menu.getByLabel('Drawing title')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Open a drawing' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Hide grid' })).toBeVisible();
  await expect(
    menu.getByRole('button', {
      name: /snapping|overview|keyboard shortcuts|sketchy lines|add an image|layers|auto-arrange|start a fresh/i,
    }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.ad-root').press('?');
  await expect(menu).toHaveCount(0);
  await page.locator('.ad-root').press('r');
  await expect.poll(() => page.evaluate(() => window.__anniedrawing![0].tool)).toBe('rect');
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add image', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvbn6PwAE+QKJBZFmYAAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect
    .poll(() => page.evaluate(() => window.__anniedrawing![0].query({ kind: 'image' }).length))
    .toBe(1);
});

test('selection inspector shows only relevant controls and opens colors on demand', async ({
  page,
}) => {
  await blank(page);
  const inspector = page.getByRole('complementary', { name: 'Selection style', exact: true });
  await expect(inspector).toBeHidden();
  const applied = await page.evaluate(() =>
    window.__anniedrawing![0].apply([
      {
        op: 'media.set',
        id: 'm_ui',
        media: {
          mime: 'image/png',
          w: 1,
          h: 1,
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvbn6PwAE+QKJBZFmYAAAAABJRU5ErkJggg==',
        },
      },
      { op: 'add', item: { id: 'i_shape', kind: 'rect', x: 400, y: 250, w: 180, h: 120 } },
      { op: 'add', item: { id: 'i_text', kind: 'text', x: 650, y: 250, text: { value: 'Hello' } } },
      {
        op: 'add',
        item: { id: 'i_image', kind: 'image', media: 'm_ui', x: 400, y: 450, w: 180, h: 120 },
      },
      {
        op: 'add',
        item: {
          id: 'i_arrow',
          kind: 'connector',
          from: { x: 650, y: 450 },
          to: { x: 850, y: 450 },
        },
      },
    ]),
  );
  expect(applied.ok, JSON.stringify(applied.errors)).toBe(true);
  await selectItem(page, 'i_shape');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Stroke', exact: true })).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Text size: Medium', exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Font: Friendly', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fill: Soft green', exact: true })).toBeHidden();
  await inspector.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: 'Fill: Soft green', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_shape')?.style?.fill)).toBe(
    'moss',
  );
  await expect(page.getByRole('button', { name: 'Fill: Soft green', exact: true })).toBeHidden();
  for (const name of [
    'Text size: Large',
    'Font: Serif',
    'Align text right',
    'Line: Bold',
    'Pattern: Dashed',
  ])
    await inspector.getByRole('button', { name, exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_shape'))).toMatchObject({
    text: { value: '', size: 'l', font: 'serif', align: 'end' },
    style: { fill: 'moss', strokeWidth: 4, dash: 'dashed' },
  });
  await expect(page.locator('[data-ad-id="i_shape"] .ad-shape path').first()).toHaveAttribute(
    'stroke-dasharray',
    '8 6',
  );
  await expect(inspector.getByRole('button', { name: /^(Add|Edit) text$/ })).toHaveCount(0);
  await page.locator('[data-ad-id="i_shape"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('A styled idea');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_shape')?.text)).toMatchObject({
    value: 'A styled idea',
    size: 'l',
    font: 'serif',
    align: 'end',
  });
  await expect(inspector.getByRole('button', { name: 'Opacity', exact: true })).toBeVisible();
  await expect(inspector.locator('details')).toHaveCount(0);

  await selectItem(page, 'i_text');
  await expect(inspector.getByRole('button', { name: 'Color', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Fill', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Stroke', exact: true })).toHaveCount(0);
  await expect(
    inspector.getByRole('button', { name: 'Text size: Medium', exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Font: Friendly', exact: true }),
  ).toBeVisible();
  await inspector.getByRole('button', { name: 'Font: Mono', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_text')?.text?.font)).toBe(
    'mono',
  );

  await selectItem(page, 'i_image');
  for (const name of ['Fill', 'Stroke', 'Color']) {
    await expect(inspector.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  for (const name of ['Font', 'Text', 'Line']) {
    await expect(inspector.getByRole('group', { name, exact: true })).toHaveCount(0);
  }
  await expect(inspector.getByRole('button', { name: 'Edit text', exact: true })).toHaveCount(0);

  await selectItem(page, 'i_arrow');
  await expect(inspector.getByRole('button', { name: 'Stroke', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Fill', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('combobox', { name: 'Route', exact: true })).toBeVisible();
  await expect(inspector.getByRole('combobox', { name: 'Arrowhead', exact: true })).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Font: Friendly', exact: true }),
  ).toBeVisible();
});

test('page chips allow contextual renaming and zoom controls stay compact', async ({ page }) => {
  await blank(page);
  const pageName = await page.evaluate(() => window.__anniedrawing![0].read().pages[0].name);
  await expect(page.getByRole('tab', { name: pageName, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: pageName, exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete page' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Rename page' }).click();
  await page.getByLabel('Page name', { exact: true }).fill('Ideas');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Ideas', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(0);
  const zoom = page.getByRole('button', { name: 'Zoom controls', exact: true });
  await zoom.click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].view.zoom)).toBeCloseTo(1.2);
  await expect(zoom).toContainText('120%');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(0);
  await expect(zoom).toBeFocused();
  await expect(page.getByRole('button', { name: 'Fit drawing', exact: true })).toBeVisible();
});

test('grouped tools support keyboard navigation and escape returns focus', async ({ page }) => {
  await blank(page);
  const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
  await shapes.click();
  await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Ellipse', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].tool)).toBe('ellipse');
  await expect(shapes).toHaveAttribute('aria-expanded', 'false');
  await shapes.click();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'Diamond', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(shapes).toBeFocused();
  await expect(shapes).toHaveAttribute('aria-expanded', 'false');
  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await exportButton.click();
  await expect(page.getByRole('button', { name: 'PNG Image', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'SVG Image', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'AnnieDoc format', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(exportButton).toBeFocused();
  await expect(exportButton).toHaveAttribute('aria-expanded', 'false');
});

for (const width of [1440, 390]) {
  test(`popovers align with their controls and toggle closed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await blank(page);
    for (const name of ['Shapes', 'More tools', 'Zoom controls', 'Export']) {
      const trigger = page.getByRole('button', { name, exact: true });
      const panel = page.getByRole('group', { name, exact: true });
      await trigger.click();
      await expect(panel).toBeVisible();
      const anchor = await trigger.boundingBox();
      const box = await panel.boundingBox();
      if (name === 'Zoom controls') {
        const fit = await page.getByRole('button', { name: 'Fit drawing' }).boundingBox();
        expect(box!.x + box!.width).toBeCloseTo(fit!.x + fit!.width, 0);
        expect(box!.y + box!.height).toBeLessThan(anchor!.y);
      } else if (name === 'Export') {
        expect(box!.y).toBeGreaterThan(anchor!.y);
        expect(box!.x + box!.width).toBeCloseTo(anchor!.x + anchor!.width, 0);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      } else if (width > 700) {
        expect(box!.x).toBeGreaterThan(anchor!.x + anchor!.width);
        expect(box!.y).toBeCloseTo(anchor!.y, 0);
      } else {
        expect(box!.y + box!.height).toBeLessThan(anchor!.y);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await trigger.click();
      await expect(panel).toBeHidden();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(panel).toBeVisible();
      await page.mouse.click(width / 2, name === 'Export' ? 400 : 150);
      await expect(panel).toBeHidden();
      await trigger.click();
      await expect(panel).toBeVisible();
      await trigger.focus();
      await trigger.press('Enter');
      await expect(panel).toBeHidden();
    }
  });
}

test('color controls match rendered defaults and retain focus after a live agent edit', async ({
  page,
}) => {
  await blank(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: { id: 'i_note_color', kind: 'note', x: 400, y: 200, text: { value: 'A note' } },
      },
      { op: 'add', item: { id: 'i_rect_color', kind: 'rect', x: 650, y: 200 } },
    ]);
    board.select(['i_note_color']);
  });
  const fill = page.getByRole('button', { name: 'Fill', exact: true });
  await fill.click();
  await expect(page.getByRole('button', { name: 'Fill: Soft green', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'i_note_color', patch: { x: 410 } }], {
      origin: 'agent:test',
    }),
  );
  await expect(page.locator('.ad-popover')).toHaveCount(0);
  await expect(fill).toBeFocused();
  await fill.click();
  await page.getByRole('button', { name: 'Fill: Orange', exact: true }).click();
  await expect(page.locator('[data-ad-id="i_note_color"] .ad-shape path').first()).toHaveAttribute(
    'fill',
    '#FF9302',
  );
  await selectItem(page, 'i_rect_color');
  await fill.click();
  await expect(page.getByRole('button', { name: 'Fill: No fill', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('multi-selection text styling preserves distinct content and undoes each batch together', async ({
  page,
}) => {
  await blank(page);
  const result = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const result = board.apply([
      {
        op: 'add',
        item: {
          id: 'i_first',
          kind: 'text',
          x: 400,
          y: 250,
          text: { value: 'A first idea', size: 18, font: 'sans', align: 'start' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'i_second',
          kind: 'text',
          x: 650,
          y: 250,
          text: { value: 'An entirely different thought', size: 26, font: 'serif', align: 'end' },
        },
      },
    ]);
    board.select(['i_first', 'i_second']);
    return result;
  });
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  const inspector = page.getByRole('complementary', { name: 'Selection style', exact: true });
  const size = inspector.getByRole('button', { name: 'Text size: Large', exact: true });
  await expect(
    inspector.getByRole('group', { name: 'Text', exact: true }).locator('[aria-pressed="true"]'),
  ).toHaveCount(0);
  const text = () =>
    page.evaluate(() =>
      ['i_first', 'i_second'].map((id) => window.__anniedrawing![0].get(id)!.text),
    );
  const original = [
    { value: 'A first idea', size: 18, font: 'sans', align: 'start' },
    { value: 'An entirely different thought', size: 26, font: 'serif', align: 'end' },
  ];
  await size.click();
  const resized = original.map((item) => ({ ...item, size: 'l' }));
  expect(await text()).toMatchObject(resized);

  await inspector.getByRole('button', { name: 'Font: Mono', exact: true }).click();
  const fontChanged = resized.map((item) => ({ ...item, font: 'mono' }));
  expect(await text()).toMatchObject(fontChanged);
  await inspector.getByRole('button', { name: 'Align text center', exact: true }).click();
  expect(await text()).toMatchObject(fontChanged.map((item) => ({ ...item, align: 'center' })));

  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await text()).toMatchObject(fontChanged);
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await text()).toMatchObject(resized);
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await text()).toMatchObject(original);
});
