import { expect, test, type Page } from '@playwright/test';

async function mount(page: Page, options: Record<string, unknown> = {}) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async (options) => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="ui-fixture" style="position:fixed;inset:0"></main>';
    const { createBoard } = await import('/src/board.ts' as string);
    createBoard(document.querySelector('#ui-fixture')!, options);
  }, options);
}

test('an imported board offers PNG and SVG export and keeps the AnnieDrawing menu', async ({
  page,
}) => {
  await mount(page);
  await expect(page.getByRole('button', { name: 'Board menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PNG Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SVG Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AnnieDoc format', exact: true })).toHaveCount(0);
});

test('hosts can hide the AnnieDrawing menu and the export control', async ({ page }) => {
  await mount(page, { ui: { menu: false, export: false } });
  await expect(page.getByRole('button', { name: 'Board menu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
});

test('hosts can offer AnnieDoc and choose dark appearance', async ({ page }) => {
  await mount(page, { theme: 'dark', ui: { export: ['png', 'svg', 'json'] } });
  await expect(page.locator('.ad-root')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AnnieDoc format', exact: true })).toBeVisible();
});

test('auto appearance follows the system color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mount(page, { theme: 'auto' });
  await expect(page.locator('.ad-root')).toHaveAttribute('data-theme', 'dark');
});

test('a single export format downloads without opening a menu', async ({ page }) => {
  await mount(page, { ui: { menu: false, export: ['png'] } });
  await expect(page.getByRole('button', { name: 'Board menu', exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Export', exact: true })).toHaveCount(0);
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});
