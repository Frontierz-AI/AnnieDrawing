import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.apply([
      {
        op: 'add',
        item: {
          id: 'locked',
          kind: 'rect',
          x: 240,
          y: 220,
          w: 180,
          h: 110,
          locked: true,
          style: { fill: 'teal' },
          text: { value: 'Keep me here' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'free',
          kind: 'ellipse',
          x: 500,
          y: 220,
          w: 180,
          h: 110,
          style: { fill: 'rose' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'hollow',
          kind: 'rect',
          x: 240,
          y: 440,
          w: 180,
          h: 110,
          locked: true,
          style: { fill: 'none' },
        },
      },
    ]);
  });
}

const scene = (page: Page) => page.evaluate(() => window.__anniedrawing![0].read().pages);

async function drag(page: Page, x: number, y: number, alt = false) {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 60, { steps: 6 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

test('locked shapes can be clicked and focused, with only Unlock and Deselect enabled', async ({
  page,
}) => {
  await ready(page);
  const item = page.locator('[data-ad-id="locked"]');
  await item.click();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['locked']);
  const inspector = page.getByRole('complementary', { name: 'Selection style' });
  await expect(inspector).toBeVisible();
  expect(
    await inspector
      .locator('button:enabled')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))),
  ).toEqual(['Deselect', 'Unlock selection']);
  await expect(inspector.getByRole('button', { name: 'Fill', exact: true })).toBeDisabled();
  await expect(inspector.getByRole('button', { name: 'Opacity', exact: true })).toHaveCSS(
    'opacity',
    '0.38',
  );
  await expect(page.locator('[data-ad-handle]')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Deselect', exact: true }).click();
  await expect(inspector).toBeHidden();
  await item.focus();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['locked']);
  await expect(item).toHaveAttribute('tabindex', '0');
  await page.locator('[data-ad-id="hollow"]').click();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['hollow']);
});

test('dragging, duplication, keyboard edits, double click and erasing cannot change locked items', async ({
  page,
}) => {
  await ready(page);
  const before = await scene(page);
  await page.locator('[data-ad-id="locked"]').click();
  await drag(page, 320, 265);
  await drag(page, 320, 265, true);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['locked']);
  for (const key of [
    'ArrowRight',
    'Shift+ArrowDown',
    'Delete',
    'Backspace',
    'ControlOrMeta+d',
    'ControlOrMeta+g',
    'ControlOrMeta+Shift+g',
    '[',
    ']',
    'Enter',
  ]) {
    await page.locator('.ad-root').press(key);
  }
  await page.locator('[data-ad-id="locked"]').dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  await page.evaluate(() => window.__anniedrawing![0].setTool('eraser'));
  await drag(page, 320, 265);
  expect(await scene(page)).toEqual(before);
  await page.evaluate(() => window.__anniedrawing![0].setTool('select'));
  await page.locator('[data-ad-id="locked"]').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Element actions' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('button:enabled')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock selection', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Fill', exact: true })).toBeEnabled();
  await expect(page.locator('[data-ad-handle]')).not.toHaveCount(0);
  await drag(page, 320, 265);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('locked')?.x)).toBe(310);
  await page.locator('[data-ad-id="locked"]').dblclick();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('Unlocked');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('locked')?.text?.value)).toBe(
    'Unlocked',
  );
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('locked'))).toBeUndefined();
});

test('a mixed selection stays unchanged until its locked items are unlocked', async ({ page }) => {
  await ready(page);
  await page.locator('[data-ad-id="locked"]').click();
  await page.locator('[data-ad-id="free"]').click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual([
    'locked',
    'free',
  ]);
  await expect(page.locator('[data-ad-handle]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More arrangement options' })).toBeDisabled();
  const before = await scene(page);
  await drag(page, 580, 260, true);
  for (const key of ['ArrowRight', 'Delete', 'ControlOrMeta+d', 'ControlOrMeta+g', ']'])
    await page.locator('.ad-root').press(key);
  await page.evaluate(() => window.__anniedrawing![0].align('left'));
  expect(await scene(page)).toEqual(before);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual([
    'locked',
    'free',
  ]);
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete selection', exact: true })).toBeEnabled();
  await page.locator('.ad-root').press('ArrowRight');
  expect(
    await page.evaluate(() => ['locked', 'free'].map((id) => window.__anniedrawing![0].get(id)?.x)),
  ).toEqual([241, 501]);
});

test('group locks protect descendants and a locked descendant protects group operations', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: {
          id: 'group',
          kind: 'group',
          locked: true,
          x: 460,
          y: 410,
          w: 240,
          h: 180,
          children: [
            {
              id: 'child',
              kind: 'rect',
              x: 480,
              y: 430,
              w: 160,
              h: 100,
              style: { fill: 'violet' },
            },
          ],
        },
      },
    ]);
  });
  const before = await scene(page);
  await page.locator('[data-ad-id="child"]').click();
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['group']);
  await page.locator('[data-ad-id="child"]').dblclick();
  await drag(page, 540, 470);
  await page.locator('.ad-root').press('ControlOrMeta+Shift+g');
  expect(await scene(page)).toEqual(before);
  await page.evaluate(() => window.__anniedrawing![0].select(['child']));
  await expect(page.getByRole('button', { name: 'Unlock selection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('group')?.locked)).toBe(false);
  await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
  await page.evaluate(() => window.__anniedrawing![0].select(['group']));
  const childLocked = await scene(page);
  await drag(page, 540, 470);
  await page.locator('.ad-root').press('Delete');
  expect(await scene(page)).toEqual(childLocked);
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('child')?.locked)).toBe(false);
  await drag(page, 540, 470);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('child')?.x)).toBe(550);
});

test('a new lock cancels an in-progress drag or text edit and closes opacity editing', async ({
  page,
}) => {
  await ready(page);
  await page.locator('[data-ad-id="free"]').click();
  const before = await page.evaluate(() => window.__anniedrawing![0].get('free'));
  await page.mouse.move(580, 260);
  await page.mouse.down();
  await page.mouse.move(650, 320, { steps: 6 });
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'free', patch: { locked: true } }]),
  );
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('free'))).toEqual({
    ...before,
    locked: true,
  });
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  await page.locator('[data-ad-id="free"]').dblclick();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('Uncommitted');
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'free', patch: { locked: true } }]),
  );
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('free')?.text?.value ?? '')).toBe(
    '',
  );
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  await page.getByRole('button', { name: 'Opacity', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Opacity' })).toBeVisible();
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'free', patch: { locked: true } }]),
  );
  await expect(page.getByRole('slider', { name: 'Opacity' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unlock selection', exact: true })).toBeFocused();
});

test('touch selection and double tap preserve a locked item, and user edits fail atomically', async ({
  page,
}) => {
  await ready(page);
  const before = await scene(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    for (let tap = 0; tap < 2; tap++)
      for (const type of ['pointerdown', 'pointerup'])
        board.stage.root.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 71,
            pointerType: 'touch',
            clientX: 320,
            clientY: 265,
            bubbles: true,
            cancelable: true,
          }),
        );
  });
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['locked']);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  const result = await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        { op: 'set', id: 'free', patch: { x: 600 } },
        { op: 'set', id: 'locked', patch: { style: { fill: 'rose' } } },
      ],
      { origin: 'user' },
    ),
  );
  expect(result).toMatchObject({ ok: false, errors: [{ index: 1, code: 'LOCKED' }] });
  expect(await scene(page)).toEqual(before);
});
