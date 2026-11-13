import { test, expect, type Page } from '@playwright/test';

const rows = [
  ['Current point', 'Next focus', 'Task category', 'Owner'],
  [
    'End of session 2, after the recap of the inbox triage exercise',
    'Session 3',
    'Inbox, calendar, meetings, and the weekly review that ties them together',
    'Learner',
  ],
  ['Session 3', 'Session 4', 'Reports and dashboards', 'Tutor'],
];

const ready = async (page: Page) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async (rows) => {
    const b = window.__anniedrawing![0];
    await b.ready;
    b.clear();
    b.setGrid(false);
    b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    b.apply(
      [
        { op: 'add', item: { id: 't1', kind: 'table', x: 60, y: 60, rows, header: true } },
        { op: 'add', item: { id: 'next', kind: 'rect', text: 'Next step' } },
        { op: 'add', item: { id: 'c1', kind: 'arrow', from: 't1', to: 'next' } },
      ],
      { origin: 'agent:fellow', reveal: 'none' },
    );
    await new Promise<void>((done) => b.stage.whenPresentationIdle(done));
    b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, rows);
};

/** Each cell's text stays inside its cell box, and the item is exactly its stored size. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const view = board.stage.world.querySelector<HTMLElement>('[data-ad-id="t1"]')!;
    const cells = [...view.querySelectorAll<HTMLElement>('[data-ad-cell]')];
    const overflow = cells.flatMap((cell) => {
      const box = cell.getBoundingClientRect(),
        range = document.createRange();
      range.selectNodeContents(cell);
      const text = range.getBoundingClientRect();
      const style = getComputedStyle(cell);
      const out =
        cell.scrollWidth > cell.clientWidth + 0.5 ||
        cell.scrollHeight > cell.clientHeight + 0.5 ||
        text.left < box.left + parseFloat(style.paddingLeft) - 0.5 ||
        text.right > box.right - parseFloat(style.paddingRight) + 0.5 ||
        text.bottom > box.bottom + 0.5;
      return out ? [cell.dataset.adCell] : [];
    });
    const item = board.get('t1')!;
    return {
      overflow,
      count: cells.length,
      size: [view.offsetWidth, view.offsetHeight],
      stored: [item.w, item.h],
      grid: [
        Number(view.querySelector('svg rect')!.getAttribute('width')),
        Number(view.querySelector('svg rect')!.getAttribute('height')),
      ],
      headWeight: Number(getComputedStyle(cells[0]).fontWeight),
      bodyWeight: Number(getComputedStyle(cells[4]).fontWeight),
      color: getComputedStyle(cells[4]).color,
      aria: view.getAttribute('aria-label'),
      texts: cells.map((cell) => cell.textContent),
    };
  });

test('a 4x3 table fits its text in light and dark, exports, and takes a connector', async ({
  page,
}) => {
  await ready(page);
  const light = await measure(page);
  expect(light.count).toBe(12);
  expect(light.overflow).toEqual([]);
  expect(light.size).toEqual(light.stored);
  expect(light.grid).toEqual(light.stored);
  expect(light.headWeight).toBeGreaterThanOrEqual(700);
  expect(light.bodyWeight).toBeLessThan(700);
  expect(light.texts).toEqual(rows.flat());
  expect(light.aria).toBe(
    'Table, 4 columns, 3 rows: Current point, Next focus, Task category, Owner',
  );

  await page.evaluate(() => window.__anniedrawing![0].setTheme('dark'));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const dark = await measure(page);
  expect(dark.overflow).toEqual([]);
  expect(dark.color).not.toBe(light.color);

  const exported = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const png = (await board.export('png')) as Blob;
    const svg = (await board.export('svg')) as string;
    const connector = board.get('c1')!;
    return { png: [png.type, png.size], svg, from: connector.from };
  });
  expect(exported.png[0]).toBe('image/png');
  expect(exported.png[1]).toBeGreaterThan(1000);
  for (const word of ['Current', 'Reports', 'dashboards', 'Learner'])
    expect(exported.svg).toContain(word);
  expect(exported.from).toMatchObject({ item: 't1' });
});

/** A repaint replaces the cells on the next frame, so let pending frames run before measuring. */
const cellCenter = async (page: Page, key: string) => {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const box = (await page.locator(`[data-ad-id="t1"] [data-ad-cell="${key}"]`).boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2] as const;
};

test('double-click edits one cell with one undo step; Escape cancels; Tab moves', async ({
  page,
}) => {
  await ready(page);
  const [x, y] = await cellCenter(page, '2,2');
  await page.mouse.dblclick(x, y);
  const editor = page.getByRole('textbox', { name: 'Edit cell 2,2' });
  await expect(editor).toBeVisible();
  await editor.fill('Reports');
  await page.keyboard.press('ControlOrMeta+Enter');
  const edited = await page.evaluate(() => window.__anniedrawing![0].get('t1')!.rows);
  expect(edited![2][2]).toBe('Reports');
  expect(edited![1][2]).toBe(rows[1][2]);
  await expect(page.locator('[data-ad-id="t1"] [data-ad-cell="2,2"]')).toHaveText('Reports');
  expect((await measure(page)).overflow).toEqual([]);
  await page.locator('.annie-root').press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('t1')!.rows![2][2])).toBe(
    rows[2][2],
  );

  const revision = await page.evaluate(() => window.__anniedrawing![0].revision);
  await page.mouse.dblclick(...(await cellCenter(page, '0,1')));
  await page.getByRole('textbox', { name: 'Edit cell 0,1' }).fill('Discarded');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.__anniedrawing![0].revision)).toBe(revision);
  await expect(page.locator('[data-ad-id="t1"] [data-ad-cell="0,1"]')).toHaveText('Next focus');

  await page.mouse.dblclick(...(await cellCenter(page, '0,3')));
  await page.getByRole('textbox', { name: 'Edit cell 0,3' }).fill('Who');
  await page.keyboard.press('Tab');
  const next = page.getByRole('textbox', { name: 'Edit cell 1,0' });
  await expect(next).toBeFocused();
  await next.fill('Start');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('textbox', { name: 'Edit cell 0,3' })).toBeFocused();
  await page.keyboard.press('Escape');
  const tabbed = await page.evaluate(() => window.__anniedrawing![0].get('t1')!.rows!);
  expect([tabbed[0][3], tabbed[1][0]]).toEqual(['Who', 'Start']);
});

test('readonly boards and locked tables do not open the cell editor', async ({ page }) => {
  await ready(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 't1', patch: { locked: true } }]),
  );
  await page.mouse.dblclick(...(await cellCenter(page, '1,1')));
  await expect(page.getByRole('textbox')).toHaveCount(0);

  const opened = await page.evaluate(async (rows) => {
    const { createBoard } = await import('/src/board.ts' as string);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:10';
    document.body.append(host);
    const b = createBoard(host, {
      readonly: true,
      ui: false,
      exposeGlobal: false,
      doc: {
        format: 'anniedrawing',
        version: 2,
        meta: { title: 'Readonly' },
        pages: [
          {
            id: 'p',
            name: 'Page',
            items: [{ id: 'r1', kind: 'table', x: 40, y: 40, w: 600, h: 300, rows }],
          },
        ],
        media: {},
      },
    });
    await b.ready;
    const cell = host.querySelector<HTMLElement>('[data-ad-cell="1,1"]')!.getBoundingClientRect();
    return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
  }, rows);
  await page.mouse.dblclick(opened.x, opened.y);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
