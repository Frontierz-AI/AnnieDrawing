import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function openDemo(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    await window.__anniedrawing![0].ready;
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
  });
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('desktop keeps essential controls visible and groups secondary tools', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await expect(page.getByRole('button', { name: 'Board menu', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await expect(
    page.locator('.ad-welcome, .ad-title-wrap, .ad-save-status, .ad-footer-center, .ad-tool-key'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'For agents', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Page 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await page.evaluate(() => window.__anniedrawing![0].read().pages[0])).toMatchObject({
    name: 'Page 1',
    items: [],
  });
  const toolbar = page.locator('.ad-toolbar');
  await expect(toolbar.getByRole('button')).toHaveCount(8);
  await expect(toolbar.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    /v/i,
  );
  await expect(toolbar.getByRole('button', { name: 'More tools', exact: true })).toHaveCount(0);
  await capture(page, info, 'desktop-default');
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  for (const name of ['Rectangle', 'Ellipse', 'Diamond', 'Line', 'Arrow']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].tool)).toBe('line');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].tool)).toBe('eraser');
  await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeVisible();
});

test('phone has seven reachable tools and secondary actions in the board menu', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const toolbar = page.locator('.ad-toolbar');
  await expect(toolbar.getByRole('button')).toHaveCount(7);
  const visibleTools = await toolbar.getByRole('button').all();
  for (const tool of visibleTools) {
    const box = await tool.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await capture(page, info, 'phone-default');
  await page.getByRole('button', { name: 'Sticky note', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].tool)).toBe('note');
  await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  expect(await page.evaluate(() => window.__anniedrawing![0].tool)).toBe('connector');
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hand', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board menu', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Board menu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Board menu', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  for (const name of ['PNG Image', 'SVG Image', 'AnnieDoc format']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  expect(
    await page
      .getByRole('button', { name: 'PNG Image', exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await capture(page, info, 'phone-export');
});

test('small phone controls stay inside the viewport and documentation opens', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openDemo(page);
  for (const name of ['Board menu', 'Export', 'Add page', 'Fit drawing']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  const toolbar = await page.locator('.ad-toolbar').boundingBox();
  expect(toolbar!.x).toBeGreaterThanOrEqual(0);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(320);
  await capture(page, info, 'small-phone-default');
  await page.goto('/docs/index.html');
  await expect(page).toHaveTitle(/AnnieDrawing documentation/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole('link', { name: 'Open the demo', exact: true })).toBeVisible();
  await capture(page, info, 'phone-documentation');
});

test('dark appearance preserves readable labels and filled-shape text', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.evaluate(() => {
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: {
            id: 'i_intro',
            kind: 'text',
            x: 24,
            y: 40,
            w: 280,
            h: 28,
            text: { value: 'A LITTLE SPACE', size: 13 },
            style: { stroke: 'slate', fill: 'none' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'i_subtitle',
            kind: 'text',
            x: 24,
            y: 80,
            w: 300,
            h: 40,
            text: { value: 'No perfect lines needed.', size: 16 },
            style: { stroke: 'slate', fill: 'none' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'i_caption',
            kind: 'text',
            x: 24,
            y: 130,
            w: 280,
            h: 28,
            text: { value: 'Double-tap any shape to write.', size: 13 },
            style: { stroke: 'slate', fill: 'none' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'i_note',
            kind: 'note',
            x: 24,
            y: 180,
            w: 160,
            h: 140,
            text: { value: 'A thought', size: 19 },
            style: { fill: 'moss', stroke: 'none' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'i_step2',
            kind: 'rect',
            x: 200,
            y: 180,
            w: 140,
            h: 80,
            text: { value: 'A step', size: 18 },
            style: { fill: 'teal', stroke: 'ink', strokeWidth: 2 },
          },
        },
      ],
      { origin: 'user', label: 'Contrast samples' },
    );
  });
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await page.getByRole('button', { name: 'Dark appearance', exact: true }).click();
  await expect(page.locator('.ad-root')).toHaveAttribute('data-theme', 'dark');
  const contrasts = await page.evaluate(() => {
    const luminance = (css: string) => {
      const channels = css
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground: string, background: string) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const background = getComputedStyle(document.querySelector('.ad-root')!).backgroundColor;
    return ['i_intro', 'i_subtitle', 'i_caption', 'i_note', 'i_step2'].map((id) => {
      const item = document.querySelector(`[data-ad-id="${id}"]`)!;
      const textColor = getComputedStyle(item.querySelector('.ad-text')!).color;
      const fill = item.querySelector('.ad-shape path');
      return {
        id,
        ratio: contrast(
          textColor,
          id === 'i_note' || id === 'i_step2' ? getComputedStyle(fill!).fill : background,
        ),
      };
    });
  });
  for (const { id, ratio } of contrasts)
    expect(ratio, `${id} contrast`).toBeGreaterThanOrEqual(4.5);
  await capture(page, info, 'phone-dark-default');
});
